/**
 * Cobranza o acreditación (`collection`, E.5.7) y «Ajustar saldo de Mercado
 * Pago» (acreditación por arqueo, E.5.8).
 *
 * **Ecuación:** `G (bruto) = R (Σ recibido) + D (Σ deducciones) + W`; lo que
 * queda a cuenta (`G + C − A`) nunca es negativo. `R` puede ser cero (E10b:
 * comisiones de pedidos cobrados en efectivo mayores que lo liquidado → le
 * debemos a la plataforma).
 *
 * **Asiento:** D cada caja {treasury} · D cada deducción {deduction}: la
 * comisión a su cuenta según el tipo de partícipe; el IVA de la comisión a
 * `vat_credit` con el comprobante en mano, a `vat_credit_pending [partícipe]`
 * si llega después, o a la cuenta de la comisión si no factura; percepciones y
 * retenciones a sus créditos fiscales · D `fees_other` {write_off} · H control
 * «nos debe» `[partícipe]` {control, partida Haber por G}.
 *
 * **Libro IVA compras** (si el comprobante de la comisión viene en la
 * liquidación o en la mano): neto 21 % = comisión, IVA = IVA de la comisión,
 * percepción y total; computable = IVA que fue a crédito fiscal.
 *
 * E9 · acreditación de crédito con la liquidación Posnet 004512: D Banco
 * 31.555.260 / D comisiones 594.000 / D IVA CF 124.740 / D ret. IIBB 396.000 /
 * D ret. Ganancias 330.000 / H Tarjetas de crédito a cobrar [Posnet] 33.000.000.
 */

import { percentOf } from '@/lib/accounting/iva'
import {
  type AdjustmentSplit,
  composeTreasuryAdjustment,
} from '@/lib/accounting/posting/adjustment'
import {
  ackList,
  type BuildMeta,
  bundleOf,
  centsIssues,
  counterpartyFor,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  fiscalAmounts,
  memoFor,
  type PartyInfo,
  partyInfo,
  postingError,
  proposedDocument,
  signedCentsIssues,
  sumCents,
} from '@/lib/accounting/posting/common'
import { planCollectionAllocation, resolveItems } from '@/lib/accounting/posting/payment'
import type { CollectionInput, DEDUCTION_KINDS, WalletCheckInput } from '@/lib/accounting/schemas'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  FiscalVoucher,
  LineKey,
  PartyKey,
  PartyRates,
  PostingContext,
  PostingError,
  PostingResult,
  PostingWarning,
  ProposedAllocation,
  ProposedDocument,
  TaxKind,
  TreasuryRef,
} from '@/lib/accounting/types'
import { commissionKeyFor } from '@/lib/accounting/validate'
import { afipVoucherCode, isVatComputable } from '@/lib/accounting/voucher-types'

export type CollectionBuildInput = Omit<CollectionInput, 'clientRef' | 'previewHash'>
export type WalletCheckBuildInput = Omit<WalletCheckInput, 'clientRef' | 'previewHash'>

/** Lo que tiene un cobro (también cada acreditación en el acto del cierre del día). */
export type CollectionCore = Omit<CollectionBuildInput, 'warningsAck'> & {
  warningsAck: readonly string[]
}

export type DeductionKind = (typeof DEDUCTION_KINDS)[number]
type DeductionInput = CollectionCore['deductions'][number]

/** Una partida del mismo bundle (la del cierre del día) que un cobro puede aplicar. */
export type BundleItem = { key: LineKey; accountId: string; partyId: string; amountCents: Cents }

type CommissionVatChoice = 'included' | 'later' | 'none'

// ─── Precarga de descuentos ──────────────────────────────────────────────────

/**
 * Descuentos precargados con las tasas del partícipe sobre el bruto («estimado:
 * corregilo con la liquidación», H.10): comisión, IVA de la comisión (21 % de
 * la comisión), retenciones y SIRCUPA. Solo los que dan más que cero.
 */
