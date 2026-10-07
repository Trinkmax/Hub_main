/**
 * Tipos de dominio de Administración (Sprint 1, E.2).
 *
 * Puro: sin I/O, sin React, sin `Date`. Lo usan el motor de imputación
 * (`posting/*`), la vista previa, las validaciones compartidas y los esquemas.
 *
 * Convenciones que valen para todo el módulo:
 * - **Plata en centavos enteros** (`Cents`), siempre ≥ 0 en renglones: el
 *   sentido lo da el lado (Debe/Haber), una NC no es un número negativo. Tope
 *   por importe 1e15 (< 2^53, entra exacto en un `number`).
 * - **Fechas civiles** `'yyyy-MM-dd'` en el día del bar (Córdoba). Nunca
 *   `new Date('yyyy-MM-dd')` (corre el día en GMT−3): la aritmética va por
 *   `@/lib/dates`.
 * - Los catálogos son `const` arrays con su union derivada: así el tipo y la
 *   lista que validan los esquemas (zod) no pueden desincronizarse. Los
 *   valores son los mismos que los CHECK de las tablas `acc_*` (A.2).
 */

import type { AccErrorKey } from './errors'
import type { SystemAccountKey } from './system-keys'

// ─── Escalares ───────────────────────────────────────────────────────────────

/** Entero; tope por importe 1e15 (< 2^53). */
export type Cents = number
/** `'yyyy-MM-dd'`, día del bar (Córdoba). */
export type IsoDate = string

export const SIDES = ['debit', 'credit'] as const
export type Side = (typeof SIDES)[number]

export const VAT_RATE_VALUES = [0, 250, 500, 1050, 2100, 2700] as const
/** Alícuota de IVA en puntos básicos: 2100 = 21 %. */
export type VatRateBp = (typeof VAT_RATE_VALUES)[number]

export const CHANNELS = ['salon', 'delivery', 'events'] as const
export type Channel = (typeof CHANNELS)[number]

// ─── Catálogos (mismos valores que los CHECK de A.2) ─────────────────────────

export const IVA_CONDITIONS = [
  'responsable_inscripto',
  'monotributo',
  'exento',
  'consumidor_final',
  'no_alcanzado',
  'sin_datos',
] as const
export type IvaCondition = (typeof IVA_CONDITIONS)[number]

/** Condiciones posibles de la SAS misma (`acc_settings.iva_condition`). */
export const SAS_IVA_CONDITIONS = ['responsable_inscripto', 'monotributo', 'exento'] as const
export type SasIvaCondition = (typeof SAS_IVA_CONDITIONS)[number]

export const DOCUMENT_KINDS = [
  'opening',
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
  'payment',
  'sales_close',
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
  'collection',
  'transfer',
  'bank_expense',
  'cash_movement',
  'treasury_adjustment',
  'manual',
  'reversal',
  'iva_settlement',
  'fy_result',
  'fy_closing',
  'fy_opening',
] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const ENTRY_KINDS = [
  'opening',
  'standard',
  'manual',
  'adjustment',
  'payroll',
  'reversal',
  'iva_settlement',
  'fy_adjustment',
  'fy_result',
  'fy_closing',
  'fy_opening',
] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export const LINE_ROLES = [
  'net',
  'vat',
  'gross',
  'non_taxed',
  'exempt',
  'internal_tax',
  'perception',
  'other_tax',
  'control',
  'treasury',
  'compensation',
  'deduction',
  'write_off',
  'receivable',
  'advance',
  'sales_invoiced',
  'sales_uninvoiced',
  'cash_diff',
  'vat_pending_release',
  'counterpart',
  'adjustment_split',
  'manual',
  'opening',
  'settlement',
  'reversal',
  'fy_result',
  'mirror',
] as const
export type LineRole = (typeof LINE_ROLES)[number]

export const PARTY_KINDS = [
  'supplier',
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
  'bank',
  'tax_agency',
  'payroll',
  'partner',
  'other',
] as const
export type PartyKind = (typeof PARTY_KINDS)[number]

export const TAX_ID_TYPES = ['cuit', 'cuil', 'dni', 'none'] as const
export type TaxIdType = (typeof TAX_ID_TYPES)[number]

export const COMMISSION_VAT_MODES = ['per_settlement', 'monthly_invoice', 'none'] as const
export type CommissionVatMode = (typeof COMMISSION_VAT_MODES)[number]

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const TREASURY_KINDS = ['cash', 'bank', 'wallet', 'credit_card', 'other'] as const
export type TreasuryKind = (typeof TREASURY_KINDS)[number]

