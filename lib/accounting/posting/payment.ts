/**
 * Orden de pago (`payment`, E.5.5).
 *
 * **Ecuación:** `M = Σ medios`, `A = Σ aplicaciones`, `C = Σ saldos a favor
 * usados`, `W = diferencia dada por cancelada`: `M + W > 0`, `C ≤ A` y lo que
 * queda a cuenta (`M + W + C − A`) nunca es negativo.
 *
 * **Asiento:** D control `[partícipe]` {control, partida Debe por M + W} /
 * H cada caja {treasury} / H cada compensación {compensation} /
 * H `discounts_obtained` {write_off}. Los medios van en el orden de carga.
 *
 * **Imputaciones** (`planPaymentAllocation`, determinista): las aplicaciones en
 * el orden elegido; cada una consume primero los saldos a favor (el más viejo
 * primero) y después la partida del pago. Lo que sobra queda a cuenta, sin
 * vencimiento. Todo en una sola cuenta de control (`mixed_control_accounts`).
 *
 * E7 · pago a Coca-Cola de $ 900.000 (Banco Nación $ 500.000 + Mercado Pago
 * $ 400.000) a tres facturas: F1 50.000.000 · F2 38.000.000 · F3 2.000.000.
 */

import {
  ackList,
  type BuildMeta,
  bundleOf,
  centsIssues,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  memoFor,
  type PartyInfo,
  partyInfo,
  postingError,
  postingWarning,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import type { PaymentInput } from '@/lib/accounting/schemas'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  IsoDate,
  LineKey,
  OpenItemRef,
  PartyKey,
  PostingContext,
  PostingError,
  PostingResult,
  PostingWarning,
  ProposedAllocation,
  ProposedDocument,
  Side,
  TaxKind,
  TreasuryRef,
} from '@/lib/accounting/types'

export type PaymentBuildInput = Omit<PaymentInput, 'clientRef' | 'previewHash'>

// ─── Partidas referenciadas ──────────────────────────────────────────────────

export type ResolvedItem = {
  index: number
  lineId: string
  amountCents: Cents
  item: OpenItemRef
}

/**
 * Las partidas que el formulario eligió, contra lo que cargó el contexto:
 * existen (`item_not_found`), son del partícipe (`allocation_party_mismatch`),
 * del lado que corresponde (`allocation_side_mismatch`) y no se aplica más
 * que lo abierto (`allocation_exceeds_open`, con el abierto en el detalle).
 */
export function resolveItems(
  list: ReadonlyArray<{ lineId: string; amountCents: Cents }>,
  ctx: Pick<PostingContext, 'openItems'>,
  opts: { partyId: string | null; side: Side; field: string },
): { items: ResolvedItem[]; errors: PostingError[] } {
  const items: ResolvedItem[] = []
  const errors: PostingError[] = []
  list.forEach((entry, index) => {
    const field = `${opts.field}.${index}`
    const item = ctx.openItems.get(entry.lineId)
    if (!item) {
      errors.push(postingError('item_not_found', `${field}.lineId`))
      return
    }
    if (opts.partyId !== null && item.partyId !== opts.partyId) {
      errors.push(postingError('allocation_party_mismatch', field))
      return
    }
    if (item.side !== opts.side) {
      errors.push(postingError('allocation_side_mismatch', field))
      return
    }
    if (entry.amountCents > item.openCents) {
      errors.push(
        postingError('allocation_exceeds_open', `${field}.amountCents`, {
          open_cents: item.openCents,
          label: item.label,
        }),
      )
      return
    }
    items.push({ index, lineId: entry.lineId, amountCents: entry.amountCents, item })
  })
  return { items, errors }
}

// ─── Plan de imputaciones ────────────────────────────────────────────────────

export type AllocationSource = { key: LineKey; amountCents: Cents }
/** Un saldo a favor a usar: `entryDate` decide «el más viejo primero» (empate: el orden de carga). */
export type CreditSource = AllocationSource & { entryDate: IsoDate }

export type AllocationPlanInput = {
  /** La partida propia del documento (la del pago o la del cobro) y su importe. */
  own: AllocationSource | null
  /** Partidas a cancelar, en el orden elegido. */
  applications: readonly AllocationSource[]
  /** Saldos a favor del mismo partícipe que se consumen primero. */
  credits: readonly CreditSource[]
}

/**
 * Reparte cada aplicación: primero contra los saldos a favor (el más viejo
 * primero) y después contra la partida propia. `ownSide` es el lado de la
 * partida propia: `debit` en un pago (las aplicaciones son facturas, Haber),
 * `credit` en un cobro (las aplicaciones son ventas, Debe). Lo que no alcanza
 * a cubrirse queda sin imputar (la ecuación del builder ya lo frenó).
 */
