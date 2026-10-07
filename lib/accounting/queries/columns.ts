/**
 * Columnas de los subdiarios (§F.8): las mismas en pantalla y en el CSV.
 * Puro (sin `server-only`): lo usan la tabla del cliente y el exporte.
 *
 * `acc_report_subledger` devuelve cada fila como `row jsonb`. Cada columna
 * lista las claves en las que puede venir su dato, en orden de preferencia
 * (la primera que esté presente gana), así la pantalla no se rompe si la base
 * nombra una clave distinto.
 */

export type SubledgerColumnType = 'date' | 'text' | 'money' | 'int' | 'list'

export type SubledgerColumn = {
  /** Encabezado del CSV y de la tabla. */
  header: string
  keys: readonly string[]
  type: SubledgerColumnType
  /** Plata y números van a la derecha. */
  align?: 'start' | 'end'
}

export type SubledgerKindKey =
  | 'purchases'
  | 'payments'
  | 'sales'
  | 'sales_by_method'
  | 'collections'
  | 'treasury'

const DATE: SubledgerColumn = {
  header: 'Fecha',
  keys: ['date', 'accounting_date', 'entry_date', 'voucher_date'],
  type: 'date',
}
const REF: SubledgerColumn = {
  header: 'Ref. interna',
  keys: ['seq', 'document_seq', 'ref'],
  type: 'int',
  align: 'end',
}

function money(header: string, ...keys: string[]): SubledgerColumn {
  return { header, keys, type: 'money', align: 'end' }
}

function text(header: string, ...keys: string[]): SubledgerColumn {
  return { header, keys, type: 'text' }
}

export const SUBLEDGER_COLUMNS: Readonly<Record<SubledgerKindKey, readonly SubledgerColumn[]>> = {
  purchases: [
    DATE,
    REF,
    text('Tipo', 'kind_label', 'type_label', 'type', 'kind'),
    text('Comprobante', 'document_label', 'voucher_label', 'label', 'voucher'),
    text('Proveedor', 'party_name', 'supplier_name', 'party'),
    text('CUIT', 'tax_id', 'party_tax_id', 'cuit'),
    text('Imputación', 'imputation', 'account_name', 'imputation_account'),
    money('Neto', 'net_cents'),
    money('IVA', 'vat_cents'),
    money(
      'No gravado, exento y sin crédito',
      'non_taxed_cents',
      'non_taxed_exempt_cents',
      'no_credit_cents',
      'other_cents',
    ),
    money(
      'Percepciones e impuestos',
      'perceptions_cents',
      'perceptions_taxes_cents',
      'taxes_cents',
    ),
    money('Total', 'total_cents'),
    text('Forma', 'payment_form_label', 'payment_form', 'form', 'mode'),
    { header: 'Vence', keys: ['due_date'], type: 'date' },
    text('Estado', 'status_label', 'payment_status_label', 'payment_status', 'status'),
    money('Pendiente', 'open_cents', 'pending_cents'),
  ],
  payments: [
    DATE,
    REF,
    text('Pagado a', 'party_name', 'paid_to'),
    { header: 'Medios', keys: ['methods', 'treasuries', 'means', 'payment_methods'], type: 'list' },
    {
      header: 'Aplicado a',
      keys: ['applied_to', 'applications', 'allocations'],
      type: 'list',
    },
    money('Saldos a favor usados', 'credits_used_cents', 'credit_used_cents'),
    money('Compensaciones', 'compensations_cents', 'compensation_cents'),
    money('A cuenta', 'on_account_cents', 'advance_cents'),
    money('Total', 'total_cents'),
  ],
  sales: [
    DATE,
    REF,
    text('Tipo', 'kind_label', 'type_label', 'type', 'kind'),
    text('Turno', 'shift'),
    money('Vendido salón', 'sold_salon_cents', 'salon_cents'),
    money('Vendido delivery', 'sold_delivery_cents', 'delivery_cents'),
    money('Vendido eventos', 'sold_events_cents', 'events_cents'),
    money('Facturado neto', 'invoiced_net_cents'),
    money('IVA débito', 'vat_cents', 'vat_debit_cents'),
    money('Sin factura', 'uninvoiced_cents'),
    money('Total', 'total_cents'),
    money('Faltante/sobrante de caja', 'cash_diff_cents', 'cash_difference_cents'),
  ],
  sales_by_method: [
    DATE,
    text('Medio', 'method_name', 'method'),
    text('Canal', 'channel_label', 'channel'),
    text('Cliente o plataforma', 'party_name'),
    money('Importe', 'amount_cents'),
    { header: 'Vence', keys: ['due_date'], type: 'date' },
    money('Pendiente', 'open_cents', 'pending_cents'),
  ],
  collections: [
    DATE,
    REF,
    text('Cobrado a', 'party_name'),
    money('Bruto', 'gross_cents'),
    money('Comisión', 'commission_cents'),
    money('IVA comisión', 'commission_vat_cents'),
    money('Percepción IVA', 'vat_perception_cents', 'perc_iva_cents'),
    money('Retención IVA', 'vat_withholding_cents'),
    money('Retención IIBB', 'iibb_withholding_cents'),
    money('SIRCUPA', 'sircupa_cents'),
    money('Retención Ganancias', 'income_tax_withholding_cents'),
    { header: 'Certificados', keys: ['certificates', 'certificate_numbers'], type: 'list' },
    money('Diferencias', 'differences_cents', 'unexplained_cents', 'write_off_cents'),
    money('Neto recibido', 'net_received_cents', 'received_cents', 'net_cents'),
    text('Caja', 'treasury_name', 'treasury'),
    text(
      'Comprobante de la comisión',
      'commission_voucher_label',
      'commission_voucher',
      'commission_document_label',
    ),
    money('A cuenta', 'on_account_cents', 'advance_cents'),
  ],
  treasury: [
    DATE,
    text('Caja', 'treasury_name', 'treasury'),
    REF,
    text('Comprobante', 'document_label', 'voucher_label', 'label'),
    text('Concepto', 'description', 'concept', 'memo'),
    text('Contrapartida', 'counterpart', 'counterpart_account', 'counterpart_name'),
    money('Entró', 'in_cents', 'inflow_cents', 'debit_cents'),
    money('Salió', 'out_cents', 'outflow_cents', 'credit_cents'),
    money('Saldo', 'balance_cents', 'running_balance_cents'),
  ],
}

/** La clave presente para una columna en una fila (la primera de `keys`), o `null`. */
export function subledgerKeyOf(
  column: SubledgerColumn,
  values: Readonly<Record<string, unknown>>,
): string | null {
  for (const key of column.keys) {
    if (key in values) return key
  }
  return null
}
