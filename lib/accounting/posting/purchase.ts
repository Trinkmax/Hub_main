/**
 * Compras: factura, ND, tique, recibo y DDJJ (`purchase`, `purchase_debit_note`,
 * E.5.1) y nota de crédito de proveedor (`purchase_credit_note`, E.5.2).
 *
 * **Asiento:** D cada imputación {net/gross/non_taxed/exempt/internal_tax} ·
 * D `vat_credit` {vat, si computa; si no, la cuenta del neto} · D percepciones
 * {perception} · D otros tributos {other_tax} · H control `[proveedor]`
 * {control, por el total, con vencimiento → partida}. La NC da vuelta todos los
 * lados y pone el proveedor primero (E6).
 *
 * **Importes:** en modo «Total» el neto sale del total (`netFromGross`) y el
 * IVA es la diferencia, con ±1¢; las percepciones y otros tributos se restan
 * antes (son parte del total de la factura). En modo «Detalle» las filas de neto
 * de la misma cuenta y alícuota se juntan, y el IVA va por alícuota sobre la
 * suma de los netos (E.4, regla 2).
 *
 * **Libro IVA compras:** una fila por comprobante; en B, C y tiques lo gravado
 * va a «IVA no discriminado»; `vat_computable` = IVA si computa (el tipo
 * discrimina, el partícipe es RI y la SAS también).
 *
 * **Factura mensual de comisiones** (`settles_commissions`): no crea deuda,
 * solo pasa el IVA a crédito fiscal: D `vat_credit` / H `vat_credit_pending
 * [plataforma]`, y la partida H se imputa FIFO contra las partidas «a
 * documentar» de la plataforma que trae el contexto (E10).
 *
 * E1 · Factura A 0003-00001290 de Coca-Cola: D 5.1.01.01.002 71.074.380 /
 * D IVA CF 14.925.620 / H Proveedores [Coca-Cola] 86.000.000, vence 24/10.
 */

