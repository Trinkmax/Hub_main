/**
 * Factura, NC y ND de venta suelta (`sales_invoice`, `sales_credit_note`,
 * `sales_debit_note`, E.5.9): lo que no pasa por el cierre de Thinkeon (eventos
 * facturados aparte, catering, sponsoreo).
 *
 * **Asiento:** D Deudores por ventas `[cliente]` {control, vence emisión +
 * plazo} / H Ventas `<canal>`: facturadas {Σ neto + no gravado + exento; por
 * defecto eventos} / H IVA débito fiscal {uno por alícuota}. La NC es el
 * espejo (las ventas y el IVA al Debe, el cliente al Haber) y la imputación a
 * la factura la hace sola la RPC. «Ya la cobraste» arma `[sales_invoice,
 * collection]` con la imputación.
 *
 * E16 (cont.) · Factura A 0003-00000088 a Empresa X: D Deudores [Empresa X]
 * 72.600.000 / H Ventas eventos: facturadas 60.000.000 / H IVA débito 12.600.000.
 */

import { ALIQUOT_COLUMNS, checkVat, vatFromNet } from '@/lib/accounting/iva'
import { composeCollection } from '@/lib/accounting/posting/collection'
import {
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
  partyInfo,
  postingError,
  postingWarning,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import type { SalesInvoiceInput } from '@/lib/accounting/schemas'
import { salesAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  FiscalAmountKey,
  IsoDate,
  PostingContext,
  PostingError,
  PostingResult,
  PostingWarning,
  ProposedAllocation,
  ProposedDocument,
  Side,
  VatRateBp,
} from '@/lib/accounting/types'
import { VAT_RATE_VALUES } from '@/lib/accounting/types'
import { afipVoucherCode, VOUCHER_CATALOG, voucherDisplay } from '@/lib/accounting/voucher-types'

export type SalesInvoiceBuildInput = Omit<SalesInvoiceInput, 'clientRef' | 'previewHash'>

/** Factura, ND o NC de venta suelta (E.5.9, E16). */
export function buildSalesInvoice(
  input: SalesInvoiceBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues([
    ...input.aliquots.map((a, i) => [`aliquots.${i}.netCents`, a.netCents] as const),
    ['nonTaxedCents', input.nonTaxedCents],
    ['exemptCents', input.exemptCents],
    ['collectNow.amountCents', input.collectNow?.amountCents],
  ])
  const party = partyInfo({ id: input.partyId }, ctx)
  if (!party) fatal.push(postingError('party_not_found', 'partyId'))
  if (fatal.length > 0 || !party) return failed(fatal)

  const info = VOUCHER_CATALOG[input.voucherType]
  const isCredit = input.docKind === 'sales_credit_note'
  const errors: PostingError[] = []
  const warnings: PostingWarning[] = []

  // IVA por alícuota sobre el neto, con ±1¢ (dentro de la tolerancia, sin aviso).
  const byRate = new Map<VatRateBp, { net: Cents; vat: Cents; computed: Cents }>()
  for (const [i, a] of input.aliquots.entries()) {
    const prev = byRate.get(a.vatRateBp) ?? { net: 0, vat: 0, computed: 0 }
    const net = prev.net + a.netCents
    const computed = a.vatRateBp === 0 ? 0 : vatFromNet(net, a.vatRateBp)
    const vat = a.vatRateBp === 0 ? 0 : computed + a.vatAdjustCents
    if (vat < 0)
      return failed([
        postingError('vat_out_of_tolerance', `aliquots.${i}.vatAdjustCents`, {
          rate_bp: a.vatRateBp,
        }),
      ])
    byRate.set(a.vatRateBp, { net, vat, computed })
    if (a.vatRateBp !== 0 && net > 0) {
      const check = checkVat(net, a.vatRateBp, vat, ctx.settings.vatToleranceCents)
      if (check === 'warn') {
        warnings.push(
          postingWarning('vat_diff', 'd1', {
            rate_bp: a.vatRateBp,
            diff_cents: Math.abs(vat - computed),
          }),
        )
      } else if (check === 'error') {
        errors.push(
          postingError('vat_out_of_tolerance', `aliquots.${i}.vatAdjustCents`, {
            rate_bp: a.vatRateBp,
          }),
        )
      }
    }
  }
  const netTotal = sumCents([...byRate.values()].map((v) => v.net))
  const vatTotal = sumCents([...byRate.values()].map((v) => v.vat))
  const salesTotal = netTotal + input.nonTaxedCents + input.exemptCents
  const total = salesTotal + vatTotal

  const dueDate: IsoDate | null =
    input.dueDate ?? (isCredit ? null : addDaysSafe(input.issueDate, party.paymentTermDays))
  const label = voucherDisplay(input.voucherType, input.pointOfSale, input.number)
  const controlSide: Side = isCredit ? 'credit' : 'debit'
  const salesSide = flipSide(controlSide)

  const lines = new DocLineBuilder()
  lines.add({
    role: 'control',
    accountId: party.receivableAccountId,
    side: controlSide,
    amountCents: total,
    partyRef: party.key,
    dueDate,
    memo: label,
    tag: 'control',
  })
  lines.add({
    role: 'sales_invoiced',
    accountId: ctx.sys[salesAccountKey(input.channel, true)].id,
    side: salesSide,
    amountCents: salesTotal,
    channel: input.channel,
    memo: 'Ventas facturadas',
  })
  for (const rate of VAT_RATE_VALUES) {
    const v = byRate.get(rate)
    if (!v || rate === 0) continue
    lines.add({
      role: 'vat',
      accountId: ctx.sys.vat_debit.id,
      side: salesSide,
      amountCents: v.vat,
      vatRateBp: rate,
      baseCents: v.net,
      vatComputedCents: v.computed,
      taxKind: 'iva',
      memo: memoFor('vat', { rateBp: rate }),
    })
  }
  // Como el diario: el Debe primero (en la NC, las ventas y el IVA antes que el cliente).
  const built = lines.build({ debitFirst: isCredit })
  const controlLineNo = built.lineNoOf('control')

  const amounts: Partial<Record<FiscalAmountKey, Cents>> = {
    non_taxed_cents: input.nonTaxedCents,
    exempt_cents: input.exemptCents,
    total_cents: total,
  }
  for (const [rate, v] of byRate) {
    const cols = ALIQUOT_COLUMNS[rate]
    amounts[cols.net] = (amounts[cols.net] ?? 0) + v.net
    if (cols.vat) amounts[cols.vat] = (amounts[cols.vat] ?? 0) + v.vat
  }

  const doc: ProposedDocument = proposedDocument({
    ref: 'd1',
    kind: input.docKind,
    voucherType: input.voucherType,
    afipVoucherCode: afipVoucherCode(input.voucherType),
    party: party.key,
    issueDate: input.issueDate,
    accountingDate: input.issueDate,
    dueDate,
    pointOfSale: input.pointOfSale,
    number: input.number,
    description: descriptionFor(input.docKind, label, party.displayName),
    notes: input.notes,
    totalCents: total,
    controlAccountId: party.receivableAccountId,
    relatedDocument: input.relatedDocumentId ? { id: input.relatedDocumentId } : null,
    warningsAck: ackList(input.warningsAck),
    lines: built.lines,
    fiscalVouchers: [
      {
        book: 'sales',
        voucherType: input.voucherType,
        afipVoucherCode: afipVoucherCode(input.voucherType),
        isCreditNote: info.isCreditNote,
        voucherDate: input.issueDate,
        pointOfSale: input.pointOfSale,
        numberFrom: input.number,
        numberTo: input.number,
        channel: input.channel,
        counterparty: counterpartyFor(party),
        amounts: fiscalAmounts(amounts),
      },
    ],
  })

  const documents: ProposedDocument[] = [doc]
  const allocations: ProposedAllocation[] = []
  if (input.collectNow) {
    if (isCredit || controlLineNo === null) {
      errors.push(postingError('invalid_bundle', 'collectNow', { reason: 'collect_not_allowed' }))
    } else {
      const amount = input.collectNow.amountCents ?? total
      const collection = composeCollection(
        {
          partyId: input.partyId,
          date: input.collectNow.date ?? input.issueDate,
          applications: [],
          creditsUsed: [],
          grossCents: null,
          deductions: [],
          received: [
            {
              treasuryAccountId: input.collectNow.treasuryAccountId,
              amountCents: amount,
              reference: input.collectNow.reference,
            },
          ],
          writeOffCents: 0,
          commissionVoucher: { mode: 'none' },
          notes: input.notes,
          warningsAck: input.warningsAck,
        },
        ctx,
        {
          ref: 'd2',
          bundleItems: [
            {
              key: { doc: 'd1', lineNo: controlLineNo },
              accountId: party.receivableAccountId,
              partyId: input.partyId,
              amountCents: total,
            },
          ],
        },
      )
      if (!collection.ok) return failed([...errors, ...collection.errors])
      documents.push(collection.value.doc)
      allocations.push(...collection.value.allocations)
      errors.push(...collection.value.errors)
      warnings.push(...collection.value.warnings)
    }
  }
  return finalize(bundleOf(meta, documents, allocations), ctx, meta, { errors, warnings })
}

/** Nota de crédito de venta (E.5.9): el espejo de la factura. */
export function buildSalesCreditNote(
  input: SalesInvoiceBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  return buildSalesInvoice({ ...input, docKind: 'sales_credit_note' }, ctx, meta)
}