export function prefillDeductions(
  grossCents: Cents,
  rates: PartyRates,
): Array<{ taxKind: DeductionKind; amountCents: Cents }> {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) return []
  const bp = (value: number | null) =>
    value !== null && Number.isSafeInteger(value) && value > 0 ? value : 0
  const commission = percentOf(grossCents, bp(rates.commissionBp))
  const out: Array<{ taxKind: DeductionKind; amountCents: Cents }> = [
    { taxKind: 'comision', amountCents: commission },
    { taxKind: 'iva_comision', amountCents: percentOf(commission, 2100) },
    { taxKind: 'ret_iva', amountCents: percentOf(grossCents, bp(rates.vatWithholdingBp)) },
    { taxKind: 'ret_iibb', amountCents: percentOf(grossCents, bp(rates.iibbWithholdingBp)) },
    { taxKind: 'sircupa', amountCents: percentOf(grossCents, bp(rates.sircupaBp)) },
    {
      taxKind: 'ret_ganancias',
      amountCents: percentOf(grossCents, bp(rates.incomeTaxWithholdingBp)),
    },
  ]
  return out.filter((d) => d.amountCents > 0)
}

// ─── Cuentas de las deducciones ──────────────────────────────────────────────

const FIXED_DEDUCTION_KEYS: Partial<Record<DeductionKind, SystemAccountKey>> = {
  percepcion_iva_comision: 'vat_perceptions',
  ret_iva: 'vat_withholdings',
  ret_iibb: 'iibb_withholdings',
  sircupa: 'iibb_sircupa',
  ret_ganancias: 'income_tax_withholdings',
  diferencia: 'reconciliation_differences',
}

/** La cuenta de una deducción (matriz C.3.4) y si lleva partícipe (el IVA a documentar es partida). */
function deductionTarget(
  d: DeductionInput,
  party: PartyInfo,
  vatChoice: CommissionVatChoice,
  vatComputable: boolean,
  ctx: PostingContext,
): { accountId: string; partyRef: PartyKey | null } | null {
  const commission = ctx.sys[commissionKeyFor(party.kind)].id
  switch (d.taxKind) {
    case 'comision':
      return { accountId: commission, partyRef: null }
    case 'iva_comision':
      if (vatChoice === 'later') {
        return { accountId: ctx.sys.vat_credit_pending.id, partyRef: party.key }
      }
      if (vatChoice === 'included' && vatComputable) {
        return { accountId: ctx.sys.vat_credit.id, partyRef: null }
      }
      return { accountId: commission, partyRef: null }
    case 'otro':
      return d.accountId ? { accountId: d.accountId, partyRef: null } : null
    default: {
      const key = FIXED_DEDUCTION_KEYS[d.taxKind]
      return key ? { accountId: ctx.sys[key].id, partyRef: null } : null
    }
  }
}

// ─── Cobro ───────────────────────────────────────────────────────────────────

export type ComposeCollectionOptions = {
  ref: string
  /** Partidas del mismo bundle (cierre del día) que se aplican solas con lo que no cubren las elegidas. */
  bundleItems?: readonly BundleItem[]
  /** Arqueo de billetera (E.5.8): contado y saldo de libro que vio la persona. */
  balanceCheck?: { countedCents: Cents; expectedBookCents: Cents }
  /**
   * Rótulo del cobro en la descripción y en la leyenda de la caja (el arqueo de
   * billetera dice «Ajuste de saldo de Mercado Pago SAS»); por defecto, «Cobro».
   */
  descriptionPrefix?: string
}

export type ComposedCollection = {
  doc: ProposedDocument
  controlLineNo: number | null
  allocations: ProposedAllocation[]
  errors: PostingError[]
  warnings: PostingWarning[]
}