export const SALES_METHOD_KINDS = [
  'treasury',
  'settled_now',
  'receivable',
  'customer_account',
  'advance',
] as const
export type SalesMethodKind = (typeof SALES_METHOD_KINDS)[number]

/** Mismo dominio que `acc_documents.voucher_type` (adoc_voucher_type). */
export const VOUCHER_TYPE_KEYS = [
  'factura_a',
  'nota_debito_a',
  'nota_credito_a',
  'recibo_a',
  'factura_b',
  'nota_debito_b',
  'nota_credito_b',
  'recibo_b',
  'factura_c',
  'nota_debito_c',
  'nota_credito_c',
  'recibo_c',
  'factura_m',
  'nota_debito_m',
  'nota_credito_m',
  'tique_factura_a',
  'tique_factura_b',
  'tique_factura_c',
  'tique',
  'liquidacion',
  'resumen_bancario',
  'otro_comprobante',
  'ddjj_impuesto',
  'sin_comprobante',
] as const
export type VoucherType = (typeof VOUCHER_TYPE_KEYS)[number]

/** Los que pueden ir a un libro IVA (`afv_voucher_type`: sin DDJJ ni «sin comprobante»). */
export type FiscalVoucherType = Exclude<VoucherType, 'ddjj_impuesto' | 'sin_comprobante'>

/** `acc_document_lines.tax_kind` (adl_tax_kind). */
export const TAX_KINDS = [
  'iva',
  'iibb',
  'ganancias',
  'municipal',
  'internos',
  'ley_25413_credito',
  'ley_25413_debito',
  'sircreb',
  'sircupa',
  'comision',
  'iva_comision',
  'percepcion_iva_comision',
  'ret_iva',
  'ret_iibb',
  'ret_ganancias',
  'interes',
  'diferencia',
  'rendimiento',
  'otro',
] as const
export type TaxKind = (typeof TAX_KINDS)[number]

export const FISCAL_BOOKS = ['purchases', 'sales'] as const
export type FiscalBook = (typeof FISCAL_BOOKS)[number]

/** Tipo de documento AFIP de la contraparte: 80 CUIT · 86 CUIL · 96 DNI · 99 sin identificar. */
export const AFIP_DOC_TYPES = [80, 86, 96, 99] as const
export type AfipDocType = (typeof AFIP_DOC_TYPES)[number]

export const ALLOCATION_KINDS = ['payment', 'credit_note', 'manual', 'reversal', 'replace'] as const
export type AllocationKind = (typeof ALLOCATION_KINDS)[number]

/**
 * Avisos confirmables de un comprobante (C.0, G.4). Lo aceptado viaja en
 * `warningsAck` y queda en `acc_documents.warnings_ack`. `amount_looks_off`
 * es solo de la UI (la base no lo conoce), pero se acepta igual para que el
 * formulario pueda mandarlo sin que el esquema lo rechace.
 */
export const WARNING_KEYS = [
  'vat_diff',
  'voucher_condition',
  'voucher_m',
  'treasury_negative',
  'possible_duplicate',
  'late_registration',
  'write_off',
  'invoiced_exceeds_sold',
  'amount_looks_off',
] as const
export type WarningKey = (typeof WARNING_KEYS)[number]

/** Avisos del cierre de mes (C.5.1 paso 4): se aceptan en `closePeriod`. */
export const CLOSE_WARNING_KEYS = [
  'missing_daily_closes',
  'receivables_overdue',
  'treasury_negative',
  'treasuries_not_reconciled',
  'vat_pending_documentation',
  'recurring_not_loaded',
  'tickets_without_vendor',
  'sas_cuit_missing',
] as const
export type CloseWarningKey = (typeof CLOSE_WARNING_KEYS)[number]

// ─── Contexto del motor (lo arma `loadPostingContext` desde la base) ─────────

export type AccountRef = {
  id: string
  code: string
  name: string
  type: AccountType
  normalSide: Side
  postable: boolean
  active: boolean
  requiresParty: boolean
  isTreasury: boolean
  purchaseSelectable: boolean
  systemKey: SystemAccountKey | null
  description: string | null
}

export type PartyRates = {
  commissionBp: number | null
  iibbWithholdingBp: number | null
  vatWithholdingBp: number | null
  incomeTaxWithholdingBp: number | null
  sircupaBp: number | null
}

