import 'server-only'
import { todayInCordoba } from '@/lib/dates/zone'
import {
  asRecord,
  asRecords,
  bool,
  callRpc,
  cents,
  centsOrNull,
  dayOrNull,
  intOrNull,
  isRecord,
  isUuid,
  optionalDay,
  str,
  strOrNull,
} from './shared'

/**
 * Lecturas de los formularios (§C.6): lo que el sistema recuerda por
 * proveedor, los chips de «Nuevo gasto», el aviso de duplicado, los rangos de
 * facturas del cierre del día y el saldo esperado de «Ajustar saldo». Todas
 * son RPC invoker que empiezan con `acc_assert_reader`.
 */

export type FormDefaults = {
  accountId: string | null
  voucherType: string | null
  vatRateBp: number | null
  pointOfSale: number | null
  lastNumber: number | null
  treasuryAccountId: string | null
  paymentTermDays: number | null
  suggestedTermDays: number | null
  medianTotalCents: number | null
  lastTotalCents: number | null
  /** El proveedor no tiene CUIT (lo piden los libros IVA). */
  cuitMissing: boolean
}

export type QuickExpenseSuggestion = {
  /** `party`: un proveedor habitual (con su cuenta); `account`: una cuenta suelta. */
  type: 'party' | 'account'
  partyId: string | null
  accountId: string
  label: string
  treasuryAccountId: string | null
  voucherType: string | null
  uses: number | null
}

export type PossibleDuplicate = {
  documentId: string
  /** «Factura A 0003-00001290». */
  label: string
  accountingDate: string | null
  issueDate: string | null
  totalCents: number | null
  partyName: string | null
  /** `number`: mismo tipo, PV y número; `amount`: mismo proveedor y total en ±3 días. */
  match: 'number' | 'amount'
}

export type SalesRangeDefault = {
  voucherType: string
  pointOfSale: number
  channel: string | null
  /** El último «hasta» cargado: el «desde» nuevo es este + 1. */
  lastNumberTo: number
}

export type TreasuryCheck = {
  /**
   * Saldo según el sistema al día pedido, Debe − Haber (en la tarjeta de la
   * empresa, la deuda es negativa): el mismo signo que el armador de ajustes
   * (`expected_book_cents` del arqueo) y que la entrada de `markTreasuryChecked`
   * (la acción lo pasa al lado normal que compara `acc_mark_treasury_checked`).
   */
  bookCents: number
  lastAdjustmentDate: string | null
  /** El último «Ajustar saldo» o «Coincide» confirmado. */
  lastCheckedOn: string | null
  /** Billeteras: partidas «a acreditar» abiertas (QR y transferencias). */
  openWalletItems: Array<{
    lineId: string
    method: string
    accountingDate: string | null
    openCents: number
  }>
  /** Descuentos estimados por las tasas del partícipe (se muestran como «estimado»). */
  estimates: { commissionCents: number; commissionVatCents: number; sircupaCents: number } | null
}

/** Lo que el sistema recuerda de un proveedor (H.5): cuenta, comprobante, caja, plazo. */
export async function getFormDefaults(tenantId: string, partyId: string): Promise<FormDefaults> {
  const data = isUuid(partyId)
    ? asRecord(await callRpc('acc_form_defaults', { p_tenant_id: tenantId, p_party_id: partyId }))
    : {}
  return {
    accountId: strOrNull(data.account_id),
    voucherType: strOrNull(data.voucher_type),
    vatRateBp: intOrNull(data.vat_rate_bp),
    pointOfSale: intOrNull(data.point_of_sale),
    lastNumber: intOrNull(data.last_number),
    treasuryAccountId: strOrNull(data.treasury_account_id),
    paymentTermDays: intOrNull(data.payment_term_days),
    suggestedTermDays: intOrNull(data.suggested_term_days),
    medianTotalCents: centsOrNull(data.median_total_cents),
    lastTotalCents: centsOrNull(data.last_total_cents),
    cuitMissing: bool(data.cuit_missing),
  }
}