/** El documento `collection` con sus imputaciones (sin validar todavía). */
export function composeCollection(
  core: CollectionCore,
  ctx: PostingContext,
  opts: ComposeCollectionOptions,
): { ok: true; value: ComposedCollection } | { ok: false; errors: PostingError[] } {
  const fatal = centsIssues([
    ...core.applications.map((a, i) => [`applications.${i}.amountCents`, a.amountCents] as const),
    ...core.creditsUsed.map((a, i) => [`creditsUsed.${i}.amountCents`, a.amountCents] as const),
    ['grossCents', core.grossCents] as const,
    ...core.deductions.map((d, i) => [`deductions.${i}.amountCents`, d.amountCents] as const),
    ...core.received.map((r, i) => [`received.${i}.amountCents`, r.amountCents] as const),
    ['writeOffCents', core.writeOffCents] as const,
  ])
  const party = partyInfo({ id: core.partyId }, ctx)
  if (!party) fatal.push(postingError('party_not_found', 'partyId'))
  const apps = resolveItems(core.applications, ctx, {
    partyId: core.partyId,
    side: 'debit',
    field: 'applications',
  })
  const credits = resolveItems(core.creditsUsed, ctx, {
    partyId: core.partyId,
    side: 'credit',
    field: 'creditsUsed',
  })
  fatal.push(...apps.errors, ...credits.errors)
  const received: Array<{ treasury: TreasuryRef; amountCents: Cents; reference: string | null }> =
    []
  core.received.forEach((r, i) => {
    const treasury = ctx.treasuries.get(r.treasuryAccountId)
    if (!treasury) fatal.push(postingError('treasury_mismatch', `received.${i}.treasuryAccountId`))
    else received.push({ treasury, amountCents: r.amountCents, reference: r.reference })
  })
  if (fatal.length > 0 || !party) return { ok: false, errors: fatal }

  const vatChoice: CommissionVatChoice = core.commissionVoucher.mode
  const voucher = core.commissionVoucher.mode === 'included' ? core.commissionVoucher : null
  const vatComputable = voucher
    ? isVatComputable(voucher.voucherType, party.ivaCondition, ctx.settings.ivaCondition)
    : false

  const deductions: Array<{ d: DeductionInput; accountId: string; partyRef: PartyKey | null }> = []
  for (const [i, d] of core.deductions.entries()) {
    const target = deductionTarget(d, party, vatChoice, vatComputable, ctx)
    if (!target)
      return { ok: false, errors: [postingError('account_not_found', `deductions.${i}.accountId`)] }
    deductions.push({ d, ...target })
  }

  const errors: PostingError[] = []
  const warnings: PostingWarning[] = []

  // Una sola cuenta de control: la de las partidas elegidas, o la «nos debe» del partícipe.
  const accounts = [...new Set([...apps.items, ...credits.items].map((r) => r.item.accountId))]
  if (accounts.length > 1) errors.push(postingError('mixed_control_accounts', 'applications'))
  const controlAccountId = accounts[0] ?? party.receivableAccountId

  const R = sumCents(received.map((r) => r.amountCents))
  const D = sumCents(deductions.map((x) => x.d.amountCents))
  const W = core.writeOffCents
  const G = R + D + W
  const A = sumCents(apps.items.map((r) => r.amountCents))
  const C = sumCents(credits.items.map((r) => r.amountCents))
  const bundleItems = (opts.bundleItems ?? []).filter(
    (b) => b.partyId === core.partyId && b.accountId === controlAccountId,
  )
  if (core.grossCents !== null && core.grossCents !== G) {
    errors.push(
      postingError('total_mismatch', 'grossCents', {
        computed_cents: G,
        control_cents: core.grossCents,
      }),
    )
  }
  if (G <= 0) errors.push(postingError('amount_required', 'received'))
  // Un saldo a favor solo se usa contra algo que cancela: lo elegido o, en el cierre del día, sus partidas.
  const bundleCapacity = sumCents(bundleItems.map((b) => b.amountCents))
  if (C > 0 && ((apps.items.length === 0 && bundleItems.length === 0) || C > A + bundleCapacity)) {
    errors.push(postingError('credit_without_application', 'creditsUsed'))
  }
  if (A > G + C) {
    errors.push(postingError('allocation_exceeds_open', 'applications', { open_cents: G + C }))
  }

  // ── Renglones ──
  const lines = new DocLineBuilder()
  for (const r of received) {
    lines.add({
      role: 'treasury',
      accountId: r.treasury.accountId,
      side: 'debit',
      amountCents: r.amountCents,
      treasuryAccountId: r.treasury.id,
      reference: r.reference,
      memo: opts.descriptionPrefix ?? r.treasury.name,
    })
  }
  for (const { d, accountId, partyRef } of deductions) {
    const taxKind: TaxKind = d.taxKind
    lines.add({
      role: 'deduction',
      accountId,
      side: 'debit',
      amountCents: d.amountCents,
      partyRef,
      taxKind,
      certificateNumber: d.certificateNumber,
      salesMethodId: d.salesMethodId,
      memo: memoFor('deduction', { taxKind }),
    })
  }
  lines.add({
    role: 'write_off',
    accountId: ctx.sys.fees_other.id,
    side: 'debit',
    amountCents: W,
    memo: memoFor('write_off'),
  })
  lines.add({
    role: 'control',
    accountId: controlAccountId,
    side: 'credit',
    amountCents: G,
    partyRef: party.key,
    memo: `Cobro de ${party.displayName}`,
    tag: 'control',
  })
  const built = lines.build()
  const controlLineNo = built.lineNoOf('control')

  // ── Imputaciones: las elegidas y, en el cierre del día, las partidas del mismo bundle ──
  const applications = apps.items.map((r) => ({
    key: { lineId: r.lineId } as LineKey,
    amountCents: r.amountCents,
  }))
  let room = G + C - A
  for (const item of bundleItems) {
    if (room <= 0) break
    const take = Math.min(room, item.amountCents)
    applications.push({ key: item.key, amountCents: take })
    room -= take
  }
  const allocations =
    controlLineNo === null
      ? []
      : planCollectionAllocation({
          own: { key: { doc: opts.ref, lineNo: controlLineNo }, amountCents: G },
          applications,
          credits: credits.items.map((r) => ({
            key: { lineId: r.lineId },
            amountCents: r.amountCents,
            entryDate: r.item.entryDate,
          })),
        })

  // ── Comprobante de la comisión en el libro IVA compras ──
  const fiscalVouchers: FiscalVoucher[] = []
  if (voucher) {
    const sumOf = (kind: DeductionKind, onlyVatCredit = false) =>
      sumCents(
        deductions
          .filter(
            (x) =>
              x.d.taxKind === kind && (!onlyVatCredit || x.accountId === ctx.sys.vat_credit.id),
          )
          .map((x) => x.d.amountCents),
      )
    const commission = sumOf('comision')
    const vat = sumOf('iva_comision')
    const perception = sumOf('percepcion_iva_comision')
    if (commission + vat + perception > 0) {
      fiscalVouchers.push({
        book: 'purchases',
        voucherType: voucher.voucherType,
        afipVoucherCode: afipVoucherCode(voucher.voucherType),
        isCreditNote: false,
        voucherDate: voucher.issueDate,
        pointOfSale: voucher.pointOfSale,
        numberFrom: voucher.number,
        numberTo: null,
        channel: null,
        counterparty: counterpartyFor(party),
        amounts: fiscalAmounts({
          net_21_cents: commission,
          vat_21_cents: vat,
          perc_iva_cents: perception,
          total_cents: commission + vat + perception,
          vat_computable_cents: sumOf('iva_comision', true),
        }),
      })
    }
  }

  const doc = proposedDocument({
    ref: opts.ref,
    kind: 'collection',
    voucherType: voucher?.voucherType ?? null,
    afipVoucherCode: voucher ? afipVoucherCode(voucher.voucherType) : null,
    party: party.key,
    issueDate: core.date,
    accountingDate: core.date,
    pointOfSale: voucher?.pointOfSale ?? null,
    number: voucher?.number ?? null,
    description: descriptionFor('collection', opts.descriptionPrefix ?? 'Cobro', party.displayName),
    notes: core.notes,
    totalCents: G,
    controlAccountId,
    countedCents: opts.balanceCheck?.countedCents ?? null,
    expectedBookCents: opts.balanceCheck?.expectedBookCents ?? null,
    warningsAck: ackList(core.warningsAck),
    lines: built.lines,
    fiscalVouchers,
  })
  return { ok: true, value: { doc, controlLineNo, allocations, errors, warnings } }
}