export type PartyRef = {
  id: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  payableAccountId: string
  receivableAccountId: string
  commissionVatMode: CommissionVatMode
  rates: PartyRates
  active: boolean
}

export type TreasuryRef = {
  id: string
  accountId: string
  name: string
  kind: TreasuryKind
  allowNegative: boolean
  bankPartyId: string | null
  /**
   * Saldo de libro en el sentido normal de su cuenta: en una caja, banco o
   * billetera (activo) es Σ Debe − Σ Haber; en la tarjeta de la empresa
   * (pasivo) es Σ Haber − Σ Debe, o sea la deuda. Puede ser negativo.
   */
  balanceCents: Cents
  active: boolean
}

export type SalesMethodRef = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  treasuryAccountId: string | null
  partyId: string | null
  settlementDays: number
  sort: number
}

export type OpenItemRef = {
  lineId: string
  documentId: string
  partyId: string
  accountId: string
  side: Side
  amountCents: Cents
  /** Lo que queda abierto hoy (importe − imputaciones vigentes). */
  openCents: Cents
  entryDate: IsoDate
  dueDate: IsoDate | null
  label: string
  salesMethodId: string | null
}

export type PostingSettings = {
  ivaCondition: SasIvaCondition
  booksStartDate: IsoDate
  vatToleranceCents: number
  bankTaxCreditComputableBp: number
  bankTaxDebitComputableBp: number
  uninvoicedSalesMode: 'separate_accounts' | 'single_account'
  ivaDueDay: number
  /**
   * Día de vencimiento de la DDJJ de IIBB (`acc_settings.iibb_due_day`). No
   * está en el boceto de E.2, pero el ejemplo de la DDJJ de E.5.1 vence ese día.
   */
  iibbDueDay: number
}

export type SalesPointRef = { number: number; label: string; defaultChannel: Channel }

export type PostingContext = {
  tenantId: string
  /** Hoy en Córdoba (`acc_today`). El motor nunca llama a `Date.now()`. */
  today: IsoDate
  settings: PostingSettings
  accounts: ReadonlyMap<string, AccountRef>
  sys: Readonly<Record<SystemAccountKey, AccountRef>>
  parties: ReadonlyMap<string, PartyRef>
  treasuries: ReadonlyMap<string, TreasuryRef>
  methods: ReadonlyMap<string, SalesMethodRef>
  salesPoints: ReadonlyMap<number, SalesPointRef>
  /** Solo las partidas que el formulario referencia, con su abierto actual. */
  openItems: ReadonlyMap<string, OpenItemRef>
}

// ─── Lo que propone el motor (y la RPC proyecta 1:1) ─────────────────────────

/** Partícipe existente (`id`) o creado en este mismo bundle (`ref`). */
export type PartyKey = { id: string } | { ref: string }
/** Partida existente (`lineId`) o renglón de un documento del bundle. */
export type LineKey = { lineId: string } | { doc: string; lineNo: number }

export type DocLine = {
  lineNo: number
  role: LineRole
  accountId: string
  side: Side
  amountCents: Cents
  partyRef: PartyKey | null
  dueDate: IsoDate | null
  treasuryAccountId: string | null
  salesMethodId: string | null
  vatRateBp: VatRateBp | null
  baseCents: Cents | null
  vatComputedCents: Cents | null
  taxKind: TaxKind | null
  jurisdictionCode: number | null
  channel: Channel | null
  certificateNumber: string | null
  reference: string | null
  /** Leyenda del diario: texto derivado, no entra al hash. */
  memo: string
}

export const FISCAL_AMOUNT_KEYS = [
  'net_0_cents',
  'net_25_cents',
  'vat_25_cents',
  'net_5_cents',
  'vat_5_cents',
  'net_105_cents',
  'vat_105_cents',
  'net_21_cents',
  'vat_21_cents',
  'net_27_cents',
  'vat_27_cents',
  'non_taxed_cents',
  'undiscriminated_cents',
  'exempt_cents',
  'perc_iva_cents',
  'perc_iibb_cents',
  'perc_ganancias_cents',
  'perc_municipal_cents',
  'internal_taxes_cents',
  'other_taxes_cents',
  'total_cents',
  'vat_computable_cents',
] as const
/**
 * Columnas de importe de `acc_fiscal_vouchers`. Se dejan con el nombre de la
 * columna (snake_case) a propósito: el payload de `acc_post_bundle` las manda
 * tal cual (C.3.1) y así no hay una tabla de traducción que pueda desfasarse.
 */