import {
  ALIQUOT_COLUMNS,
  checkVat,
  distributeProportionally,
  netFromGross,
  vatFromNet,
} from '@/lib/accounting/iva'
import {
  accountingDateFor,
  ackList,
  addDaysSafe,
  type BuildMeta,
  bundleOf,
  centsIssues,
  counterpartyFor,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  fiscalAmounts,
  flipSide,
  memoFor,
  NEW_PARTY_REF,
  newPartyFrom,
  nextDayOfMonthOnOrAfter,
  type PartyInfo,
  partyInfo,
  postingError,
  postingWarning,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import { composeSimplePayment } from '@/lib/accounting/posting/payment'
import type { PurchaseInput } from '@/lib/accounting/schemas'
import type {
  Cents,
  FiscalAmountKey,
  FiscalVoucher,
  FiscalVoucherType,
  IsoDate,
  NewParty,
  PartyKey,
  PostingContext,
  PostingError,
  PostingResult,
  PostingWarning,
  ProposedAllocation,
  ProposedDocument,
  Side,
  TaxKind,
  VatRateBp,
} from '@/lib/accounting/types'
import { VAT_RATE_VALUES } from '@/lib/accounting/types'
import {
  afipVoucherCode,
  isVatComputable,
  VOUCHER_CATALOG,
  voucherDisplay,
} from '@/lib/accounting/voucher-types'

export type PurchaseBuildInput = Omit<PurchaseInput, 'clientRef' | 'previewHash'>

/** Alícuota por defecto de la factura mensual de comisiones en modo «Total» (las comisiones van al 21 %). */
const COMMISSIONS_DEFAULT_RATE: VatRateBp = 2100

type ImputationRole = 'net' | 'gross' | 'non_taxed' | 'exempt' | 'internal_tax'
type Row = {
  role: ImputationRole
  accountId: string
  amountCents: Cents
  vatRateBp: VatRateBp | null
}
type VatOfRate = { rate: VatRateBp; base: Cents; given: Cents; field: string }

const PERCEPTION_KEYS = {
  iva: 'vat_perceptions',
  iibb: 'iibb_perceptions',
  ganancias: 'income_tax_perceptions',
  municipal: 'other_taxes_expense',
} as const

const PERCEPTION_COLUMNS = {
  iva: 'perc_iva_cents',
  iibb: 'perc_iibb_cents',
  ganancias: 'perc_ganancias_cents',
  municipal: 'perc_municipal_cents',
} as const satisfies Record<keyof typeof PERCEPTION_KEYS, FiscalAmountKey>

const ROW_COLUMNS: Readonly<Record<Exclude<ImputationRole, 'net'>, FiscalAmountKey>> = {
  gross: 'undiscriminated_cents',
  non_taxed: 'non_taxed_cents',
  exempt: 'exempt_cents',
  internal_tax: 'internal_taxes_cents',
}

export type ComposedPurchase = {
  doc: ProposedDocument
  newParties: NewParty[]
  party: PartyInfo
  /** La cuenta de control (proveedores o el impuesto a pagar); `null` en la factura de comisiones. */
  controlAccountId: string | null
  /** `line_no` de la partida del proveedor; `null` en la factura de comisiones. */
  controlLineNo: number | null
  /** Imputaciones propias (FIFO de «IVA a documentar» en la factura de comisiones). */
  allocations: ProposedAllocation[]
  /** Errores que no impiden armar el asiento (total de control, IVA fuera de tolerancia). */
  errors: PostingError[]
  warnings: PostingWarning[]
}

function ratesAscending(rates: Iterable<VatRateBp>): VatRateBp[] {
  const set = new Set(rates)
  return VAT_RATE_VALUES.filter((r) => set.has(r))
}

/** El documento de compra (sin validar todavía); lo usan «Guardar y pagar» y «Nuevo gasto». */
export function composePurchase(
  input: PurchaseBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
  ref = 'd1',
): { ok: true; value: ComposedPurchase } | { ok: false; errors: PostingError[] } {
  const fatal = centsIssues([
    ['total.totalCents', input.total?.totalCents],
    ...input.lines.map((l, i) => [`lines.${i}.amountCents`, l.amountCents] as const),
    ...input.vat.map((v, i) => [`vat.${i}.givenCents`, v.givenCents] as const),
    ...input.perceptions.map((p, i) => [`perceptions.${i}.amountCents`, p.amountCents] as const),
    ...input.otherTaxes.map((o, i) => [`otherTaxes.${i}.amountCents`, o.amountCents] as const),
    ['controlTotalCents', input.controlTotalCents],
    ['payNow.amountCents', input.payNow?.amountCents],
  ])

  // Partícipe: existente o nuevo en línea (la RPC lo inserta primero).
  const newParties: NewParty[] = []
  let partyKey: PartyKey | null = null
  if (input.partyId) partyKey = { id: input.partyId }
  else if (input.newParty) {
    const fallbackAccount = input.total?.accountId ?? input.lines[0]?.accountId ?? null
    newParties.push(newPartyFrom(input.newParty, fallbackAccount))
    partyKey = { ref: NEW_PARTY_REF }
  }
  if (!partyKey) fatal.push(postingError('party_required', 'partyId'))
  const party = partyKey ? partyInfo(partyKey, ctx, newParties) : null
  if (partyKey && !party) fatal.push(postingError('party_not_found', 'partyId'))

  const info = VOUCHER_CATALOG[input.voucherType]
  if (info.numbered && (input.pointOfSale === null || input.number === null)) {
    fatal.push(postingError('voucher_number_required', 'number'))
  }
  if (input.amountMode === 'total' && input.total === null) {
    fatal.push(postingError('amount_required', 'total.totalCents'))
  }
  if (input.lines.some((l) => l.role === 'net' && l.vatRateBp === null)) {
    fatal.push(postingError('invalid_bundle', 'lines', { reason: 'net_without_rate' }))
  }
  if (fatal.length > 0 || !party) return { ok: false, errors: fatal }

  const errors: PostingError[] = []
  const warnings: PostingWarning[] = []
  const isCredit = input.docKind === 'purchase_credit_note'
  const discriminates = info.purchaseVat !== 'no'
  const computable = isVatComputable(
    input.voucherType,
    party.ivaCondition,
    ctx.settings.ivaCondition,
  )
  const perceptionsTotal = sumCents(input.perceptions.map((p) => p.amountCents))
  const otherTaxesTotal = sumCents(input.otherTaxes.map((o) => o.amountCents))
  // La factura de comisiones solo mueve IVA (C.3.4): una percepción ahí no tendría dónde ir.
  if (input.settlesCommissions && (input.perceptions.length > 0 || input.otherTaxes.length > 0)) {
    errors.push(postingError('invalid_bundle', 'perceptions', { reason: 'commissions_extras' }))
  }

  // ── Imputaciones e IVA por alícuota ──
  const rows: Row[] = []
  const vatByRate = new Map<VatRateBp, VatOfRate>()
  if (input.amountMode === 'total' && input.total) {
    const t = input.total
    const taxable = t.totalCents - perceptionsTotal - otherTaxesTotal
    if (taxable < 0) {
      return {
        ok: false,
        errors: [
          postingError('total_mismatch', 'total.totalCents', {
            computed_cents: perceptionsTotal + otherTaxesTotal,
            control_cents: t.totalCents,
          }),
        ],
      }
    }
    const rate = t.vatRateBp ?? (input.settlesCommissions ? COMMISSIONS_DEFAULT_RATE : null)
    if ((discriminates || input.settlesCommissions) && rate !== null) {
      const splitNet = netFromGross(taxable, rate)
      const given = taxable - splitNet + (rate === 0 ? 0 : t.vatAdjustCents)
      if (given < 0 || given > taxable) {
        return {
          ok: false,
          errors: [postingError('vat_out_of_tolerance', 'total.vatAdjustCents', { rate_bp: rate })],
        }
      }
      rows.push({
        role: 'net',
        accountId: t.accountId,
        amountCents: taxable - given,
        vatRateBp: rate,
      })
      if (rate !== 0) {
        vatByRate.set(rate, { rate, base: taxable - given, given, field: 'total.vatAdjustCents' })
      }
    } else {
      rows.push({ role: 'gross', accountId: t.accountId, amountCents: taxable, vatRateBp: null })
    }
  } else {
    for (const l of input.lines) {
      if (l.role === 'net') {
        const same = rows.find(
          (r) => r.role === 'net' && r.accountId === l.accountId && r.vatRateBp === l.vatRateBp,
        )
        if (same) same.amountCents += l.amountCents
        else
          rows.push({
            role: 'net',
            accountId: l.accountId,
            amountCents: l.amountCents,
            vatRateBp: l.vatRateBp,
          })
      } else {
        rows.push({
          role: l.role,
          accountId: l.accountId,
          amountCents: l.amountCents,
          vatRateBp: null,
        })
      }
    }
    const netRates = ratesAscending(
      rows.flatMap((r) =>
        r.role === 'net' && r.vatRateBp !== null && r.vatRateBp !== 0 ? [r.vatRateBp] : [],
      ),
    )
    for (const rate of netRates) {
      const base = sumCents(
        rows.filter((r) => r.role === 'net' && r.vatRateBp === rate).map((r) => r.amountCents),
      )
      const index = input.vat.findIndex((v) => v.vatRateBp === rate)
      const override = input.vat[index]
      const given = override?.givenCents ?? vatFromNet(base, rate) + (override?.adjustCents ?? 0)
      const field = index >= 0 ? `vat.${index}` : 'lines'
      if (given < 0) {
        return {
          ok: false,
          errors: [postingError('vat_out_of_tolerance', field, { rate_bp: rate })],
        }
      }
      vatByRate.set(rate, { rate, base, given, field })
    }
  }

  // IVA impreso contra el calculado: ±tolerancia pasa, hasta max($ 1; 1 %) con aviso, más es error.
  for (const v of vatByRate.values()) {
    const computed = vatFromNet(v.base, v.rate)
    const check = checkVat(v.base, v.rate, v.given, ctx.settings.vatToleranceCents)
    if (check === 'warn') {
      warnings.push(
        postingWarning('vat_diff', ref, {
          rate_bp: v.rate,
          diff_cents: Math.abs(v.given - computed),
        }),
      )
    } else if (check === 'error') {
      errors.push(postingError('vat_out_of_tolerance', v.field, { rate_bp: v.rate }))
    }
  }

  // ── Renglones ──
  const imputationSide: Side = isCredit ? 'credit' : 'debit'
  const controlSide = flipSide(imputationSide)
  const label =
    input.pointOfSale !== null && input.number !== null
      ? voucherDisplay(input.voucherType, input.pointOfSale, input.number)
      : info.label
  const controlAccountId = input.settlesCommissions
    ? null
    : (input.controlAccountId ?? party.payableAccountId)
  const lines = new DocLineBuilder()
  const vatTotal = sumCents([...vatByRate.values()].map((v) => v.given))
  const rowsTotal = sumCents(rows.map((r) => r.amountCents))
  const total = rowsTotal + vatTotal + perceptionsTotal + otherTaxesTotal

  let dueDate: IsoDate | null = null
  if (input.settlesCommissions) {
    for (const v of ratesAscending(vatByRate.keys()).map((r) => vatByRate.get(r) as VatOfRate)) {
      lines.add({
        role: 'vat',
        accountId: ctx.sys.vat_credit.id,
        side: imputationSide,
        amountCents: v.given,
        vatRateBp: v.rate,
        baseCents: v.base,
        vatComputedCents: vatFromNet(v.base, v.rate),
        taxKind: 'iva',
        memo: memoFor('vat', { rateBp: v.rate }),
      })
    }
    lines.add({
      role: 'vat_pending_release',
      accountId: ctx.sys.vat_credit_pending.id,
      side: controlSide,
      amountCents: vatTotal,
      partyRef: party.key,
      memo: memoFor('vat_pending_release', { label: `${label} (comisiones)` }),
      tag: 'release',
    })
  } else {
    for (const row of rows) {
      const account = ctx.accounts.get(row.accountId)
      lines.add({
        role: row.role,
        accountId: row.accountId,
        side: imputationSide,
        amountCents: row.amountCents,
        vatRateBp: row.role === 'net' ? row.vatRateBp : null,
        baseCents: row.role === 'net' ? row.amountCents : null,
        memo:
          row.role === 'net'
            ? memoFor('net', { rateBp: row.vatRateBp })
            : memoFor(row.role, { label: account?.name }),
      })
    }
    for (const v of ratesAscending(vatByRate.keys()).map((r) => vatByRate.get(r) as VatOfRate)) {
      const nets = rows.filter((r) => r.role === 'net' && r.vatRateBp === v.rate)
      const vatLine = (accountId: string, amountCents: Cents, base: Cents) =>
        lines.add({
          role: 'vat',
          accountId,
          side: imputationSide,
          amountCents,
          vatRateBp: v.rate,
          baseCents: base,
          vatComputedCents: vatFromNet(base, v.rate),
          taxKind: 'iva',
          memo: memoFor('vat', { rateBp: v.rate }),
        })
      const first = nets[0]
      if (computable || !first) vatLine(ctx.sys.vat_credit.id, v.given, v.base)
      else if (nets.length === 1) vatLine(first.accountId, v.given, v.base)
      else {
        // El IVA que no computa va al costo de cada imputación, repartido por su neto.
        const parts = distributeProportionally(
          v.given,
          nets.map((n) => n.amountCents),
        )
        nets.forEach((n, i) => {
          vatLine(n.accountId, parts[i] ?? 0, n.amountCents)
        })
      }
    }
    for (const p of input.perceptions) {
      const taxKind: TaxKind = p.taxKind
      lines.add({
        role: 'perception',
        accountId: ctx.sys[PERCEPTION_KEYS[p.taxKind]].id,
        side: imputationSide,
        amountCents: p.amountCents,
        taxKind,
        jurisdictionCode: p.taxKind === 'iibb' ? p.jurisdictionCode : null,
        memo: memoFor('perception', { taxKind, jurisdictionCode: p.jurisdictionCode }),
      })
    }
    for (const o of input.otherTaxes) {
      lines.add({
        role: 'other_tax',
        accountId: o.accountId,
        side: imputationSide,
        amountCents: o.amountCents,
        taxKind: 'otro',
        memo: memoFor('other_tax', { label: ctx.accounts.get(o.accountId)?.name }),
      })
    }

    if (input.dueDate) dueDate = input.dueDate
    else if (isCredit) dueDate = null
    else if (
      input.voucherType === 'ddjj_impuesto' &&
      controlAccountId === ctx.sys.iibb_payable.id
    ) {
      dueDate = nextDayOfMonthOnOrAfter(input.issueDate, ctx.settings.iibbDueDay)
    } else dueDate = addDaysSafe(input.issueDate, party.paymentTermDays)

    lines.add({
      role: 'control',
      accountId: controlAccountId ?? party.payableAccountId,
      side: controlSide,
      amountCents: total,
      partyRef: party.key,
      dueDate,
      memo: label,
      tag: 'control',
    })
  }
  const built = lines.build({ debitFirst: isCredit })

  if (input.controlTotalCents !== null && input.controlTotalCents !== total) {
    errors.push(
      postingError('total_mismatch', 'controlTotalCents', {
        computed_cents: total,
        control_cents: input.controlTotalCents,
      }),
    )
  }

  // ── Libro IVA compras ──
  const fiscalVouchers: FiscalVoucher[] = []
  if (info.ivaBook && input.pointOfSale !== null && input.number !== null) {
    const amounts: Partial<Record<FiscalAmountKey, Cents>> = {}
    const put = (key: FiscalAmountKey, cents: Cents) => {
      amounts[key] = (amounts[key] ?? 0) + cents
    }
    for (const row of rows) {
      if (row.role === 'net') put(ALIQUOT_COLUMNS[row.vatRateBp ?? 0].net, row.amountCents)
      else put(ROW_COLUMNS[row.role], row.amountCents)
    }
    for (const v of vatByRate.values()) {
      const column = ALIQUOT_COLUMNS[v.rate].vat
      if (column) put(column, v.given)
    }
    for (const p of input.perceptions) put(PERCEPTION_COLUMNS[p.taxKind], p.amountCents)
    put('other_taxes_cents', otherTaxesTotal)
    put('total_cents', total)
    put('vat_computable_cents', input.settlesCommissions || computable ? vatTotal : 0)
    fiscalVouchers.push({
      book: 'purchases',
      voucherType: input.voucherType as FiscalVoucherType,
      afipVoucherCode: afipVoucherCode(input.voucherType),
      isCreditNote: info.isCreditNote,
      voucherDate: input.issueDate,
      pointOfSale: input.pointOfSale,
      numberFrom: input.number,
      numberTo: null,
      channel: null,
      counterparty: counterpartyFor(party),
      amounts: fiscalAmounts(amounts),
    })
  }

  // ── La factura de comisiones libera «IVA a documentar» FIFO ──
  const allocations: ProposedAllocation[] = []
  const releaseLineNo = built.lineNoOf('release')
  if (input.settlesCommissions && releaseLineNo !== null && 'id' in party.key) {
    const partyId = party.key.id
    const pending = [...ctx.openItems.values()]
      .filter(
        (i) =>
          i.partyId === partyId &&
          i.accountId === ctx.sys.vat_credit_pending.id &&
          i.side === 'debit' &&
          i.openCents > 0,
      )
      .sort((a, b) => {
        if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1
        const da = a.dueDate ?? '9999-12-31'
        const db = b.dueDate ?? '9999-12-31'
        if (da !== db) return da < db ? -1 : 1
        return a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0
      })
    let left = vatTotal
    for (const item of pending) {
      if (left === 0) break
      const take = Math.min(left, item.openCents)
      allocations.push({
        debit: { lineId: item.lineId },
        credit: { doc: ref, lineNo: releaseLineNo },
        amountCents: take,
        kind: 'manual',
      })
      left -= take
    }
  }

  const doc = proposedDocument({
    ref,
    kind: input.docKind,
    voucherType: input.voucherType,
    afipVoucherCode: afipVoucherCode(input.voucherType),
    party: party.key,
    issueDate: input.issueDate,
    accountingDate: input.accountingDate ?? accountingDateFor(input.issueDate, meta),
    dueDate,
    pointOfSale: input.pointOfSale,
    number: input.number,
    description: descriptionFor(input.docKind, label, party.displayName),
    notes: input.notes,
    totalCents: total,
    controlAccountId,
    relatedDocument: input.relatedDocumentId ? { id: input.relatedDocumentId } : null,
    recurringExpenseId: input.recurringExpenseId,
    settlesCommissions: input.settlesCommissions,
    warningsAck: ackList(input.warningsAck),
    lines: built.lines,
    fiscalVouchers,
  })
  return {
    ok: true,
    value: {
      doc,
      newParties,
      party,
      controlAccountId,
      controlLineNo: built.lineNoOf('control'),
      allocations,
      errors,
      warnings,
    },
  }
}

/**
 * Compra, ND o NC de proveedor (E.5.1–E.5.2). Con `payNow` («Guardar y pagar»)
 * arma `[purchase, payment]` e imputa el pago a la partida recién creada; con
 * una NC relacionada la imputación la hace sola la RPC (`credit_note`), así que
 * acá no se agrega.
 */
export function buildPurchase(
  input: PurchaseBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const composed = composePurchase(input, ctx, meta)
  if (!composed.ok) return failed(composed.errors)
  const { doc, newParties, party, controlAccountId, controlLineNo, allocations, errors, warnings } =
    composed.value
  const documents: ProposedDocument[] = [doc]
  const allAllocations: ProposedAllocation[] = [...allocations]

  if (input.payNow) {
    if (
      input.docKind === 'purchase_credit_note' ||
      controlAccountId === null ||
      controlLineNo === null
    ) {
      errors.push(postingError('invalid_bundle', 'payNow', { reason: 'pay_not_allowed' }))
    } else {
      const treasury = ctx.treasuries.get(input.payNow.treasuryAccountId)
      if (!treasury) {
        return failed([...errors, postingError('treasury_mismatch', 'payNow.treasuryAccountId')])
      }
      const amount = input.payNow.amountCents ?? doc.totalCents
      const label =
        doc.voucherType && doc.pointOfSale !== null && doc.number !== null
          ? voucherDisplay(doc.voucherType, doc.pointOfSale, doc.number)
          : null
      const payment = composeSimplePayment({
        ref: 'd2',
        party,
        controlAccountId,
        treasury,
        amountCents: amount,
        date: input.payNow.date ?? doc.accountingDate,
        reference: input.payNow.reference,
        notes: input.notes,
        warningsAck: input.warningsAck,
        label,
      })
      documents.push(payment.doc)
      if (payment.controlLineNo !== null) {
        allAllocations.push({
          debit: { doc: 'd2', lineNo: payment.controlLineNo },
          credit: { doc: 'd1', lineNo: controlLineNo },
          amountCents: Math.min(amount, doc.totalCents),
          kind: 'payment',
        })
      }
    }
  }
  return finalize(bundleOf(meta, documents, allAllocations, newParties), ctx, meta, {
    errors,
    warnings,
  })
}

/** Nota de crédito de proveedor (E.5.2, E6): la misma carga con los lados invertidos. */
export function buildPurchaseCreditNote(
  input: PurchaseBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  return buildPurchase({ ...input, docKind: 'purchase_credit_note' }, ctx, meta)
}