/** Cobranza o acreditación (E.5.7: E9, E10, E10b, E10c, E16). */
export function buildCollection(
  input: CollectionBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const composed = composeCollection(input, ctx, { ref: 'd1' })
  if (!composed.ok) return failed(composed.errors)
  const { doc, allocations, errors, warnings } = composed.value
  return finalize(bundleOf(meta, [doc], allocations), ctx, meta, { errors, warnings })
}

// ─── «Ajustar saldo de Mercado Pago» (E.5.8) ────────────────────────────────

/** Cuenta de reparto de un descuento de billetera cuando no hay partidas (arqueo, C.3.4). */
function walletSplit(
  d: WalletCheckBuildInput['breakdown'][number],
  party: PartyInfo,
  ctx: PostingContext,
): AdjustmentSplit {
  const partyId = 'id' in party.key ? party.key.id : null
  switch (d.taxKind) {
    case 'comision':
      return {
        accountId: ctx.sys.fees_wallets.id,
        amountCents: d.amountCents,
        taxKind: 'comision',
        partyId: null,
      }
    case 'iva_comision':
      return party.commissionVatMode === 'none'
        ? {
            accountId: ctx.sys.fees_wallets.id,
            amountCents: d.amountCents,
            taxKind: 'iva_comision',
            partyId: null,
          }
        : {
            accountId: ctx.sys.vat_credit_pending.id,
            amountCents: d.amountCents,
            taxKind: 'iva_comision',
            partyId,
          }
    case 'sircupa':
      return {
        accountId: ctx.sys.iibb_sircupa.id,
        amountCents: d.amountCents,
        taxKind: 'sircupa',
        partyId: null,
      }
    case 'otro':
      return {
        accountId: d.accountId ?? ctx.sys.reconciliation_differences.id,
        amountCents: d.amountCents,
        taxKind: 'otro',
        partyId: null,
      }
    default: {
      const key = FIXED_DEDUCTION_KEYS[d.taxKind] ?? 'reconciliation_differences'
      return {
        accountId: ctx.sys[key].id,
        amountCents: d.amountCents,
        taxKind: d.taxKind,
        partyId: null,
      }
    }
  }
}