/** Hasta 6 chips de «¿En qué?»: los proveedores y cuentas más usados en los últimos 60 días. */
export async function getQuickExpenseSuggestions(
  tenantId: string,
): Promise<QuickExpenseSuggestion[]> {
  const data = await callRpc('acc_quick_expense_suggestions', { p_tenant_id: tenantId })
  const list = Array.isArray(data) ? asRecords(data) : asRecords(asRecord(data).suggestions)
  return list
    .map((row) => {
      const partyId = strOrNull(row.party_id)
      return {
        type: (row.type === 'party' || (row.type !== 'account' && partyId) ? 'party' : 'account') as
          | 'party'
          | 'account',
        partyId,
        accountId: str(row.account_id),
        label: str(row.label ?? row.name ?? row.party_name ?? row.account_name),
        treasuryAccountId: strOrNull(row.treasury_account_id),
        voucherType: strOrNull(row.voucher_type),
        uses: intOrNull(row.uses ?? row.count),
      }
    })
    .filter((s) => isUuid(s.accountId) && s.label !== '')
    .slice(0, 6)
}

/**
 * ¿Ya está cargado? (mismo PV-número, o mismo proveedor y total en ±3 días).
 * `null` si no hay nada parecido.
 */
export async function findPossibleDuplicate(
  tenantId: string,
  params: {
    partyId: string | null
    totalCents: number
    issueDate: string
    voucherType: string | null
    pointOfSale: number | null
    number: number | null
  },
): Promise<PossibleDuplicate | null> {
  const issueDate = optionalDay(params.issueDate) ?? todayInCordoba()
  const data = await callRpc('acc_possible_duplicate', {
    p_tenant_id: tenantId,
    p_party_id: params.partyId && isUuid(params.partyId) ? params.partyId : null,
    p_total_cents: Math.max(0, Math.trunc(params.totalCents)),
    p_issue_date: issueDate,
    p_voucher_type: params.voucherType,
    p_point_of_sale: params.pointOfSale,
    p_number: params.number,
  })
  if (!isRecord(data) || !isUuid(data.document_id)) return null
  return {
    documentId: data.document_id,
    label: str(data.label),
    accountingDate: dayOrNull(data.accounting_date),
    issueDate: dayOrNull(data.issue_date),
    totalCents: centsOrNull(data.total_cents),
    partyName: strOrNull(data.party_name),
    match: data.match === 'number' ? 'number' : 'amount',
  }
}

/** Para el cierre del día: el último «hasta» de cada tipo y punto de venta. */
export async function getSalesRangeDefaults(tenantId: string): Promise<SalesRangeDefault[]> {
  const data = await callRpc('acc_sales_range_defaults', { p_tenant_id: tenantId })
  return asRecords(data).map((row) => ({
    voucherType: str(row.voucher_type),
    pointOfSale: intOrNull(row.point_of_sale) ?? 0,
    channel: strOrNull(row.channel),
    lastNumberTo: intOrNull(row.last_number_to) ?? 0,
  }))
}

/** El saldo esperado de una caja para «Ajustar saldo» (y, en billeteras, lo que falta acreditar). */
export async function getTreasuryCheck(
  tenantId: string,
  params: { treasuryId: string; asOf?: string | null },
): Promise<TreasuryCheck | null> {
  if (!isUuid(params.treasuryId)) return null
  const asOf = optionalDay(params.asOf) ?? todayInCordoba()
  const data = asRecord(
    await callRpc('acc_treasury_check', {
      p_tenant_id: tenantId,
      p_treasury_id: params.treasuryId,
      p_as_of: asOf,
    }),
  )
  const estimates = isRecord(data.estimates) ? data.estimates : null
  return {
    // `book_cents` viene del lado normal de la cuenta (en una tarjeta, la deuda
    // en positivo: lo que compara `acc_mark_treasury_checked`); `book_dc_cents`
    // es Debe − Haber, lo que usan el motor y el arqueo. En una caja de activo
    // son lo mismo.
    bookCents: centsOrNull(data.book_dc_cents) ?? cents(data.book_cents),
    lastAdjustmentDate: dayOrNull(data.last_adjustment_date),
    lastCheckedOn: dayOrNull(data.last_checked_on),
    openWalletItems: asRecords(data.open_wallet_items).map((item) => ({
      lineId: str(item.line_id),
      method: str(item.method ?? item.method_name),
      accountingDate: dayOrNull(item.accounting_date),
      openCents: cents(item.open_cents),
    })),
    estimates: estimates
      ? {
          commissionCents: cents(estimates.commission_cents),
          commissionVatCents: cents(estimates.commission_vat_cents),
          sircupaCents: cents(estimates.sircupa_cents),
        }
      : null,
  }
}
