/**
 * Cierre de ventas del día (`sales_close`, E.5.6): el espejo del cierre de
 * caja de Thinkeon.
 *
 * **Cálculo por canal:** `vendido[c] = Σ medios de c`; `facturado[c] = Σ ±
 * total facturado de c` (las NC restan); `sin_factura[c] = vendido[c] −
 * facturado[c]`. Si da negativo es `invoiced_exceeds_sold`: se confirma con un
 * motivo (una factura de una venta de otro día) y entonces «sin factura» va al
 * Debe.
 *
 * **Asiento:** D Caja {treasury; con conteo, lo contado} · D/H faltante o
 * sobrante {cash_diff} · D cada «nos debe» `[procesador/plataforma/billetera]`
 * {receivable, una línea por medio, vence fecha + días del medio} · D Deudores
 * `[cliente]` {receivable, cuenta corriente, vence según el plazo del cliente}
 * · D Señas {advance} · H Ventas `<canal>`: facturadas {Σ ± (neto + no gravado
 * + exento)} · H Ventas `<canal>`: sin factura · H IVA débito fiscal {uno por
 * alícuota; si da negativo, D}. El cierre no pide descuentos: Mercado Pago se
 * acredita con «Ajustar saldo» (E.5.8).
 *
 * **Libro IVA ventas:** una fila por rango facturado, con canal; B a
 * consumidor final (documento 99), A al cliente con su CUIT.
 *
 * E8 · lunes 05/10: vendido 170.000.000, faltante 50.000, sin factura salón
 * 28.000.000 y delivery 2.850.000, IVA 24.150.000.
 */

import {
  ALIQUOT_COLUMNS,
  checkVat,
  netFromGross,
  rangeVatTolerance,
  vatFromNet,
} from '@/lib/accounting/iva'
import { type BundleItem, composeCollection } from '@/lib/accounting/posting/collection'
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
  finalConsumerCounterparty,
  finalize,
  fiscalAmounts,
  memoFor,
  partyInfo,
  postingError,
  postingWarning,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import type { SalesCloseInput } from '@/lib/accounting/schemas'
import { salesAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  Channel,
  FiscalAmountKey,
  FiscalVoucher,
  FiscalVoucherType,
  PostingContext,
  PostingError,
  PostingResult,
  PostingWarning,
  ProposedAllocation,
  ProposedDocument,
  SalesMethodRef,
  VatRateBp,
} from '@/lib/accounting/types'
import { CHANNELS, VAT_RATE_VALUES } from '@/lib/accounting/types'
import { afipVoucherCode, VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'
import { formatIsoDay, weekdayName } from '@/lib/dates'

export type SalesCloseBuildInput = Omit<SalesCloseInput, 'clientRef' | 'previewHash'>
type InvoicedRow = SalesCloseBuildInput['invoiced'][number]

export type ChannelSummary = {
  channel: Channel
  soldCents: Cents
  /** Σ ± (netos + no gravado + exento): lo que va a «Ventas <canal>: facturadas». */
  invoicedNetCents: Cents
  /** Σ ± total facturado (con IVA). */
  invoicedTotalCents: Cents
  /** Vendido − facturado (puede dar negativo: `invoiced_exceeds_sold`). */
  uninvoicedCents: Cents
}

type RowComputed = {
  index: number
  row: InvoicedRow
  voucherType: FiscalVoucherType
  sign: 1 | -1
  byRate: Map<VatRateBp, { net: Cents; vat: Cents }>
  nonTaxed: Cents
  exempt: Cents
  netTotal: Cents
  total: Cents
}

/** Neto e IVA de cada fila facturada, con la tolerancia de su rango (N centavos, hasta 50). */
function computeRows(
  input: SalesCloseBuildInput,
  ctx: PostingContext,
): {
  rows: RowComputed[]
  errors: PostingError[]
  warnings: PostingWarning[]
  fatal: PostingError[]
} {
  const rows: RowComputed[] = []
  const errors: PostingError[] = []
  const warnings: PostingWarning[] = []
  const fatal: PostingError[] = []
  input.invoiced.forEach((row, index) => {
    const field = `invoiced.${index}`
    // La red del motor: con centavos raros la fila no se calcula (el builder ya cortó con el error).
    const bad = centsIssues([
      [`${field}.totalCents`, row.totalCents],
      [`${field}.nonTaxedCents`, row.nonTaxedCents],
      [`${field}.exemptCents`, row.exemptCents],
      ...row.aliquots.flatMap((a, j) => [
        [`${field}.aliquots.${j}.netCents`, a.netCents] as const,
        [`${field}.aliquots.${j}.vatCents`, a.vatCents] as const,
      ]),
    ])
    if (bad.length > 0) {
      fatal.push(...bad)
      return
    }
    if (
      !Number.isSafeInteger(row.numberFrom) ||
      !Number.isSafeInteger(row.numberTo) ||
      row.numberTo < row.numberFrom
    ) {
      fatal.push(postingError('range_invalid', `${field}.numberTo`))
      return
    }
    const voucherType = row.voucherType as FiscalVoucherType
    const info = VOUCHER_CATALOG[voucherType]
    const byRate = new Map<VatRateBp, { net: Cents; vat: Cents }>()
    const add = (rate: VatRateBp, net: Cents, vat: Cents) => {
      const prev = byRate.get(rate) ?? { net: 0, vat: 0 }
      byRate.set(rate, { net: prev.net + net, vat: prev.vat + vat })
    }
    if (row.amountMode === 'total') {
      const total = row.totalCents ?? 0
      const taxable = total - row.nonTaxedCents - row.exemptCents
      if (taxable < 0) {
        fatal.push(
          postingError('total_mismatch', `${field}.totalCents`, {
            computed_cents: row.nonTaxedCents + row.exemptCents,
            control_cents: total,
          }),
        )
        return
      }
      const net = row.vatRateBp === 0 ? taxable : netFromGross(taxable, row.vatRateBp)
      add(row.vatRateBp, net, taxable - net)
    } else {
      const tolerance = Math.max(
        ctx.settings.vatToleranceCents,
        rangeVatTolerance(row.numberFrom, row.numberTo),
      )
      for (const [i, a] of row.aliquots.entries()) {
        const computed = a.vatRateBp === 0 ? 0 : vatFromNet(a.netCents, a.vatRateBp)
        const vat = a.vatRateBp === 0 ? 0 : (a.vatCents ?? computed)
        if (a.vatRateBp !== 0) {
          const check = checkVat(a.netCents, a.vatRateBp, vat, tolerance)
          if (check === 'warn') {
            warnings.push(
              postingWarning('vat_diff', 'd1', {
                rate_bp: a.vatRateBp,
                diff_cents: Math.abs(vat - computed),
              }),
            )
          } else if (check === 'error') {
            errors.push(
              postingError('vat_out_of_tolerance', `${field}.aliquots.${i}.vatCents`, {
                rate_bp: a.vatRateBp,
              }),
            )
          }
        }
        add(a.vatRateBp, a.netCents, vat)
      }
    }
    const netTotal = sumCents([...byRate.values()].map((v) => v.net))
    const vatTotal = sumCents([...byRate.values()].map((v) => v.vat))
    rows.push({
      index,
      row,
      voucherType,
      sign: info.isCreditNote ? -1 : 1,
      byRate,
      nonTaxed: row.nonTaxedCents,
      exempt: row.exemptCents,
      netTotal: netTotal + row.nonTaxedCents + row.exemptCents,
      total: netTotal + vatTotal + row.nonTaxedCents + row.exemptCents,
    })
  })
  return { rows, errors, warnings, fatal }
}

function soldByChannel(
  input: SalesCloseBuildInput,
  ctx: Pick<PostingContext, 'methods'>,
): Map<Channel, Cents> {
  const sold = new Map<Channel, Cents>()
  for (const m of input.methods) {
    const method = ctx.methods.get(m.salesMethodId)
    if (!method) continue
    sold.set(method.channel, (sold.get(method.channel) ?? 0) + m.amountCents)
  }
  return sold
}

function channelSummaries(
  rows: readonly RowComputed[],
  sold: ReadonlyMap<Channel, Cents>,
): ChannelSummary[] {
  return CHANNELS.map((channel) => {
    const ofChannel = rows.filter((r) => r.row.channel === channel)
    const invoicedNetCents = sumCents(ofChannel.map((r) => r.sign * r.netTotal))
    const invoicedTotalCents = sumCents(ofChannel.map((r) => r.sign * r.total))
    const soldCents = sold.get(channel) ?? 0
    return {
      channel,
      soldCents,
      invoicedNetCents,
      invoicedTotalCents,
      uninvoicedCents: soldCents - invoicedTotalCents,
    }
  })
}

/**
 * Lo vendido, facturado y sin factura por canal («Salón: vendido $ 1.490.000 ·
 * facturado $ 1.210.000 · sin factura $ 280.000», H.9), con las mismas cuentas
 * que el asiento.
 */
export function summarizeSalesClose(
  input: SalesCloseBuildInput,
  ctx: PostingContext,
): { soldCents: Cents; channels: ChannelSummary[] } {
  const { rows } = computeRows(input, ctx)
  const sold = soldByChannel(input, ctx)
  return {
    soldCents: sumCents(input.methods.map((m) => m.amountCents)),
    channels: channelSummaries(rows, sold),
  }
}

/** Cierre de ventas del día (E.5.6: E8, E8b), con acreditaciones en el acto opcionales. */
export function buildSalesClose(
  input: SalesCloseBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues([
    ...input.methods.flatMap((m, i) => [
      [`methods.${i}.amountCents`, m.amountCents] as const,
      ...m.customers.map(
        (c, j) => [`methods.${i}.customers.${j}.amountCents`, c.amountCents] as const,
      ),
    ]),
    ...input.invoiced.flatMap((r, i) => [
      [`invoiced.${i}.totalCents`, r.totalCents] as const,
      [`invoiced.${i}.nonTaxedCents`, r.nonTaxedCents] as const,
      [`invoiced.${i}.exemptCents`, r.exemptCents] as const,
      ...r.aliquots.flatMap((a, j) => [
        [`invoiced.${i}.aliquots.${j}.netCents`, a.netCents] as const,
        [`invoiced.${i}.aliquots.${j}.vatCents`, a.vatCents] as const,
      ]),
    ]),
    ['cashCountedCents', input.cashCountedCents],
    ['controlTotalCents', input.controlTotalCents],
  ])

  // Medios en el orden de Ajustes › Medios de cobro (el de Thinkeon); empate: el orden de carga.
  const entries: Array<{
    index: number
    amountCents: Cents
    m: SalesCloseBuildInput['methods'][number]
    method: SalesMethodRef
  }> = []
  input.methods.forEach((m, index) => {
    const method = ctx.methods.get(m.salesMethodId)
    if (!method) fatal.push(postingError('sales_method_mismatch', `methods.${index}.salesMethodId`))
    else entries.push({ index, amountCents: m.amountCents, m, method })
  })
  entries.sort((a, b) =>
    a.method.sort !== b.method.sort ? a.method.sort - b.method.sort : a.index - b.index,
  )

  const isCash = (method: SalesMethodRef) =>
    method.kind === 'treasury' &&
    method.treasuryAccountId !== null &&
    ctx.treasuries.get(method.treasuryAccountId)?.kind === 'cash'
  const cashEntry = entries.find((e) => isCash(e.method)) ?? null
  if (input.cashCountedCents !== null && (input.cashCountedCents < 0 || !cashEntry)) {
    fatal.push(postingError('cash_count_invalid', 'cashCountedCents'))
  }

  if (fatal.length > 0) return failed(fatal)
  const computed = computeRows(input, ctx)
  fatal.push(...computed.fatal)
  // Partícipes de las filas facturadas (las A van con el cliente y su CUIT).
  const counterparties = new Map<number, ReturnType<typeof finalConsumerCounterparty>>()
  for (const r of computed.rows) {
    if (r.row.partyId) {
      const party = partyInfo({ id: r.row.partyId }, ctx)
      if (!party) fatal.push(postingError('party_not_found', `invoiced.${r.index}.partyId`))
      else counterparties.set(r.index, counterpartyFor(party))
    } else counterparties.set(r.index, finalConsumerCounterparty())
  }
  if (fatal.length > 0) return failed(fatal)

  const errors: PostingError[] = [...computed.errors]
  const warnings: PostingWarning[] = [...computed.warnings]
  const lines = new DocLineBuilder()

  // ── Debe: lo cobrado por medio ──
  for (const e of entries) {
    const { method, m } = e
    // Un medio sin ventas no genera nada (salvo el efectivo contado, que puede dar un sobrante).
    if (m.amountCents === 0 && !(e === cashEntry && input.cashCountedCents !== null)) continue
    switch (method.kind) {
      case 'treasury': {
        const treasury = method.treasuryAccountId
          ? ctx.treasuries.get(method.treasuryAccountId)
          : undefined
        if (!treasury)
          return failed([postingError('treasury_mismatch', `methods.${e.index}.salesMethodId`)])
        const counted =
          e === cashEntry && input.cashCountedCents !== null ? input.cashCountedCents : null
        lines.add({
          role: 'treasury',
          accountId: treasury.accountId,
          side: 'debit',
          amountCents: counted ?? m.amountCents,
          treasuryAccountId: treasury.id,
          salesMethodId: method.id,
          memo: method.name,
        })
        if (counted !== null) {
          const diff = m.amountCents - counted
          lines.add({
            role: 'cash_diff',
            accountId: diff > 0 ? ctx.sys.cash_short.id : ctx.sys.cash_over.id,
            side: diff > 0 ? 'debit' : 'credit',
            amountCents: Math.abs(diff),
            memo: diff > 0 ? 'Faltante de caja' : 'Sobrante de caja',
          })
        }
        break
      }
      case 'settled_now':
      case 'receivable': {
        const party = method.partyId ? partyInfo({ id: method.partyId }, ctx) : null
        if (!party)
          return failed([postingError('sales_method_mismatch', `methods.${e.index}.salesMethodId`)])
        lines.add({
          role: 'receivable',
          accountId: party.receivableAccountId,
          side: 'debit',
          amountCents: m.amountCents,
          partyRef: party.key,
          salesMethodId: method.id,
          dueDate: addDaysSafe(input.date, method.settlementDays),
          memo: method.name,
        })
        break
      }
      case 'customer_account': {
        if (m.amountCents > 0 && m.customers.length === 0) {
          return failed([postingError('party_required', `methods.${e.index}.customers`)])
        }
        const customersTotal = sumCents(m.customers.map((c) => c.amountCents))
        if (m.customers.length > 0 && customersTotal !== m.amountCents) {
          errors.push(
            postingError('total_mismatch', `methods.${e.index}.customers`, {
              computed_cents: customersTotal,
              control_cents: m.amountCents,
            }),
          )
        }
        for (const [j, c] of m.customers.entries()) {
          const party = partyInfo({ id: c.partyId }, ctx)
          if (!party)
            return failed([
              postingError('party_not_found', `methods.${e.index}.customers.${j}.partyId`),
            ])
          lines.add({
            role: 'receivable',
            accountId: party.receivableAccountId,
            side: 'debit',
            amountCents: c.amountCents,
            partyRef: party.key,
            salesMethodId: method.id,
            dueDate: addDaysSafe(input.date, party.paymentTermDays),
            memo: `${method.name} · ${party.displayName}`,
          })
        }
        break
      }
      case 'advance': {
        const party = method.partyId ? partyInfo({ id: method.partyId }, ctx) : null
        if (!party)
          return failed([postingError('sales_method_mismatch', `methods.${e.index}.salesMethodId`)])
        lines.add({
          role: 'advance',
          accountId: ctx.sys.customer_deposits.id,
          side: 'debit',
          amountCents: m.amountCents,
          partyRef: party.key,
          salesMethodId: method.id,
          memo: method.name,
        })
        break
      }
    }
  }

  // ── Haber: ventas por canal (facturadas y sin factura) ──
  const summaries = channelSummaries(computed.rows, soldByChannel(input, ctx))
  const singleAccount = ctx.settings.uninvoicedSalesMode === 'single_account'
  for (const s of summaries) {
    lines.addSigned(
      {
        role: 'sales_invoiced',
        accountId: ctx.sys[salesAccountKey(s.channel, true)].id,
        channel: s.channel,
        memo: 'Ventas facturadas',
      },
      s.invoicedNetCents,
      'credit',
    )
    lines.addSigned(
      {
        role: 'sales_uninvoiced',
        accountId: ctx.sys[salesAccountKey(s.channel, singleAccount)].id,
        channel: s.channel,
        memo: 'Ventas sin factura',
      },
      s.uninvoicedCents,
      'credit',
    )
  }

  // ── IVA débito fiscal, uno por alícuota (con signo: las NC restan) ──
  for (const rate of VAT_RATE_VALUES) {
    if (rate === 0) continue
    const base = sumCents(computed.rows.map((r) => r.sign * (r.byRate.get(rate)?.net ?? 0)))
    const vat = sumCents(computed.rows.map((r) => r.sign * (r.byRate.get(rate)?.vat ?? 0)))
    const absBase = Math.abs(base)
    lines.addSigned(
      {
        role: 'vat',
        accountId: ctx.sys.vat_debit.id,
        vatRateBp: rate,
        baseCents: absBase,
        vatComputedCents: vatFromNet(absBase, rate),
        taxKind: 'iva',
        memo: memoFor('vat', { rateBp: rate }),
      },
      vat,
      'credit',
    )
  }

  // ── Facturado de más: se confirma con un motivo (factura de una venta de otro día) ──
  const acks = ackList(input.warningsAck)
  const exceeding = summaries.filter((s) => s.uninvoicedCents < 0)
  let overrideReason: string | null = null
  for (const s of exceeding) {
    warnings.push(
      postingWarning('invoiced_exceeds_sold', 'd1', {
        channel: s.channel,
        invoiced_cents: s.invoicedTotalCents,
        sold_cents: s.soldCents,
      }),
    )
  }
  if (exceeding.length > 0 && acks.includes('invoiced_exceeds_sold')) {
    const reason = (input.overrideReason ?? '').trim()
    if (reason.length < 5 || reason.length > 300)
      errors.push(postingError('reason_required', 'overrideReason'))
    else overrideReason = reason
  }

  const sold = sumCents(input.methods.map((m) => m.amountCents))
  if (input.controlTotalCents !== null && input.controlTotalCents !== sold) {
    errors.push(
      postingError('total_mismatch', 'controlTotalCents', {
        computed_cents: sold,
        control_cents: input.controlTotalCents,
      }),
    )
  }

  // ── Libro IVA ventas: una fila por rango ──
  const fiscalVouchers: FiscalVoucher[] = computed.rows.map((r) => {
    const amounts: Partial<Record<FiscalAmountKey, Cents>> = {
      non_taxed_cents: r.nonTaxed,
      exempt_cents: r.exempt,
      total_cents: r.total,
    }
    for (const [rate, v] of r.byRate) {
      const cols = ALIQUOT_COLUMNS[rate]
      amounts[cols.net] = (amounts[cols.net] ?? 0) + v.net
      if (cols.vat) amounts[cols.vat] = (amounts[cols.vat] ?? 0) + v.vat
    }
    return {
      book: 'sales',
      voucherType: r.voucherType,
      afipVoucherCode: afipVoucherCode(r.voucherType),
      isCreditNote: r.sign === -1,
      voucherDate: input.date,
      pointOfSale: r.row.pointOfSale,
      numberFrom: r.row.numberFrom,
      numberTo: r.row.numberTo,
      channel: r.row.channel,
      counterparty: counterparties.get(r.index) ?? finalConsumerCounterparty(),
      amounts: fiscalAmounts(amounts),
    }
  })

  const built = lines.build()
  const day = `${weekdayName(input.date)} ${formatIsoDay(input.date)}`.trim()
  const close: ProposedDocument = proposedDocument({
    ref: 'd1',
    kind: 'sales_close',
    issueDate: input.date,
    accountingDate: input.date,
    shift: input.shift,
    description: descriptionFor(
      'sales_close',
      `Cierre del día ${day}`,
      input.shift ? `turno ${input.shift}` : null,
    ),
    totalCents: sold,
    warningsAck: acks,
    overrideReason,
    lines: built.lines,
    fiscalVouchers,
  })

  // ── Acreditaciones en el acto: cada una aplica sola las partidas de su partícipe del cierre ──
  const documents: ProposedDocument[] = [close]
  const allocations: ProposedAllocation[] = []
  // Lo que queda sin acreditar de cada partida del cierre (dos acreditaciones no aplican lo mismo).
  const remaining = new Map<number, BundleItem>()
  for (const l of built.lines) {
    if (l.role === 'receivable' && l.partyRef && 'id' in l.partyRef) {
      remaining.set(l.lineNo, {
        key: { doc: 'd1', lineNo: l.lineNo },
        accountId: l.accountId,
        partyId: l.partyRef.id,
        amountCents: l.amountCents,
      })
    }
  }
  for (const [k, settlement] of input.instantSettlements.entries()) {
    const composed = composeCollection({ ...settlement, warningsAck: input.warningsAck }, ctx, {
      ref: `d${k + 2}`,
      bundleItems: [...remaining.values()].filter((b) => b.amountCents > 0),
    })
    if (!composed.ok) {
      return failed(
        composed.errors.map((e) => ({ ...e, field: `instantSettlements.${k}.${e.field ?? ''}` })),
      )
    }
    for (const a of composed.value.allocations) {
      if ('doc' in a.debit && a.debit.doc === 'd1') {
        const item = remaining.get(a.debit.lineNo)
        if (item)
          remaining.set(a.debit.lineNo, { ...item, amountCents: item.amountCents - a.amountCents })
      }
    }
    documents.push(composed.value.doc)
    allocations.push(...composed.value.allocations)
    errors.push(...composed.value.errors)
    warnings.push(...composed.value.warnings)
  }

  return finalize(bundleOf(meta, documents, allocations), ctx, meta, { errors, warnings })
}