/**
 * «¿Cuánto hay en Mercado Pago ahora?» contra el saldo de libro y las partidas
 * a acreditar (E.5.8, E17). `entró = contado − libro`; `descuentos = partidas −
 * entró`; el desglose del reporte de Mercado Pago explica los descuentos y lo
 * que no se explica va a «Diferencias de cobro a conciliar» (nunca a créditos
 * fiscales).
 *
 * - Con partidas y descuentos ≥ desglose: un `collection` con el arqueo.
 * - Con partidas y entró más que lo pendiente (rendimientos):
 *   `[collection, treasury_adjustment]`; el excedente va a intereses y
 *   rendimientos. Los dos llevan su chequeo encadenado: el cobro va de
 *   `libro` a `libro + lo acreditado` y el ajuste de ahí a lo contado.
 * - Sin partidas: un `treasury_adjustment` de la billetera.
 */
export function buildWalletCheck(
  input: WalletCheckBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = [
    ...signedCentsIssues([
      ['countedCents', input.countedCents],
      ['expectedBookCents', input.expectedBookCents],
    ]),
    ...centsIssues([
      ...input.items.map((it, i) => [`items.${i}.amountCents`, it.amountCents] as const),
      ...input.breakdown.map((d, i) => [`breakdown.${i}.amountCents`, d.amountCents] as const),
    ]),
  ]
  const treasury = ctx.treasuries.get(input.treasuryAccountId)
  if (!treasury) fatal.push(postingError('treasury_mismatch', 'treasuryAccountId'))
  const partyId = input.partyId ?? treasury?.bankPartyId ?? null
  if (!partyId) fatal.push(postingError('party_required', 'partyId'))
  const party = partyId ? partyInfo({ id: partyId }, ctx) : null
  if (partyId && !party) fatal.push(postingError('party_not_found', 'partyId'))
  if (fatal.length > 0 || !treasury || !party || !partyId) return failed(fatal)
  const items = resolveItems(input.items, ctx, { partyId, side: 'debit', field: 'items' })
  if (items.errors.length > 0) return failed(items.errors)

  const entered = input.countedCents - input.expectedBookCents
  const pending = sumCents(items.items.map((r) => r.amountCents))
  const explained = sumCents(input.breakdown.map((d) => d.amountCents))
  const label = `Ajuste de saldo de ${treasury.name}`

  // Sin partidas: la diferencia es un arqueo de la billetera.
  if (items.items.length === 0) {
    if (entered === 0) return failed([postingError('amount_required', 'countedCents')])
    let splits: AdjustmentSplit[]
    if (entered < 0) {
      splits = input.breakdown.map((d) => walletSplit(d, party, ctx))
      const rest = -entered - explained
      if (rest < 0) return failed([postingError('balance_check_mismatch', 'breakdown')])
      if (rest > 0) {
        splits.push({
          accountId: ctx.sys.reconciliation_differences.id,
          amountCents: rest,
          taxKind: 'diferencia',
          partyId: null,
        })
      }
    } else {
      if (input.breakdown.length > 0)
        return failed([postingError('balance_check_mismatch', 'breakdown')])
      splits = [
        {
          accountId: ctx.sys.interest_income.id,
          amountCents: entered,
          taxKind: 'rendimiento',
          partyId: null,
        },
      ]
    }
    const adjustment = composeTreasuryAdjustment(
      {
        ref: 'd1',
        treasury,
        date: input.date,
        countedCents: input.countedCents,
        expectedBookCents: input.expectedBookCents,
        splits,
        notes: null,
        warningsAck: input.warningsAck,
      },
      ctx,
    )
    if (!adjustment.ok) return failed(adjustment.errors)
    return finalize(bundleOf(meta, [adjustment.value.doc]), ctx, meta, {
      errors: adjustment.value.errors,
    })
  }

  const unexplained = pending - entered - explained
  const vatChoice: 'later' | 'none' = party.commissionVatMode === 'none' ? 'none' : 'later'
  const breakdown = input.breakdown.map((d) => ({ ...d }))
  const base = {
    partyId,
    date: input.date,
    applications: input.items,
    creditsUsed: [],
    grossCents: null,
    writeOffCents: 0,
    commissionVoucher: { mode: vatChoice },
    notes: null,
    warningsAck: input.warningsAck,
  } satisfies Omit<CollectionCore, 'deductions' | 'received'>

  if (unexplained >= 0) {
    if (entered < 0) return failed([postingError('balance_check_mismatch', 'countedCents')])
    const deductions =
      unexplained > 0
        ? [
            ...breakdown,
            {
              taxKind: 'diferencia' as const,
              amountCents: unexplained,
              accountId: null,
              certificateNumber: null,
              salesMethodId: null,
            },
          ]
        : breakdown
    const composed = composeCollection(
      {
        ...base,
        deductions,
        received:
          entered > 0
            ? [{ treasuryAccountId: treasury.id, amountCents: entered, reference: null }]
            : [],
      },
      ctx,
      {
        ref: 'd1',
        balanceCheck: {
          countedCents: input.countedCents,
          expectedBookCents: input.expectedBookCents,
        },
        descriptionPrefix: label,
      },
    )
    if (!composed.ok) return failed(composed.errors)
    const { doc, allocations, errors, warnings } = composed.value
    return finalize(bundleOf(meta, [doc], allocations), ctx, meta, { errors, warnings })
  }

  // Entró más que lo pendiente: el cobro acredita las partidas y el excedente es un ajuste aparte.
  const credited = pending - explained
  if (credited < 0) return failed([postingError('balance_check_mismatch', 'breakdown')])
  const midBalance = input.expectedBookCents + credited
  const composed = composeCollection(
    {
      ...base,
      deductions: breakdown,
      received:
        credited > 0
          ? [{ treasuryAccountId: treasury.id, amountCents: credited, reference: null }]
          : [],
    },
    ctx,
    {
      ref: 'd1',
      balanceCheck: { countedCents: midBalance, expectedBookCents: input.expectedBookCents },
      descriptionPrefix: label,
    },
  )
  if (!composed.ok) return failed(composed.errors)
  const adjustment = composeTreasuryAdjustment(
    {
      ref: 'd2',
      treasury,
      date: input.date,
      countedCents: input.countedCents,
      expectedBookCents: midBalance,
      splits: [
        {
          accountId: ctx.sys.interest_income.id,
          amountCents: -unexplained,
          taxKind: 'rendimiento',
          partyId: null,
        },
      ],
      notes: null,
      warningsAck: input.warningsAck,
    },
    ctx,
  )
  if (!adjustment.ok) return failed(adjustment.errors)
  const { doc, allocations, errors, warnings } = composed.value
  return finalize(bundleOf(meta, [doc, adjustment.value.doc], allocations), ctx, meta, {
    errors: [...errors, ...adjustment.value.errors],
    warnings,
  })
}