export type FiscalAmountKey = (typeof FISCAL_AMOUNT_KEYS)[number]
/** Importes positivos; las claves en cero se omiten (como en el payload). */
export type FiscalAmounts = Partial<Record<FiscalAmountKey, Cents>>

export type FiscalCounterparty = {
  party: PartyKey | null
  /** Foto del nombre (texto: no entra al hash). */
  name: string
  docType: AfipDocType
  docNumber: string
  ivaCondition: IvaCondition
}

export type FiscalVoucher = {
  book: FiscalBook
  voucherType: FiscalVoucherType
  afipVoucherCode: number | null
  isCreditNote: boolean
  voucherDate: IsoDate
  pointOfSale: number
  numberFrom: number
  /** Obligatorio en ventas (rango del cierre); en compras `null`. */
  numberTo: number | null
  channel: Channel | null
  counterparty: FiscalCounterparty
  amounts: FiscalAmounts
}

export type NewParty = {
  ref: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  defaultAccountId: string | null
}

export type ProposedDocument = {
  ref: string
  kind: DocumentKind
  entryKind: EntryKind
  voucherType: VoucherType | null
  afipVoucherCode: number | null
  party: PartyKey | null
  issueDate: IsoDate
  accountingDate: IsoDate
  dueDate: IsoDate | null
  pointOfSale: number | null
  number: number | null
  shift: string | null
  description: string
  notes: string | null
  totalCents: Cents
  controlAccountId: string | null
  relatedDocument: { id: string } | { ref: string } | null
  replacesDocumentId: string | null
  correctsDocumentId: string | null
  recurringExpenseId: string | null
  settlesCommissions: boolean
  countedCents: Cents | null
  expectedBookCents: Cents | null
  warningsAck: WarningKey[]
  overrideReason: string | null
  lines: DocLine[]
  fiscalVouchers: FiscalVoucher[]
}

export type ProposedAllocation = {
  debit: LineKey
  credit: LineKey
  amountCents: Cents
  kind: 'payment' | 'credit_note' | 'manual'
}

export type ProposedBundle = {
  clientRef: string
  newParties: NewParty[]
  documents: ProposedDocument[]
  allocations: ProposedAllocation[]
}

// ─── Resultado del motor ─────────────────────────────────────────────────────

/** Datos para completar el texto de un aviso o error (`{x}` de G.4). */
export type MessageDetail = Readonly<Record<string, string | number | boolean | null>>

export type PostingWarning = {
  key: WarningKey
  /** `ref` del documento del bundle al que se refiere, si es de uno solo. */
  document?: string
  detail?: MessageDetail
}

export type PostingError = {
  /** Las mismas claves que la SQL (`raise exception '<clave>'`), con su copy en `ACC_ERRORS`. */
  key: AccErrorKey
  /** Campo del formulario o ruta (`'lines.2.accountId'`) para marcar el error en su lugar. */
  field?: string
  detail?: MessageDetail
}

/** Una fila de la vista previa; compatible con `EntryLine` del kit (EntryPreview). */
export type EntryPreviewLine = {
  /** `'<ref del documento>:<line_no>'`, estable entre renders. */
  id: string
  lineNo: number
  role: LineRole
  accountId: string
  accountCode: string
  accountName: string
  partyName: string | null
  debitCents: Cents | null
  creditCents: Cents | null
  dueDate: IsoDate | null
  /** La leyenda del renglón (memo). */
  note: string | null
}

/** Lo que dibuja `EntryPreview`: un asiento por documento del bundle. */
export type EntryPreview = {
  documentRef: string
  kind: DocumentKind
  entryKind: EntryKind
  date: IsoDate
  description: string
  /** Primero el Debe y después el Haber, cada lado en el orden de `line_no` (como el diario). */
  lines: EntryPreviewLine[]
  debitCents: Cents
  creditCents: Cents
  /** Debe − Haber: 0 cuando cuadra. */
  diffCents: Cents
  balanced: boolean
}

export type PostingResult =
  | {
      ok: true
      bundle: ProposedBundle
      warnings: PostingWarning[]
      preview: EntryPreview[]
      /** `hashProposalSync(bundle)` (SHA-256 hex de la forma canónica, ver preview.ts). */
      hash: string
    }
  | { ok: false; errors: PostingError[] }

export type PostingMeta = { clientRef: string }

/** Firma de todo `build*` (E.2): determinista, misma entrada y contexto → mismo resultado. */
export type PostingBuilder<Input> = (
  input: Input,
  ctx: PostingContext,
  meta: PostingMeta,
) => PostingResult