function plan(input: AllocationPlanInput, ownSide: Side): ProposedAllocation[] {
  const credits = input.credits
    .map((c, index) => ({ ...c, index, left: c.amountCents }))
    .sort((a, b) =>
      a.entryDate === b.entryDate ? a.index - b.index : a.entryDate < b.entryDate ? -1 : 1,
    )
  let ownLeft = input.own?.amountCents ?? 0
  const out: ProposedAllocation[] = []
  const pair = (
    mine: LineKey,
    theirs: LineKey,
    amountCents: Cents,
    kind: ProposedAllocation['kind'],
  ) =>
    out.push(
      ownSide === 'debit'
        ? { debit: mine, credit: theirs, amountCents, kind }
        : { debit: theirs, credit: mine, amountCents, kind },
    )
  for (const app of input.applications) {
    let need = app.amountCents
    for (const credit of credits) {
      if (need === 0) break
      if (credit.left === 0) continue
      const take = Math.min(need, credit.left)
      pair(credit.key, app.key, take, 'credit_note')
      credit.left -= take
      need -= take
    }
    if (need > 0 && input.own && ownLeft > 0) {
      const take = Math.min(need, ownLeft)
      pair(input.own.key, app.key, take, 'payment')
      ownLeft -= take
      need -= take
    }
  }
  return out
}

/** Imputaciones de un pago (E.5.5): la partida del pago es Debe y las facturas, Haber. */
export function planPaymentAllocation(input: AllocationPlanInput): ProposedAllocation[] {
  return plan(input, 'debit')
}

/** Imputaciones de un cobro (E.5.7): la partida del cobro es Haber y las ventas, Debe. */
export function planCollectionAllocation(input: AllocationPlanInput): ProposedAllocation[] {
  return plan(input, 'credit')
}

// ─── Compensaciones ──────────────────────────────────────────────────────────

/** El tipo de impuesto de un saldo a favor usado para pagarle a un organismo (`tax_kind` del renglón). */
export function compensationTaxKind(key: SystemAccountKey | null): TaxKind {
  switch (key) {
    case 'iibb_perceptions':
    case 'iibb_balance':
      return 'iibb'
    case 'iibb_withholdings':
      return 'ret_iibb'
    case 'iibb_sircreb':
      return 'sircreb'
    case 'iibb_sircupa':
      return 'sircupa'
    case 'income_tax_withholdings':
      return 'ret_ganancias'
    case 'income_tax_perceptions':
    case 'income_tax_advances':
      return 'ganancias'
    case 'vat_free_balance':
      return 'iva'
    default:
      return 'otro'
  }
}

// ─── Pago simple (para «Guardar y pagar» y «Nuevo gasto») ───────────────────

export type SimplePaymentSpec = {
  ref: string
  party: PartyInfo
  controlAccountId: string
  treasury: TreasuryRef
  amountCents: Cents
  date: IsoDate
  reference: string | null
  notes: string | null
  warningsAck: readonly string[]
  /** Para la leyenda: el comprobante que se paga («Factura A 0003-00001290»). */
  label: string | null
}

/** D control `[partícipe]` / H caja, por el mismo importe. La partida del pago es el renglón 1. */
export function composeSimplePayment(spec: SimplePaymentSpec): {
  doc: ProposedDocument
  controlLineNo: number | null
} {
  const lines = new DocLineBuilder()
  lines.add({
    role: 'control',
    accountId: spec.controlAccountId,
    side: 'debit',
    amountCents: spec.amountCents,
    partyRef: spec.party.key,
    memo: spec.label ? `Pago de ${spec.label}` : 'Pago',
    tag: 'control',
  })
  lines.add({
    role: 'treasury',
    accountId: spec.treasury.accountId,
    side: 'credit',
    amountCents: spec.amountCents,
    treasuryAccountId: spec.treasury.id,
    reference: spec.reference,
    memo: spec.treasury.name,
  })
  const built = lines.build()
  const doc = proposedDocument({
    ref: spec.ref,
    kind: 'payment',
    party: spec.party.key,
    issueDate: spec.date,
    accountingDate: spec.date,
    description: descriptionFor('payment', 'Pago', spec.party.displayName, spec.label),
    notes: spec.notes,
    totalCents: spec.amountCents,
    controlAccountId: spec.controlAccountId,
    warningsAck: ackList(spec.warningsAck),
    lines: built.lines,
  })
  return { doc, controlLineNo: built.lineNoOf('control') }
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/** Orden de pago (E.5.5, E7): facturas, saldos a favor, varios medios y compensaciones. */
export function buildPayment(
  input: PaymentBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues([
    ...input.applications.map((a, i) => [`applications.${i}.amountCents`, a.amountCents] as const),
    ...input.creditsUsed.map((a, i) => [`creditsUsed.${i}.amountCents`, a.amountCents] as const),
    ...input.methods.map((m, i) => [`methods.${i}.amountCents`, m.amountCents] as const),
    ['writeOffCents', input.writeOffCents] as const,
  ])
  const partyKey: PartyKey = { id: input.partyId }
  const party = partyInfo(partyKey, ctx)
  if (!party) fatal.push(postingError('party_not_found', 'partyId'))
  const apps = resolveItems(input.applications, ctx, {
    partyId: input.partyId,
    side: 'credit',
    field: 'applications',
  })
  const credits = resolveItems(input.creditsUsed, ctx, {
    partyId: input.partyId,
    side: 'debit',
    field: 'creditsUsed',
  })
  fatal.push(...apps.errors, ...credits.errors)

  type MethodLine =
    | { type: 'treasury'; treasury: TreasuryRef; amountCents: Cents; reference: string | null }
    | { type: 'compensation'; accountId: string; key: SystemAccountKey | null; amountCents: Cents }
  const methods: MethodLine[] = []
  input.methods.forEach((m, i) => {
    if (m.type === 'treasury') {
      const treasury = ctx.treasuries.get(m.treasuryAccountId)
      if (!treasury) {
        fatal.push(postingError('treasury_mismatch', `methods.${i}.treasuryAccountId`))
        return
      }
      methods.push({
        type: 'treasury',
        treasury,
        amountCents: m.amountCents,
        reference: m.reference,
      })
    } else {
      const account = ctx.accounts.get(m.accountId)
      if (!account) {
        fatal.push(postingError('account_not_found', `methods.${i}.accountId`))
        return
      }
      methods.push({
        type: 'compensation',
        accountId: account.id,
        key: account.systemKey,
        amountCents: m.amountCents,
      })
    }
  })
  if (fatal.length > 0 || !party) return failed(fatal)

  // Una sola cuenta de control: la de las partidas elegidas, o la «le debemos» del partícipe (pago a cuenta).
  const errors: PostingError[] = []
  const warnings: PostingWarning[] = []
  const accounts = [...new Set([...apps.items, ...credits.items].map((r) => r.item.accountId))]
  if (accounts.length > 1) errors.push(postingError('mixed_control_accounts', 'applications'))
  const controlAccountId = accounts[0] ?? party.payableAccountId

  const M = sumCents(methods.map((m) => m.amountCents))
  const A = sumCents(apps.items.map((r) => r.amountCents))
  const C = sumCents(credits.items.map((r) => r.amountCents))
  const W = input.writeOffCents
  if (M + W <= 0) errors.push(postingError('amount_required', 'methods'))
  if (C > 0 && (apps.items.length === 0 || C > A)) {
    errors.push(postingError('credit_without_application', 'creditsUsed'))
  }
  if (A > M + W + C) {
    errors.push(postingError('allocation_exceeds_open', 'applications', { open_cents: M + W + C }))
  }
  if (W > 0) warnings.push(postingWarning('write_off', 'd1', { amount_cents: W }))

  const lines = new DocLineBuilder()
  lines.add({
    role: 'control',
    accountId: controlAccountId,
    side: 'debit',
    amountCents: M + W,
    partyRef: party.key,
    memo: `Pago a ${party.displayName}`,
    tag: 'control',
  })
  for (const m of methods) {
    if (m.type === 'treasury') {
      lines.add({
        role: 'treasury',
        accountId: m.treasury.accountId,
        side: 'credit',
        amountCents: m.amountCents,
        treasuryAccountId: m.treasury.id,
        reference: m.reference,
        memo: m.treasury.name,
      })
    } else {
      const taxKind = compensationTaxKind(m.key)
      lines.add({
        role: 'compensation',
        accountId: m.accountId,
        side: 'credit',
        amountCents: m.amountCents,
        taxKind,
        memo: `Compensación: ${ctx.accounts.get(m.accountId)?.name ?? memoFor('compensation', { taxKind })}`,
      })
    }
  }
  lines.add({
    role: 'write_off',
    accountId: ctx.sys.discounts_obtained.id,
    side: 'credit',
    amountCents: W,
    memo: memoFor('write_off'),
  })
  const built = lines.build()
  const controlLineNo = built.lineNoOf('control')

  const allocations =
    controlLineNo === null
      ? []
      : planPaymentAllocation({
          own: { key: { doc: 'd1', lineNo: controlLineNo }, amountCents: M + W },
          applications: apps.items.map((r) => ({
            key: { lineId: r.lineId },
            amountCents: r.amountCents,
          })),
          credits: credits.items.map((r) => ({
            key: { lineId: r.lineId },
            amountCents: r.amountCents,
            entryDate: r.item.entryDate,
          })),
        })

  const doc = proposedDocument({
    ref: 'd1',
    kind: 'payment',
    party: party.key,
    issueDate: input.date,
    accountingDate: input.date,
    description: descriptionFor('payment', 'Pago', party.displayName),
    notes: input.notes,
    totalCents: M + W,
    controlAccountId,
    warningsAck: ackList(input.warningsAck),
    lines: built.lines,
  })
  return finalize(bundleOf(meta, [doc], allocations), ctx, meta, { errors, warnings })
}
