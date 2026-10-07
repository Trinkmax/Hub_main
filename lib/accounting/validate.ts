/**
 * Validaciones compartidas del motor (Sprint 1, E.6 y C.3.3–C.3.5).
 *
 * Es el espejo en TypeScript de lo que `acc_post_bundle` vuelve a verificar en
 * la base, con las MISMAS claves de error: así el dueño ve el problema en el
 * campo antes de tocar «Guardar», y un error de la RPC queda para la
 * concurrencia (un mes que se cerró recién, otro dueño que pagó la factura).
 *
 * - fechas, partícipe y condición frente al IVA, tipo de comprobante;
 * - la matriz de roles por tipo de documento (C.3.4): qué renglones admite cada
 *   uno, de qué lado y contra qué cuentas (`lineRule` es el espejo de
 *   `private.acc_line_rule`; los nombres de `AccountRule` son los que usa la SQL);
 * - totales por tipo y conciliación con el comprobante fiscal (C.3.5);
 * - forma del bundle, composiciones permitidas (C.3.2) e imputaciones;
 * - avisos confirmables: caja negativa, posible duplicado, registro tardío.
 *
 * Puro: todo lo que necesita viene en el `PostingContext` (y en opciones para
 * lo que no está ahí, como el primer día abierto o los saldos a compensar).
 * Las claves que la base sola puede decidir (duplicado exacto, mes cerrado
 * recién, saldo de una cuenta a la fecha) quedan para la RPC.
 */

import { daysBetween, endOfMonth, monthOf } from '@/lib/dates'
import { parseCuit } from '@/lib/fiscal'
import { sumSides } from './balance'
import { ALIQUOT_COLUMNS, vatFromNet } from './iva'
import {
  COMPENSABLE_KEYS,
  IVA_SETTLEMENT_KEYS,
  isOneOf,
  type SystemAccountKey,
  salesAccountKey,
  TAX_PAYABLE_KEYS,
  VAT_ACCOUNT_KEYS,
} from './system-keys'
import type {
  AccountRef,
  Cents,
  Channel,
  DocLine,
  DocumentKind,
  EntryKind,
  FiscalAmountKey,
  FiscalVoucher,
  IsoDate,
  IvaCondition,
  LineKey,
  LineRole,
  MessageDetail,
  NewParty,
  PartyKey,
  PartyKind,
  PostingContext,
  PostingError,
  PostingWarning,
  ProposedBundle,
  ProposedDocument,
  Side,
  TaxIdType,
  TreasuryKind,
  VatRateBp,
} from './types'
import {
  isVatComputable,
  isVoucherAllowedForKind,
  VOUCHER_CATALOG,
  voucherConditionCheck,
} from './voucher-types'

/** Tope por importe de un formulario: $ 9.999.999.999,99 (E.6, `amount_too_large`). */
export const MAX_AMOUNT_CENTS = 999_999_999_999
/** Tope físico de las columnas `_cents` (CHECK de las tablas): 1e15. */
export const DB_MAX_CENTS = 1_000_000_000_000_000
/** Diferencia chica que se puede dar por cancelada en un pago: $ 1.000,00. */
export const MAX_WRITE_OFF_CENTS = 100_000
/** Una compra con emisión de más de 60 días antes de la fecha contable avisa `late_registration`. */
export const LATE_REGISTRATION_DAYS = 60

export type ValidationIssues = { errors: PostingError[]; warnings: PostingWarning[] }

function issues(): ValidationIssues {
  return { errors: [], warnings: [] }
}

function merge(into: ValidationIssues, from: ValidationIssues): ValidationIssues {
  into.errors.push(...from.errors)
  into.warnings.push(...from.warnings)
  return into
}

function err(key: PostingError['key'], field?: string, detail?: MessageDetail): PostingError {
  const e: PostingError = { key }
  if (field !== undefined) e.field = field
  if (detail !== undefined) e.detail = detail
  return e
}

function warn(
  key: PostingWarning['key'],
  document?: string,
  detail?: MessageDetail,
): PostingWarning {
  const w: PostingWarning = { key }
  if (document !== undefined) w.document = document
  if (detail !== undefined) w.detail = detail
  return w
}

const PURCHASE_KINDS: readonly DocumentKind[] = [
  'purchase',
  'purchase_debit_note',
  'purchase_credit_note',
]
const SALES_DOC_KINDS: readonly DocumentKind[] = [
  'sales_invoice',
  'sales_debit_note',
  'sales_credit_note',
]

export function isPurchaseKind(kind: DocumentKind): boolean {
  return PURCHASE_KINDS.includes(kind)
}

export function isSalesDocumentKind(kind: DocumentKind): boolean {
  return SALES_DOC_KINDS.includes(kind)
}

/** Documentos que invierten todos los lados de su tipo base (NC). */
export function isCreditNoteKind(kind: DocumentKind): boolean {
  return kind === 'purchase_credit_note' || kind === 'sales_credit_note'
}

// ─── Importes ────────────────────────────────────────────────────────────────

/**
 * Algún importe > 0 (`amount_required`) y ninguno sobre el tope de un
 * formulario (`amount_too_large`). Los negativos o con decimales son un error
 * de programación (`invalid_bundle`): la UI ya convirtió a centavos enteros.
 */
export function validateAmounts(amounts: readonly Cents[], field?: string): PostingError[] {
  const errors: PostingError[] = []
  if (amounts.some((a) => !Number.isSafeInteger(a) || a < 0)) {
    errors.push(err('invalid_bundle', field, { reason: 'amount_not_cents' }))
    return errors
  }
  if (!amounts.some((a) => a > 0)) errors.push(err('amount_required', field))
  if (amounts.some((a) => a > MAX_AMOUNT_CENTS)) errors.push(err('amount_too_large', field))
  return errors
}

// ─── Fechas (C.3.3 pasos 5.2 y 5.3) ──────────────────────────────────────────

export type DateRulesOptions = {
  /** Primer día del primer mes abierto: antes, `period_closed`. */
  firstOpenDate?: IsoDate | null
  /** Último día del ejercicio de la fecha (para `fy_adjustment`). */
  fiscalYearEndDate?: IsoDate | null
}

export type DatedDocument = Pick<
  ProposedDocument,
  'ref' | 'kind' | 'entryKind' | 'issueDate' | 'accountingDate' | 'dueDate'
>

/**
 * - `accounting_date ≥ books_start_date` (`date_before_start`);
 * - `≤ hoy`, o `≤ fin del mes en curso` para un asiento manual (`date_in_future`);
 * - emisión ≤ fecha contable y vencimiento ≥ emisión;
 * - en compras, emisión de más de 60 días antes → aviso `late_registration`;
 * - con `firstOpenDate`: antes del primer mes abierto → `period_closed`;
 * - `fy_adjustment` exige el último día del ejercicio (`fy_adjustment_date`).
 */
export function validateDates(
  doc: DatedDocument,
  ctx: Pick<PostingContext, 'today' | 'settings'>,
  opts: DateRulesOptions = {},
): ValidationIssues {
  const out = issues()
  const { accountingDate, issueDate, dueDate } = doc

  if (accountingDate < ctx.settings.booksStartDate) {
    out.errors.push(
      err('date_before_start', 'accountingDate', { books_start_date: ctx.settings.booksStartDate }),
    )
  }
  const latest = doc.kind === 'manual' ? endOfMonth(ctx.today) : ctx.today
  // La liquidación de IVA, la anulación y el cierre de ejercicio los fecha su RPC (fin de mes, fecha
  // elegida, último día del ejercicio): la vista previa de un mes en curso no es «futura».
  const futureApplies = !RPC_ONLY_KINDS.includes(doc.kind)
  if (futureApplies && (accountingDate > latest || issueDate > latest)) {
    out.errors.push(err('date_in_future', accountingDate > latest ? 'accountingDate' : 'issueDate'))
  }
  if (issueDate > accountingDate) out.errors.push(err('accounting_before_issue', 'accountingDate'))
  if (dueDate !== null && dueDate < issueDate) out.errors.push(err('due_before_issue', 'dueDate'))

  if (opts.firstOpenDate && accountingDate < opts.firstOpenDate) {
    out.errors.push(err('period_closed', 'accountingDate', { month: monthOf(accountingDate) }))
  }
  if (
    doc.entryKind === 'fy_adjustment' &&
    opts.fiscalYearEndDate &&
    accountingDate !== opts.fiscalYearEndDate
  ) {
    out.errors.push(
      err('fy_adjustment_date', 'accountingDate', { end_date: opts.fiscalYearEndDate }),
    )
  }
  if (isPurchaseKind(doc.kind) && daysBetween(issueDate, accountingDate) > LATE_REGISTRATION_DAYS) {
    out.warnings.push(
      warn('late_registration', doc.ref, {
        issue_date: issueDate,
        accounting_month: monthOf(accountingDate),
      }),
    )
  }
  return out
}

// ─── Partícipes (C.3.3 paso 5.1) ─────────────────────────────────────────────

/** Partícipe resuelto, exista en la base o venga nuevo en el bundle. */
export type ResolvedParty = {
  key: PartyKey
  isNew: boolean
  kind: PartyKind
  name: string
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  active: boolean
  payableAccountId: string
  receivableAccountId: string
}

/**
 * Busca el partícipe de una clave. Los nuevos del bundle todavía no tienen
 * cuentas de control: la RPC les asigna las del tipo, que son Proveedores
 * («le debemos») y Deudores por ventas («nos debe»), y eso se espeja acá.
 */
export function resolveParty(
  key: PartyKey,
  ctx: Pick<PostingContext, 'parties' | 'sys'>,
  newParties: readonly NewParty[] = [],
): ResolvedParty | null {
  if ('id' in key) {
    const p = ctx.parties.get(key.id)
    if (!p) return null
    return {
      key,
      isNew: false,
      kind: p.kind,
      name: p.tradeName ?? p.name,
      taxIdType: p.taxIdType,
      taxId: p.taxId,
      ivaCondition: p.ivaCondition,
      active: p.active,
      payableAccountId: p.payableAccountId,
      receivableAccountId: p.receivableAccountId,
    }
  }
  const np = newParties.find((n) => n.ref === key.ref)
  if (!np) return null
  return {
    key,
    isNew: true,
    kind: np.kind,
    name: np.tradeName ?? np.name,
    taxIdType: np.taxIdType,
    taxId: np.taxId,
    ivaCondition: np.ivaCondition,
    active: true,
    payableAccountId: ctx.sys.payable_suppliers.id,
    receivableAccountId: ctx.sys.receivable_customers.id,
  }
}

export function samePartyKey(a: PartyKey | null, b: PartyKey | null): boolean {
  if (a === null || b === null) return a === b
  if ('id' in a && 'id' in b) return a.id === b.id
  if ('ref' in a && 'ref' in b) return a.ref === b.ref
  return false
}

const PURCHASE_PARTY_KINDS: readonly PartyKind[] = [
  'supplier',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
  'bank',
  'tax_agency',
  'payroll',
  'partner',
  'other',
]
const SALES_PARTY_KINDS: readonly PartyKind[] = ['customer', 'partner', 'other']
const COLLECTION_PARTY_KINDS: readonly PartyKind[] = [
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
  'partner',
  'other',
]

/** Si el documento exige partícipe (adoc_party_required) y de qué tipos (C.3.3 paso 5.1). */
export function partyRulesFor(kind: DocumentKind): {
  required: boolean
  kinds: readonly PartyKind[] | null
} {
  switch (kind) {
    case 'purchase':
    case 'purchase_credit_note':
    case 'purchase_debit_note':
      return { required: true, kinds: PURCHASE_PARTY_KINDS }
    case 'payment':
      return { required: true, kinds: null }
    case 'sales_invoice':
    case 'sales_credit_note':
    case 'sales_debit_note':
      return { required: true, kinds: SALES_PARTY_KINDS }
    case 'collection':
      return { required: true, kinds: COLLECTION_PARTY_KINDS }
    case 'expense':
      // Opcional, solo para estadísticas y defaults (E.5.3): sin cuenta corriente.
      return { required: false, kinds: PURCHASE_PARTY_KINDS }
    default:
      return { required: false, kinds: null }
  }
}

export function validateParty(
  doc: Pick<ProposedDocument, 'kind' | 'party' | 'voucherType'>,
  ctx: Pick<PostingContext, 'parties' | 'sys'>,
  newParties: readonly NewParty[] = [],
): { errors: PostingError[]; party: ResolvedParty | null } {
  const rules = partyRulesFor(doc.kind)
  if (doc.party === null) {
    return { errors: rules.required ? [err('party_required', 'party')] : [], party: null }
  }
  const party = resolveParty(doc.party, ctx, newParties)
  if (!party) return { errors: [err('party_not_found', 'party')], party: null }
  const errors: PostingError[] = []
  if (!party.active) errors.push(err('party_inactive', 'party'))
  if (rules.kinds && !rules.kinds.includes(party.kind)) {
    errors.push(
      err('party_kind_mismatch', 'party', {
        party_name: party.name,
        party_role: isSalesDocumentKind(doc.kind) ? 'customer' : 'supplier',
      }),
    )
  }
  if (doc.voucherType === 'ddjj_impuesto' && party.kind !== 'tax_agency') {
    errors.push(err('ddjj_requires_tax_agency', 'party'))
  }
  return { errors, party }
}

/** ¿Tiene un CUIT válido? (lo que exige un libro IVA de compras o una factura A de venta). */
export function partyHasCuit(party: Pick<ResolvedParty, 'taxIdType' | 'taxId'>): boolean {
  return party.taxIdType === 'cuit' && parseCuit(party.taxId).ok
}

// ─── Tipo de comprobante (C.3.3 paso 5.4) ────────────────────────────────────

/**
 * Tipo permitido para el documento (`invalid_voucher_for_kind`) y, en compras,
 * para la condición del partícipe: duro `invalid_voucher_for_condition`,
 * blando `voucher_condition` / `voucher_m`. Un tipo que no discrimina IVA
 * (B, C, tiques, recibos B/C, DDJJ) no admite renglones de neto ni de IVA
 * (`vat_not_allowed_for_voucher`): va todo como importe con IVA incluido.
 */
export function validateVoucher(
  doc: Pick<ProposedDocument, 'ref' | 'kind' | 'voucherType'> & {
    lines?: ReadonlyArray<Pick<DocLine, 'role'>>
  },
  party: ResolvedParty | null,
): ValidationIssues {
  const out = issues()
  if (!isVoucherAllowedForKind(doc.kind, doc.voucherType)) {
    out.errors.push(err('invalid_voucher_for_kind', 'voucherType'))
    return out
  }
  if (
    doc.voucherType &&
    isPurchaseKind(doc.kind) &&
    VOUCHER_CATALOG[doc.voucherType].purchaseVat === 'no' &&
    (doc.lines ?? []).some((l) => l.role === 'net' || l.role === 'vat')
  ) {
    out.errors.push(err('vat_not_allowed_for_voucher', 'lines'))
  }
  // La matriz es de compras (E.3). Un gasto de contado con partícipe (solo para estadísticas) no la
  // usa: no tiene comprobante fiscal y avisar «no computás el IVA» en cada gasto frenaría «Nuevo gasto».
  if (doc.voucherType && party && isPurchaseKind(doc.kind)) {
    const check = voucherConditionCheck(doc.voucherType, party.ivaCondition)
    if (check.status === 'rejected') {
      out.errors.push(
        err('invalid_voucher_for_condition', 'voucherType', {
          condition: party.ivaCondition,
          voucher_type: doc.voucherType,
        }),
      )
    }
    for (const w of check.warnings) {
      out.warnings.push(warn(w, doc.ref, { voucher_type: doc.voucherType }))
    }
  }
  return out
}

// ─── Matriz de roles (C.3.4) ─────────────────────────────────────────────────

/**
 * Regla de cuenta de cada rol: el espejo de la columna `account_rule` de
 * `private.acc_line_rule`.
 * - `imputation`: imputable, activa, sin partícipe obligatorio, no de caja, de
 *   tipo egreso o activo, y `purchase_selectable` o sin `system_key`.
 */
export type AccountRule =
  | 'imputation'
  | 'imputation_or_other_taxes'
  | 'purchase_vat'
  | 'purchase_perception'
  | 'purchase_control'
  | 'vat_credit'
  | 'vat_credit_pending'
  | 'treasury'
  | 'payment_control'
  | 'compensation'
  | 'payment_write_off'
  | 'collection_deduction'
  | 'collection_write_off'
  | 'collection_control'
  | 'cash_diff'
  | 'sales_receivable'
  | 'customer_deposits'
  | 'sales_invoiced'
  | 'sales_uninvoiced'
  | 'vat_debit'
  | 'sales_control'
  | 'bank_vat'
  | 'bank_perception'
  | 'bank_other_tax'
  | 'counterpart'
  | 'adjustment_split'
  | 'any_postable'
  | 'settlement'
  | 'reversal'
  | 'fy_result'
  | 'mirror'

export type LineRule = { sides: readonly Side[]; account: AccountRule }

const D: readonly Side[] = ['debit']
const H: readonly Side[] = ['credit']
const DH: readonly Side[] = ['debit', 'credit']

type RoleTable = Partial<Record<LineRole, LineRule>>

const PURCHASE_ROLES: RoleTable = {
  net: { sides: D, account: 'imputation' },
  vat: { sides: D, account: 'purchase_vat' },
  gross: { sides: D, account: 'imputation' },
  non_taxed: { sides: D, account: 'imputation' },
  exempt: { sides: D, account: 'imputation' },
  internal_tax: { sides: D, account: 'imputation' },
  perception: { sides: D, account: 'purchase_perception' },
  other_tax: { sides: D, account: 'imputation_or_other_taxes' },
  control: { sides: H, account: 'purchase_control' },
  vat_pending_release: { sides: H, account: 'vat_credit_pending' },
}

const SALES_DOC_ROLES: RoleTable = {
  control: { sides: D, account: 'sales_control' },
  sales_invoiced: { sides: H, account: 'sales_invoiced' },
  vat: { sides: H, account: 'vat_debit' },
}

function inverted(table: RoleTable): RoleTable {
  const out: RoleTable = {}
  for (const [role, rule] of Object.entries(table) as Array<[LineRole, LineRule]>) {
    out[role] = {
      sides: rule.sides.map((s) => (s === 'debit' ? 'credit' : 'debit')),
      account: rule.account,
    }
  }
  return out
}

const MATRIX: Readonly<Record<DocumentKind, RoleTable>> = {
  purchase: PURCHASE_ROLES,
  purchase_debit_note: PURCHASE_ROLES,
  purchase_credit_note: inverted(PURCHASE_ROLES),
  expense: {
    gross: { sides: D, account: 'imputation' },
    treasury: { sides: H, account: 'treasury' },
  },
  payment: {
    control: { sides: D, account: 'payment_control' },
    treasury: { sides: H, account: 'treasury' },
    compensation: { sides: H, account: 'compensation' },
    write_off: { sides: H, account: 'payment_write_off' },
  },
  collection: {
    treasury: { sides: D, account: 'treasury' },
    deduction: { sides: D, account: 'collection_deduction' },
    write_off: { sides: D, account: 'collection_write_off' },
    control: { sides: H, account: 'collection_control' },
  },
  sales_close: {
    treasury: { sides: D, account: 'treasury' },
    cash_diff: { sides: DH, account: 'cash_diff' },
    receivable: { sides: D, account: 'sales_receivable' },
    advance: { sides: D, account: 'customer_deposits' },
    sales_invoiced: { sides: DH, account: 'sales_invoiced' },
    sales_uninvoiced: { sides: DH, account: 'sales_uninvoiced' },
    vat: { sides: DH, account: 'vat_debit' },
  },
  sales_invoice: SALES_DOC_ROLES,
  sales_debit_note: SALES_DOC_ROLES,
  sales_credit_note: inverted(SALES_DOC_ROLES),
  transfer: { treasury: { sides: DH, account: 'treasury' } },
  bank_expense: {
    net: { sides: D, account: 'imputation' },
    vat: { sides: D, account: 'bank_vat' },
    perception: { sides: D, account: 'bank_perception' },
    gross: { sides: D, account: 'imputation' },
    other_tax: { sides: D, account: 'bank_other_tax' },
    treasury: { sides: H, account: 'treasury' },
  },
  cash_movement: {
    treasury: { sides: DH, account: 'treasury' },
    counterpart: { sides: DH, account: 'counterpart' },
  },
  treasury_adjustment: {
    treasury: { sides: DH, account: 'treasury' },
    adjustment_split: { sides: DH, account: 'adjustment_split' },
  },
  manual: { manual: { sides: DH, account: 'any_postable' } },
  opening: { opening: { sides: DH, account: 'any_postable' } },
  iva_settlement: { settlement: { sides: DH, account: 'settlement' } },
  reversal: { reversal: { sides: DH, account: 'reversal' } },
  fy_result: { fy_result: { sides: DH, account: 'fy_result' } },
  fy_closing: { mirror: { sides: DH, account: 'mirror' } },
  fy_opening: { mirror: { sides: DH, account: 'mirror' } },
}

/** `private.acc_line_rule(kind, role)`: lados y regla de cuenta, o `null` si el rol no va en ese tipo. */
export function lineRule(kind: DocumentKind, role: LineRole): LineRule | null {
  return MATRIX[kind][role] ?? null
}

/** Los roles que admite un tipo de documento, en el orden de la matriz. */
export function rolesForKind(kind: DocumentKind): LineRole[] {
  return Object.keys(MATRIX[kind]) as LineRole[]
}

/** «Imputación» de C.3.4. */
export function isImputationAccount(a: AccountRef): boolean {
  return (
    a.postable &&
    a.active &&
    !a.requiresParty &&
    !a.isTreasury &&
    (a.type === 'expense' || a.type === 'asset') &&
    (a.purchaseSelectable || a.systemKey === null)
  )
}

/** Comisión de cobro según el tipo de partícipe (deducción `comision`). */
export function commissionKeyFor(kind: PartyKind | undefined): SystemAccountKey {
  switch (kind) {
    case 'card_processor':
      return 'fees_cards'
    case 'payment_wallet':
      return 'fees_wallets'
    case 'delivery_platform':
      return 'fees_platforms'
    default:
      return 'fees_other'
  }
}

/** Cuentas que pueden explicar la diferencia de un arqueo, según el tipo de caja (C.3.4). */
export const ADJUSTMENT_SPLIT_KEYS: Readonly<Record<TreasuryKind, readonly SystemAccountKey[]>> = {
  cash: ['cash_short', 'cash_over'],
  wallet: [
    'fees_wallets',
    'iibb_sircupa',
    'vat_credit_pending',
    'interest_income',
    'reconciliation_differences',
  ],
  bank: ['bank_fees', 'interest_income', 'reconciliation_differences'],
  credit_card: ['fees_other', 'reconciliation_differences'],
  // «Otra» no está en la matriz: se admite solo lo que no puede confundir un
  // faltante de efectivo con un gasto (diferencias a conciliar y la caja).
  other: ['reconciliation_differences', 'cash_short', 'cash_over'],
}

/** Datos del documento que algunas reglas necesitan para decidir. */
type RuleScope = {
  doc: ProposedDocument
  ctx: PostingContext
  docParty: ResolvedParty | null
  lineParty: ResolvedParty | null
  treasuryKind: TreasuryKind | null
}

/**
 * ¿La cuenta cumple la regla del rol? Devuelve la clave de error si no:
 * `line_account_invalid` en general, `adjustment_account_invalid` en un arqueo,
 * `compensation_not_allowed` si quien cobra no es un organismo,
 * `invalid_line_role` si el tipo de impuesto no corresponde al rol.
 */
export function checkAccountRule(
  rule: AccountRule,
  account: AccountRef,
  line: DocLine,
  scope: RuleScope,
): PostingError['key'] | null {
  const key = account.systemKey
  const tax = line.taxKind
  const docParty = scope.docParty
  const ok = (cond: boolean) => (cond ? null : 'line_account_invalid')

  switch (rule) {
    case 'imputation':
      return ok(isImputationAccount(account))
    case 'imputation_or_other_taxes':
      return ok(isImputationAccount(account) || key === 'other_taxes_expense')
    case 'purchase_vat': {
      // Si el IVA computa va a crédito fiscal; si no, al costo (una cuenta de imputación, la del neto).
      const voucher = scope.doc.voucherType
      if (!docParty || !voucher) return ok(key === 'vat_credit' || isImputationAccount(account))
      const computable = isVatComputable(
        voucher,
        docParty.ivaCondition,
        scope.ctx.settings.ivaCondition,
      )
      return ok(computable ? key === 'vat_credit' : isImputationAccount(account))
    }
    case 'bank_vat':
      // Crédito fiscal solo si el gasto entra al libro IVA (banco con CUIT y comprobante); si no, al gasto.
      return ok(
        scope.doc.fiscalVouchers.length > 0 ? key === 'vat_credit' : isImputationAccount(account),
      )
    case 'purchase_perception':
      switch (tax) {
        case 'iva':
          return ok(key === 'vat_perceptions')
        case 'iibb':
          return ok(key === 'iibb_perceptions')
        case 'ganancias':
          return ok(key === 'income_tax_perceptions')
        case 'municipal':
          return ok(key === 'other_taxes_expense')
        default:
          return 'invalid_line_role'
      }
    case 'bank_perception':
      return tax === 'iva' ? ok(key === 'vat_perceptions') : 'invalid_line_role'
    case 'purchase_control':
      if (!docParty) return 'line_account_invalid'
      return ok(
        account.requiresParty &&
          (account.id === docParty.payableAccountId ||
            (docParty.kind === 'tax_agency' && isOneOf(key, TAX_PAYABLE_KEYS))),
      )
    case 'vat_credit':
      return ok(key === 'vat_credit')
    case 'vat_credit_pending':
      return ok(key === 'vat_credit_pending')
    case 'treasury':
      return ok(account.isTreasury)
    case 'payment_control':
      return ok(account.requiresParty)
    case 'compensation':
      if (!docParty || docParty.kind !== 'tax_agency') return 'compensation_not_allowed'
      return ok(isOneOf(key, COMPENSABLE_KEYS))
    case 'payment_write_off':
      return ok(key === 'discounts_obtained' || key === 'other_income')
    case 'collection_deduction': {
      const commission = commissionKeyFor(docParty?.kind)
      switch (tax) {
        case 'comision':
          return ok(key === commission)
        case 'iva_comision':
          return ok(key === 'vat_credit' || key === 'vat_credit_pending' || key === commission)
        case 'percepcion_iva_comision':
          return ok(key === 'vat_perceptions')
        case 'ret_iva':
          return ok(key === 'vat_withholdings')
        case 'ret_iibb':
          return ok(key === 'iibb_withholdings')
        case 'sircupa':
          return ok(key === 'iibb_sircupa')
        case 'ret_ganancias':
          return ok(key === 'income_tax_withholdings')
        case 'diferencia':
          return ok(key === 'reconciliation_differences')
        case 'otro':
          return ok(isImputationAccount(account))
        default:
          return 'invalid_line_role'
      }
    }
    case 'collection_write_off':
      return ok(key === 'fees_other')
    case 'collection_control':
      if (!docParty) return 'line_account_invalid'
      return ok(account.id === docParty.receivableAccountId || key === 'receivable_customers')
    case 'cash_diff':
      return ok(line.side === 'debit' ? key === 'cash_short' : key === 'cash_over')
    case 'sales_receivable': {
      const party = scope.lineParty
      return ok(
        account.requiresParty &&
          party !== null &&
          (account.id === party.receivableAccountId || key === 'receivable_customers'),
      )
    }
    case 'customer_deposits':
      return ok(key === 'customer_deposits')
    case 'sales_invoiced':
      return line.channel ? ok(key === salesAccountKey(line.channel, true)) : 'invalid_bundle'
    case 'sales_uninvoiced':
      if (!line.channel) return 'invalid_bundle'
      return ok(
        key === salesAccountKey(line.channel, false) ||
          (scope.ctx.settings.uninvoicedSalesMode === 'single_account' &&
            key === salesAccountKey(line.channel, true)),
      )
    case 'vat_debit':
      return ok(key === 'vat_debit')
    case 'sales_control':
      if (!docParty) return 'line_account_invalid'
      return ok(account.id === docParty.receivableAccountId)
    case 'bank_other_tax':
      switch (tax) {
        case 'ley_25413_credito':
        case 'ley_25413_debito':
          return ok(key === 'bank_tax_credit' || key === 'bank_tax_expense')
        case 'sircreb':
          return ok(key === 'iibb_sircreb')
        case 'interes':
          return ok(key === 'interest_expense')
        case 'otro':
          return ok(isImputationAccount(account))
        default:
          return 'invalid_line_role'
      }
    case 'counterpart':
      return ok(account.postable && !account.isTreasury && !isOneOf(key, VAT_ACCOUNT_KEYS))
    case 'adjustment_split': {
      const allowed = scope.treasuryKind ? ADJUSTMENT_SPLIT_KEYS[scope.treasuryKind] : []
      return isOneOf(key, allowed) ? null : 'adjustment_account_invalid'
    }
    case 'any_postable':
      return ok(account.postable)
    case 'settlement':
      return ok(isOneOf(key, IVA_SETTLEMENT_KEYS))
    case 'reversal':
      return null
    case 'fy_result':
      return ok(
        account.type === 'income' || account.type === 'expense' || key === 'current_year_result',
      )
    case 'mirror':
      return ok(
        account.type === 'asset' || account.type === 'liability' || account.type === 'equity',
      )
  }
}

/** Roles que llevan tipo de impuesto (adl_tax_kind_roles; `vat` lo admite opcional). */
const TAX_KIND_ROLES: ReadonlySet<LineRole> = new Set([
  'perception',
  'other_tax',
  'deduction',
  'adjustment_split',
  'compensation',
])
/** Roles que llevan canal (adl_channel_roles); `receivable`, `treasury` y `vat` lo admiten opcional. */
const CHANNEL_ROLES: ReadonlySet<LineRole> = new Set(['sales_invoiced', 'sales_uninvoiced'])
const CHANNEL_OPTIONAL_ROLES: ReadonlySet<LineRole> = new Set(['receivable', 'treasury', 'vat'])

/**
 * Los renglones de un documento contra la matriz (C.3.3 paso 6 y la forma de
 * cada columna de `acc_document_lines`): rol y lado permitidos, cuenta del bar,
 * imputable, activa y de la regla del rol, partícipe ⇔ cuenta de control, la
 * línea `control` con EL partícipe del documento, cajas y medios coherentes,
 * vencimiento solo con partícipe, IVA calculado exacto.
 */
export function validateLines(
  doc: ProposedDocument,
  ctx: PostingContext,
  newParties: readonly NewParty[] = [],
): PostingError[] {
  const errors: PostingError[] = []
  const docParty = doc.party ? resolveParty(doc.party, ctx, newParties) : null
  const treasuryKind = docTreasuryKind(doc, ctx)
  const seenLineNos = new Set<number>()

  doc.lines.forEach((line, index) => {
    const field = `lines.${index}`
    const where = { document: doc.ref, line_no: line.lineNo }

    // Forma de la columna (los CHECK de adl_*): si falla es un error del motor.
    if (
      !Number.isSafeInteger(line.lineNo) ||
      line.lineNo < 1 ||
      line.lineNo > 500 ||
      seenLineNos.has(line.lineNo)
    ) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'line_no' }))
    }
    seenLineNos.add(line.lineNo)
    if (
      !Number.isSafeInteger(line.amountCents) ||
      line.amountCents < 1 ||
      line.amountCents > DB_MAX_CENTS
    ) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'amount' }))
      return
    }
    if (line.amountCents > MAX_AMOUNT_CENTS) errors.push(err('amount_too_large', field, where))
    if ((line.taxKind !== null) !== TAX_KIND_ROLES.has(line.role) && line.role !== 'vat') {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'tax_kind' }))
    }
    if (
      (line.channel !== null) !== CHANNEL_ROLES.has(line.role) &&
      !CHANNEL_OPTIONAL_ROLES.has(line.role)
    ) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'channel' }))
    }
    if (line.role === 'net' && (line.vatRateBp === null || line.baseCents !== line.amountCents)) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'net_shape' }))
    }
    if (line.role === 'vat') {
      if (line.vatRateBp === null || line.baseCents === null || line.vatComputedCents === null) {
        errors.push(err('invalid_bundle', field, { ...where, reason: 'vat_shape' }))
      } else if (line.vatComputedCents !== vatFromNet(line.baseCents, line.vatRateBp)) {
        errors.push(err('vat_computed_mismatch', field, where))
      }
    }
    if (line.dueDate !== null && line.partyRef === null) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'due_without_party' }))
    }
    if (
      line.jurisdictionCode !== null &&
      (!Number.isInteger(line.jurisdictionCode) ||
        line.jurisdictionCode < 901 ||
        line.jurisdictionCode > 924)
    ) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'jurisdiction' }))
    }
    if (
      (line.certificateNumber !== null && line.certificateNumber.length > 40) ||
      (line.reference !== null && line.reference.length > 60) ||
      line.memo.length > 200
    ) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'text_length' }))
    }

    // Rol y lado.
    const rule = lineRule(doc.kind, line.role)
    if (!rule?.sides.includes(line.side)) {
      errors.push(err('invalid_line_role', field, { ...where, role: line.role }))
      return
    }
    if (
      doc.kind === 'purchase' ||
      doc.kind === 'purchase_debit_note' ||
      doc.kind === 'purchase_credit_note'
    ) {
      // La factura mensual de comisiones solo pasa el IVA a crédito fiscal (E.5.1).
      const commissionsRole = line.role === 'vat' || line.role === 'vat_pending_release'
      if (doc.settlesCommissions ? !commissionsRole : line.role === 'vat_pending_release') {
        errors.push(err('invalid_line_role', field, { ...where, role: line.role }))
        return
      }
      if (doc.settlesCommissions && line.role === 'vat') {
        const vatAccount = ctx.accounts.get(line.accountId)
        if (vatAccount && vatAccount.systemKey !== 'vat_credit') {
          errors.push(err('line_account_invalid', field, where))
        }
      }
    }
    if (line.role === 'perception' && line.taxKind === 'iibb' && line.jurisdictionCode === null) {
      errors.push(err('invalid_bundle', field, { ...where, reason: 'jurisdiction_required' }))
    }

    // Cuenta.
    const account = ctx.accounts.get(line.accountId)
    if (!account) {
      errors.push(err('account_not_found', field, where))
      return
    }
    const accountDetail = { ...where, account_code: account.code, account_name: account.name }
    if (!account.postable) {
      errors.push(err('account_not_postable', field, accountDetail))
      return
    }
    // La anulación espeja los renglones del original: admite cuentas desactivadas.
    if (!account.active && doc.kind !== 'reversal') {
      errors.push(err('account_inactive', field, accountDetail))
    }

    // Partícipe ⇔ cuenta de control (los espejos del cierre de ejercicio nunca llevan).
    const lineParty = line.partyRef ? resolveParty(line.partyRef, ctx, newParties) : null
    if (line.role === 'mirror') {
      if (line.partyRef !== null) errors.push(err('party_not_allowed', field, accountDetail))
    } else if (account.requiresParty && line.partyRef === null) {
      errors.push(err('account_requires_party', field, accountDetail))
    } else if (!account.requiresParty && line.partyRef !== null) {
      errors.push(err('party_not_allowed', field, accountDetail))
    }
    if (line.partyRef !== null && lineParty === null) {
      errors.push(err('party_not_found', field, where))
    }
    // La línea de control, la liberación de «IVA a documentar» y una deducción con partícipe
    // (el IVA de la comisión a documentar) son del partícipe del documento, no de otro.
    const partyBound =
      line.role === 'control' ||
      line.role === 'vat_pending_release' ||
      (line.role === 'deduction' && account.requiresParty)
    if (partyBound && !samePartyKey(line.partyRef, doc.party)) {
      errors.push(err('control_party_mismatch', field, where))
    }

    // Caja.
    if (line.role === 'treasury') {
      const treasury = line.treasuryAccountId
        ? ctx.treasuries.get(line.treasuryAccountId)
        : undefined
      if (!treasury?.active || treasury.accountId !== line.accountId) {
        errors.push(err('treasury_mismatch', field, where))
      }
    } else if (line.treasuryAccountId !== null) {
      errors.push(err('treasury_mismatch', field, where))
    }

    // Medio de cobro: en el cierre del día, cada caja, partida y seña dice de qué medio viene.
    if (
      doc.kind === 'sales_close' &&
      line.salesMethodId === null &&
      (line.role === 'treasury' || line.role === 'receivable' || line.role === 'advance')
    ) {
      errors.push(err('sales_method_mismatch', field, where))
    } else if (line.salesMethodId !== null) {
      const methodError = checkSalesMethod(line, account, lineParty, ctx)
      if (methodError) errors.push(err(methodError, field, where))
    }

    // Regla de cuenta del rol.
    const ruleError = checkAccountRule(rule.account, account, line, {
      doc,
      ctx,
      docParty,
      lineParty,
      treasuryKind,
    })
    if (ruleError) {
      const detail =
        ruleError === 'adjustment_account_invalid'
          ? { ...accountDetail, treasury_name: docTreasuryName(doc, ctx) }
          : accountDetail
      errors.push(err(ruleError, field, detail))
    }
  })

  return errors
}

/** El tipo de la caja del documento (la de su renglón `treasury`), para el arqueo. */
function docTreasuryKind(doc: ProposedDocument, ctx: PostingContext): TreasuryKind | null {
  const line = doc.lines.find((l) => l.role === 'treasury' && l.treasuryAccountId !== null)
  if (!line?.treasuryAccountId) return null
  return ctx.treasuries.get(line.treasuryAccountId)?.kind ?? null
}

function docTreasuryName(doc: ProposedDocument, ctx: PostingContext): string | null {
  const line = doc.lines.find((l) => l.role === 'treasury' && l.treasuryAccountId !== null)
  if (!line?.treasuryAccountId) return null
  return ctx.treasuries.get(line.treasuryAccountId)?.name ?? null
}

/**
 * `sales_method_id` activo y coherente con la cuenta y el partícipe del renglón
 * (C.3.3 paso 6): efectivo → su caja; a cobrar → la cuenta «nos debe» del
 * partícipe del medio; cuenta corriente → un cliente; seña → «Señas».
 */
function checkSalesMethod(
  line: DocLine,
  account: AccountRef,
  lineParty: ResolvedParty | null,
  ctx: PostingContext,
): 'sales_method_mismatch' | null {
  const method = line.salesMethodId ? ctx.methods.get(line.salesMethodId) : undefined
  if (!method) return 'sales_method_mismatch'
  const partyId = line.partyRef && 'id' in line.partyRef ? line.partyRef.id : null
  switch (line.role) {
    case 'treasury':
      return method.kind === 'treasury' && method.treasuryAccountId === line.treasuryAccountId
        ? null
        : 'sales_method_mismatch'
    case 'receivable':
      if (method.kind === 'receivable' || method.kind === 'settled_now') {
        return partyId === method.partyId && lineParty?.receivableAccountId === account.id
          ? null
          : 'sales_method_mismatch'
      }
      if (method.kind === 'customer_account') {
        return lineParty?.kind === 'customer' ||
          lineParty?.kind === 'partner' ||
          lineParty?.kind === 'other'
          ? null
          : 'sales_method_mismatch'
      }
      return 'sales_method_mismatch'
    case 'advance':
      return method.kind === 'advance' && partyId === method.partyId
        ? null
        : 'sales_method_mismatch'
    default:
      // Deducciones del arqueo de billetera atribuidas a un medio (QR, transferencia): alcanza con que exista.
      return null
  }
}

// ─── Cantidades por rol y cuadre ─────────────────────────────────────────────

function countRole(doc: ProposedDocument, role: LineRole): number {
  return doc.lines.filter((l) => l.role === role).length
}

function sumRole(doc: ProposedDocument, role: LineRole, side?: Side): Cents {
  return doc.lines
    .filter((l) => l.role === role && (side === undefined || l.side === side))
    .reduce((acc, l) => acc + l.amountCents, 0)
}

/** Σ con signo (Haber +, Debe −) de los renglones de un rol: ventas e IVA del cierre del día. */
function signedCredit(lines: readonly DocLine[]): Cents {
  return lines.reduce((acc, l) => acc + (l.side === 'credit' ? l.amountCents : -l.amountCents), 0)
}

/**
 * Lo que vale para todo el documento: tiene renglones (y un manual al menos
 * dos), cuadra, cantidades por rol (C.3.4: una caja en un gasto, dos cajas
 * distintas en un movimiento, una sola cuenta de control en pagos y cobros…).
 */
export function validateStructure(
  doc: ProposedDocument,
  ctx: PostingContext,
  opts: ValidateOptions = {},
): PostingError[] {
  const errors: PostingError[] = []
  if (doc.lines.length === 0) {
    errors.push(err('amount_required', 'lines'))
    return errors
  }
  if ((doc.kind === 'manual' || doc.kind === 'opening') && doc.lines.length < 2) {
    errors.push(err('entry_too_few_lines', 'lines'))
  }
  if (doc.lines.length > 500)
    errors.push(err('invalid_bundle', 'lines', { reason: 'too_many_lines' }))

  const sums = sumSides(doc.lines)
  if (sums.diff !== 0n) {
    errors.push(
      err('entry_not_balanced', 'lines', {
        debit_cents: Number(sums.debit),
        credit_cents: Number(sums.credit),
      }),
    )
  }

  const treasuries = countRole(doc, 'treasury')
  switch (doc.kind) {
    case 'expense':
      if (treasuries !== 1)
        errors.push(err('invalid_bundle', 'lines', { reason: 'expense_treasury' }))
      if (countRole(doc, 'gross') > 20) {
        errors.push(err('invalid_bundle', 'lines', { reason: 'expense_lines' }))
      }
      break
    case 'bank_expense':
    case 'cash_movement':
      if (treasuries !== 1) errors.push(err('invalid_bundle', 'lines', { reason: 'one_treasury' }))
      break
    case 'transfer': {
      const lines = doc.lines.filter((l) => l.role === 'treasury')
      const debit = lines.filter((l) => l.side === 'debit')
      const credit = lines.filter((l) => l.side === 'credit')
      if (lines.length !== 2 || debit.length !== 1 || credit.length !== 1) {
        errors.push(err('invalid_bundle', 'lines', { reason: 'transfer_shape' }))
      } else if (debit[0]?.treasuryAccountId === credit[0]?.treasuryAccountId) {
        errors.push(err('same_treasury', 'lines'))
      }
      break
    }
    case 'payment': {
      if (treasuries + countRole(doc, 'compensation') === 0) {
        errors.push(err('amount_required', 'methods'))
      }
      const writeOff = sumRole(doc, 'write_off')
      if (writeOff > MAX_WRITE_OFF_CENTS)
        errors.push(err('invalid_bundle', 'writeOff', { reason: 'write_off_cap' }))
      if (new Set(doc.lines.filter((l) => l.role === 'control').map((l) => l.accountId)).size > 1) {
        errors.push(err('mixed_control_accounts', 'applications'))
      }
      // Nunca más que el saldo de cada cuenta compensable a la fecha (si el formulario lo trae).
      if (opts.compensationBalances) {
        const used = new Map<string, Cents>()
        for (const l of doc.lines) {
          if (l.role === 'compensation')
            used.set(l.accountId, (used.get(l.accountId) ?? 0) + l.amountCents)
        }
        for (const [accountId, amount] of used) {
          const available = opts.compensationBalances.get(accountId) ?? 0
          if (amount > available) {
            const account = ctx.accounts.get(accountId)
            errors.push(
              err('compensation_exceeds_balance', 'methods', {
                available_cents: available,
                account_code: account?.code ?? null,
                account_name: account?.name ?? null,
              }),
            )
          }
        }
      }
      break
    }
    case 'collection':
      if (new Set(doc.lines.filter((l) => l.role === 'control').map((l) => l.accountId)).size > 1) {
        errors.push(err('mixed_control_accounts', 'applications'))
      }
      if (doc.countedCents !== null) {
        // Arqueo de billetera: la caja es una billetera y lo que entró es contado − libro.
        const line = doc.lines.find((l) => l.role === 'treasury')
        const treasury = line?.treasuryAccountId
          ? ctx.treasuries.get(line.treasuryAccountId)
          : undefined
        if (treasury && treasury.kind !== 'wallet') {
          errors.push(err('invalid_bundle', 'treasuryAccountId', { reason: 'wallet_check_kind' }))
        }
        if (doc.expectedBookCents === null) {
          errors.push(err('invalid_bundle', 'expectedBookCents', { reason: 'balance_check_pair' }))
        } else if (
          doc.countedCents - doc.expectedBookCents !==
          sumRole(doc, 'treasury', 'debit') - sumRole(doc, 'treasury', 'credit')
        ) {
          errors.push(err('balance_check_mismatch', 'countedCents'))
        }
      }
      break
    case 'treasury_adjustment': {
      if (treasuries !== 1) errors.push(err('invalid_bundle', 'lines', { reason: 'one_treasury' }))
      if (doc.countedCents === null || doc.expectedBookCents === null) {
        errors.push(err('invalid_bundle', 'countedCents', { reason: 'balance_check_pair' }))
      } else {
        const delta = sumRole(doc, 'treasury', 'debit') - sumRole(doc, 'treasury', 'credit')
        if (doc.countedCents - doc.expectedBookCents !== delta) {
          errors.push(err('balance_check_mismatch', 'countedCents'))
        }
      }
      break
    }
    default:
      break
  }
  if (
    doc.kind !== 'treasury_adjustment' &&
    doc.kind !== 'collection' &&
    doc.countedCents !== null
  ) {
    errors.push(err('invalid_bundle', 'countedCents', { reason: 'balance_check_kind' }))
  }
  return errors
}

// ─── Totales por tipo (C.3.5, columna izquierda) ─────────────────────────────

/**
 * El total que el tipo de documento dice que tiene que tener, a partir de sus
 * renglones, o `null` si no hay regla (la liquidación y los espejos los arma
 * la SQL). Ver C.3.5.
 */
export function expectedDocumentTotal(doc: ProposedDocument): Cents | null {
  const control = sumRole(doc, 'control')
  switch (doc.kind) {
    case 'purchase':
    case 'purchase_debit_note':
    case 'purchase_credit_note':
      // Con `settles_commissions` no hay control: el total es el de la factura (el libro lo concilia).
      return doc.settlesCommissions ? null : control
    case 'expense':
    case 'bank_expense':
    case 'cash_movement':
    case 'treasury_adjustment':
      return sumRole(doc, 'treasury')
    case 'payment':
    case 'collection':
    case 'sales_invoice':
    case 'sales_debit_note':
    case 'sales_credit_note':
      return control
    case 'transfer': {
      const line = doc.lines.find((l) => l.role === 'treasury')
      return line ? line.amountCents : 0
    }
    case 'sales_close': {
      // Lo vendido: cajas + diferencia de caja con signo (faltante +, sobrante −) + partidas + señas.
      const cashDiff = sumRole(doc, 'cash_diff', 'debit') - sumRole(doc, 'cash_diff', 'credit')
      return (
        sumRole(doc, 'treasury') + cashDiff + sumRole(doc, 'receivable') + sumRole(doc, 'advance')
      )
    }
    case 'manual':
    case 'opening':
    case 'reversal':
    case 'iva_settlement':
    case 'fy_result':
    case 'fy_closing':
    case 'fy_opening':
      return Number(sumSides(doc.lines).debit)
  }
}

/** `total_cents` contra los renglones (C.3.3 paso 8: `total_mismatch`). */
export function validateTotals(doc: ProposedDocument): PostingError[] {
  const errors: PostingError[] = []
  if (
    !Number.isSafeInteger(doc.totalCents) ||
    doc.totalCents < 0 ||
    doc.totalCents > DB_MAX_CENTS
  ) {
    return [err('invalid_bundle', 'totalCents', { reason: 'total_range' })]
  }
  const expected = expectedDocumentTotal(doc)
  if (expected !== null && expected !== doc.totalCents) {
    errors.push(
      err('total_mismatch', 'totalCents', {
        computed_cents: expected,
        control_cents: doc.totalCents,
      }),
    )
  }
  if (doc.kind === 'expense') {
    const gross = sumRole(doc, 'gross')
    if (gross !== doc.totalCents) {
      errors.push(
        err('total_mismatch', 'totalCents', {
          computed_cents: gross,
          control_cents: doc.totalCents,
        }),
      )
    }
  }
  if (doc.kind === 'transfer') {
    const amounts = new Set(
      doc.lines.filter((l) => l.role === 'treasury').map((l) => l.amountCents),
    )
    if (amounts.size > 1)
      errors.push(err('invalid_bundle', 'lines', { reason: 'transfer_amounts' }))
  }
  return errors
}

// ─── Comprobantes fiscales (C.3.3 paso 9 y C.3.5, columna derecha) ───────────

/** ¿El documento lleva comprobante fiscal? `required` | `forbidden` | `optional`. */
export function fiscalVoucherRule(
  doc: Pick<ProposedDocument, 'kind' | 'voucherType'>,
): 'required' | 'forbidden' | 'optional' {
  switch (doc.kind) {
    case 'purchase':
    case 'purchase_debit_note':
    case 'purchase_credit_note':
    case 'sales_invoice':
    case 'sales_debit_note':
    case 'sales_credit_note':
      return doc.voucherType && VOUCHER_CATALOG[doc.voucherType].ivaBook ? 'required' : 'forbidden'
    case 'collection':
    case 'bank_expense':
      return doc.voucherType ? 'optional' : 'forbidden'
    case 'sales_close':
      return 'optional'
    default:
      return 'forbidden'
  }
}

function amountOf(fv: FiscalVoucher, key: FiscalAmountKey): Cents {
  return fv.amounts[key] ?? 0
}

const FISCAL_PARTS: readonly FiscalAmountKey[] = [
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
]

const VAT_KEYS_OF_ROW: readonly FiscalAmountKey[] = [
  'vat_25_cents',
  'vat_5_cents',
  'vat_105_cents',
  'vat_21_cents',
  'vat_27_cents',
]

/**
 * La forma de una fila (los CHECK de `acc_fiscal_vouchers`): importes positivos,
 * total = Σ partes, computable ≤ IVA, en ventas rango y canal. Los rangos se
 * informan con su clave de carga (`range_required`, `range_invalid`); el resto
 * es un error del motor (`fiscal_mismatch`).
 */
function fiscalShapeIssue(fv: FiscalVoucher): PostingError['key'] | null {
  if (fv.book === 'sales' && fv.numberTo === null) return 'range_required'
  if (fv.numberTo !== null && fv.numberTo < fv.numberFrom) return 'range_invalid'
  if (
    !Number.isInteger(fv.pointOfSale) ||
    fv.pointOfSale < 0 ||
    fv.pointOfSale > 99_999 ||
    !Number.isInteger(fv.numberFrom) ||
    fv.numberFrom < 1 ||
    fv.numberFrom > 99_999_999 ||
    (fv.numberTo !== null && fv.numberTo > 99_999_999)
  ) {
    return 'range_invalid'
  }
  for (const value of Object.values(fv.amounts)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) return 'fiscal_mismatch'
  }
  const parts = FISCAL_PARTS.reduce((acc, k) => acc + amountOf(fv, k), 0)
  if (parts !== amountOf(fv, 'total_cents')) return 'fiscal_mismatch'
  const vat = VAT_KEYS_OF_ROW.reduce((acc, k) => acc + amountOf(fv, k), 0)
  if (amountOf(fv, 'vat_computable_cents') > vat) return 'fiscal_mismatch'
  if (fv.book === 'sales' && (fv.channel === null || amountOf(fv, 'undiscriminated_cents') > 0)) {
    return 'fiscal_mismatch'
  }
  return null
}

/** ¿La contraparte tiene CUIT (documento 80, 11 dígitos válidos)? */
function counterpartyHasCuit(fv: FiscalVoucher): boolean {
  return fv.counterparty.docType === 80 && parseCuit(fv.counterparty.docNumber).ok
}

/**
 * Comprobantes fiscales del documento: presencia (`fiscal_voucher_missing`,
 * `fiscal_voucher_not_allowed`), identidad igual a la del documento, CUIT de la
 * contraparte en compras y en las A de venta (`party_tax_id_required`), forma de
 * cada fila y conciliación con los renglones (`fiscal_mismatch`).
 */
export function validateFiscalVouchers(
  doc: ProposedDocument,
  ctx: PostingContext,
  party: ResolvedParty | null,
): PostingError[] {
  const errors: PostingError[] = []
  const rule = fiscalVoucherRule(doc)
  const n = doc.fiscalVouchers.length
  if (rule === 'required' && n === 0) return [err('fiscal_voucher_missing', 'fiscalVouchers')]
  if (rule === 'forbidden' && n > 0) return [err('fiscal_voucher_not_allowed', 'fiscalVouchers')]
  if (n > 50)
    return [err('invalid_bundle', 'fiscalVouchers', { reason: 'too_many_fiscal_vouchers' })]
  // Un cierre del día sin filas facturadas igual concilia: todo lo vendido tiene que ir «sin factura».
  if (n === 0 && doc.kind !== 'sales_close') return errors

  const accountingMonth = monthOf(doc.accountingDate)
  for (const [i, fv] of doc.fiscalVouchers.entries()) {
    const field = `fiscalVouchers.${i}`
    const shape = fiscalShapeIssue(fv)
    if (shape) {
      errors.push(err(shape, field, { document: doc.ref, reason: 'shape' }))
      continue
    }
    const letterA = VOUCHER_CATALOG[fv.voucherType].letter === 'A'
    if ((fv.book === 'purchases' || letterA) && !counterpartyHasCuit(fv)) {
      errors.push(err('party_tax_id_required', 'party', { party_name: fv.counterparty.name }))
    }
    if (monthOf(fv.voucherDate) > accountingMonth) {
      errors.push(
        err('fiscal_mismatch', field, { document: doc.ref, reason: 'voucher_after_book_month' }),
      )
    }
    // Un solo comprobante por documento (compras y ventas sueltas): misma identidad que la cabecera.
    if (rule === 'required') {
      const sameIdentity =
        fv.voucherType === doc.voucherType &&
        fv.afipVoucherCode === doc.afipVoucherCode &&
        fv.pointOfSale === doc.pointOfSale &&
        fv.numberFrom === doc.number &&
        fv.voucherDate === doc.issueDate &&
        fv.book === (isPurchaseKind(doc.kind) ? 'purchases' : 'sales')
      if (!sameIdentity) {
        errors.push(err('fiscal_mismatch', field, { document: doc.ref, reason: 'identity' }))
      }
      if (party && fv.counterparty.party && !samePartyKey(fv.counterparty.party, party.key)) {
        errors.push(err('fiscal_mismatch', field, { document: doc.ref, reason: 'counterparty' }))
      }
    }
  }
  if (errors.length > 0) return errors

  const reason = reconcileFiscal(doc, ctx)
  if (reason) errors.push(err('fiscal_mismatch', 'fiscalVouchers', { document: doc.ref, reason }))
  return errors
}

/** Σ de una columna en las filas, con signo (las NC restan) si `signed`. */
function sumColumn(rows: readonly FiscalVoucher[], key: FiscalAmountKey, signed = false): Cents {
  return rows.reduce((acc, fv) => acc + (signed && fv.isCreditNote ? -1 : 1) * amountOf(fv, key), 0)
}

function linesOf(doc: ProposedDocument, role: LineRole, rate?: VatRateBp): DocLine[] {
  return doc.lines.filter((l) => l.role === role && (rate === undefined || l.vatRateBp === rate))
}

function sumLines(lines: readonly DocLine[]): Cents {
  return lines.reduce((acc, l) => acc + l.amountCents, 0)
}

const RATES: readonly VatRateBp[] = [0, 250, 500, 1050, 2100, 2700]

/**
 * Conciliación de `private.acc_reconcile_fiscal` (C.3.5). Devuelve el primer
 * desvío (para el log) o `null` si todo concilia. Las comparaciones son
 * exactas: el motor arma los dos lados con los mismos centavos.
 */
export function reconcileFiscal(doc: ProposedDocument, ctx: PostingContext): string | null {
  const rows = doc.fiscalVouchers
  if (rows.length === 0 && doc.kind !== 'sales_close') return null

  if (isPurchaseKind(doc.kind)) {
    const fv = rows[0]
    if (!fv || rows.length !== 1) return 'purchase_rows'
    const vatCredit = (l: DocLine) => ctx.accounts.get(l.accountId)?.systemKey === 'vat_credit'
    if (doc.settlesCommissions) {
      const vat = sumLines(linesOf(doc, 'vat'))
      const vatRows = VAT_KEYS_OF_ROW.reduce((acc, k) => acc + amountOf(fv, k), 0)
      if (vat !== vatRows) return 'commissions_vat'
      if (vat !== amountOf(fv, 'vat_computable_cents')) return 'commissions_computable'
      if (vat !== sumLines(linesOf(doc, 'vat_pending_release'))) return 'commissions_release'
      if (amountOf(fv, 'total_cents') !== doc.totalCents) return 'commissions_total'
      return null
    }
    for (const rate of RATES) {
      const cols = ALIQUOT_COLUMNS[rate]
      if (sumLines(linesOf(doc, 'net', rate)) !== amountOf(fv, cols.net)) return `net_${rate}`
      const vatLines = sumLines(linesOf(doc, 'vat', rate))
      if (cols.vat ? vatLines !== amountOf(fv, cols.vat) : vatLines !== 0) return `vat_${rate}`
    }
    if (
      sumLines(doc.lines.filter((l) => l.role === 'vat' && vatCredit(l))) !==
      amountOf(fv, 'vat_computable_cents')
    ) {
      return 'vat_computable'
    }
    if (sumLines(linesOf(doc, 'gross')) !== amountOf(fv, 'undiscriminated_cents'))
      return 'undiscriminated'
    if (sumLines(linesOf(doc, 'non_taxed')) !== amountOf(fv, 'non_taxed_cents')) return 'non_taxed'
    if (sumLines(linesOf(doc, 'exempt')) !== amountOf(fv, 'exempt_cents')) return 'exempt'
    if (sumLines(linesOf(doc, 'internal_tax')) !== amountOf(fv, 'internal_taxes_cents'))
      return 'internal_taxes'
    if (sumLines(linesOf(doc, 'other_tax')) !== amountOf(fv, 'other_taxes_cents'))
      return 'other_taxes'
    const perception = (tax: DocLine['taxKind']) =>
      sumLines(doc.lines.filter((l) => l.role === 'perception' && l.taxKind === tax))
    if (perception('iva') !== amountOf(fv, 'perc_iva_cents')) return 'perc_iva'
    if (perception('iibb') !== amountOf(fv, 'perc_iibb_cents')) return 'perc_iibb'
    if (perception('ganancias') !== amountOf(fv, 'perc_ganancias_cents')) return 'perc_ganancias'
    if (perception('municipal') !== amountOf(fv, 'perc_municipal_cents')) return 'perc_municipal'
    if (amountOf(fv, 'total_cents') !== doc.totalCents) return 'total'
    return null
  }

  if (doc.kind === 'collection') {
    // Comprobante de la comisión (liquidación o factura): lo descontado contra la fila.
    const fv = rows[0]
    if (!fv || rows.length !== 1) return 'collection_rows'
    const deduction = (tax: DocLine['taxKind']) =>
      linesOf(doc, 'deduction').filter((l) => l.taxKind === tax)
    if (sumLines(deduction('comision')) !== amountOf(fv, 'net_21_cents')) return 'commission_net'
    if (sumLines(deduction('iva_comision')) !== amountOf(fv, 'vat_21_cents'))
      return 'commission_vat'
    if (sumLines(deduction('percepcion_iva_comision')) !== amountOf(fv, 'perc_iva_cents')) {
      return 'commission_perception'
    }
    const computable = deduction('iva_comision').filter(
      (l) => ctx.accounts.get(l.accountId)?.systemKey === 'vat_credit',
    )
    if (sumLines(computable) !== amountOf(fv, 'vat_computable_cents'))
      return 'commission_computable'
    return null
  }

  if (doc.kind === 'bank_expense') {
    const fv = rows[0]
    if (!fv || rows.length !== 1) return 'bank_rows'
    if (sumLines(linesOf(doc, 'net')) !== amountOf(fv, 'net_21_cents')) return 'bank_net'
    if (sumLines(linesOf(doc, 'vat')) !== amountOf(fv, 'vat_21_cents')) return 'bank_vat'
    if (sumLines(linesOf(doc, 'perception')) !== amountOf(fv, 'perc_iva_cents'))
      return 'bank_perception'
    return null
  }

  if (doc.kind === 'sales_close' || isSalesDocumentKind(doc.kind)) {
    // Ventas: por canal, Σ con signo de (netos + no gravado + exento) = Σ con signo de `sales_invoiced`;
    // por alícuota, Σ con signo del IVA de las filas = Σ con signo de los renglones `vat`.
    // Las filas de NC restan (`isCreditNote`) y sus renglones van al Debe: los dos lados ya traen su signo.
    const channels = new Set<Channel>()
    for (const fv of rows) if (fv.channel) channels.add(fv.channel)
    for (const l of linesOf(doc, 'sales_invoiced')) if (l.channel) channels.add(l.channel)
    for (const channel of channels) {
      const ofChannel = rows.filter((fv) => fv.channel === channel)
      const invoiced =
        RATES.reduce<number>(
          (acc, r) => acc + sumColumn(ofChannel, ALIQUOT_COLUMNS[r].net, true),
          0,
        ) +
        sumColumn(ofChannel, 'non_taxed_cents', true) +
        sumColumn(ofChannel, 'exempt_cents', true)
      const lines = signedCredit(
        linesOf(doc, 'sales_invoiced').filter((l) => l.channel === channel),
      )
      if (invoiced !== lines) return `sales_invoiced_${channel}`
    }
    for (const rate of RATES) {
      const col = ALIQUOT_COLUMNS[rate].vat
      const rowsVat = col ? sumColumn(rows, col, true) : 0
      const linesVat = signedCredit(linesOf(doc, 'vat', rate))
      if (rowsVat !== linesVat) return `sales_vat_${rate}`
    }
    if (doc.kind === 'sales_close') {
      // Sin factura de cada canal = vendido del canal − facturado del canal (con su signo).
      const soldByChannel = new Map<Channel, Cents>()
      const methodChannel = (l: DocLine) =>
        l.salesMethodId ? (ctx.methods.get(l.salesMethodId)?.channel ?? null) : l.channel
      for (const l of doc.lines) {
        if (l.role !== 'treasury' && l.role !== 'receivable' && l.role !== 'advance') continue
        const channel = methodChannel(l)
        if (!channel) continue
        soldByChannel.set(channel, (soldByChannel.get(channel) ?? 0) + l.amountCents)
      }
      // El efectivo contado distinto de lo vendido va a la diferencia de caja (del canal del efectivo).
      const cashDiff = sumRole(doc, 'cash_diff', 'debit') - sumRole(doc, 'cash_diff', 'credit')
      if (cashDiff !== 0) {
        const cashLine = doc.lines.find((l) => l.role === 'treasury')
        const channel = cashLine ? methodChannel(cashLine) : null
        if (channel) soldByChannel.set(channel, (soldByChannel.get(channel) ?? 0) + cashDiff)
      }
      const allChannels = new Set<Channel>([...soldByChannel.keys(), ...channels])
      for (const l of linesOf(doc, 'sales_uninvoiced')) if (l.channel) allChannels.add(l.channel)
      for (const channel of allChannels) {
        const sold = soldByChannel.get(channel) ?? 0
        const invoicedLines = signedCredit(
          linesOf(doc, 'sales_invoiced').filter((l) => l.channel === channel),
        )
        const vatOfChannel = rows
          .filter((fv) => fv.channel === channel)
          .reduce(
            (acc, fv) =>
              acc +
              VAT_KEYS_OF_ROW.reduce((a, k) => a + (fv.isCreditNote ? -1 : 1) * amountOf(fv, k), 0),
            0,
          )
        const uninvoiced = signedCredit(
          linesOf(doc, 'sales_uninvoiced').filter((l) => l.channel === channel),
        )
        if (sold - invoicedLines - vatOfChannel !== uninvoiced) return `sales_uninvoiced_${channel}`
      }
    }
    return null
  }

  return null
}

// ─── Forma del bundle (C.3.2 y C.3.3 paso 3) ─────────────────────────────────

/** `ref` de documentos y partícipes nuevos: `^[a-z0-9_]{1,20}$`. */
export const BUNDLE_REF_RE = /^[a-z0-9_]{1,20}$/

const SINGLE_KINDS: readonly DocumentKind[] = [
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
]

/** Lo que generan sus propias RPC y nunca entra por `acc_post_bundle` (`kind_not_allowed`). */
const RPC_ONLY_KINDS: readonly DocumentKind[] = [
  'iva_settlement',
  'reversal',
  'fy_result',
  'fy_closing',
  'fy_opening',
]

/** ¿La lista de tipos es una de las composiciones de C.3.2? */
export function isAllowedComposition(kinds: readonly DocumentKind[]): boolean {
  if (kinds.length === 1) return SINGLE_KINDS.includes(kinds[0] as DocumentKind)
  const [first, ...rest] = kinds
  if (first === 'purchase' && kinds.length === 2 && rest[0] === 'payment') return true
  if (first === 'sales_close' && rest.length >= 1 && rest.every((k) => k === 'collection'))
    return true
  if (first === 'sales_invoice' && kinds.length === 2 && rest[0] === 'collection') return true
  if (first === 'collection' && kinds.length === 2 && rest[0] === 'treasury_adjustment') return true
  return false
}

/** `entry_kind` válido para el tipo (C.3.3 paso 3). */
export function entryKindsFor(kind: DocumentKind): readonly EntryKind[] {
  switch (kind) {
    case 'opening':
      return ['opening']
    case 'manual':
      return ['manual', 'adjustment', 'payroll', 'fy_adjustment']
    case 'reversal':
      return ['reversal']
    case 'iva_settlement':
      return ['iva_settlement']
    case 'fy_result':
      return ['fy_result']
    case 'fy_closing':
      return ['fy_closing']
    case 'fy_opening':
      return ['fy_opening']
    default:
      return ['standard']
  }
}

/** Reglas de `acc_save_party` para los partícipes nuevos del bundle. */
export function validateNewParties(
  newParties: readonly NewParty[],
  ctx: Pick<PostingContext, 'parties'>,
): PostingError[] {
  const errors: PostingError[] = []
  const refs = new Set<string>()
  newParties.forEach((p, i) => {
    const field = `newParties.${i}`
    if (!BUNDLE_REF_RE.test(p.ref) || refs.has(p.ref)) {
      errors.push(err('invalid_bundle', field, { reason: 'party_ref' }))
    }
    refs.add(p.ref)
    const name = p.name.trim()
    if (name.length < 2 || name.length > 120) {
      errors.push(err('invalid_bundle', `${field}.name`, { reason: 'party_name' }))
    }
    if (p.taxIdType === 'none' ? p.taxId !== null : p.taxId === null) {
      errors.push(err('invalid_cuit', `${field}.taxId`))
    } else if ((p.taxIdType === 'cuit' || p.taxIdType === 'cuil') && !parseCuit(p.taxId).ok) {
      errors.push(err('invalid_cuit', `${field}.taxId`))
    } else if (p.taxIdType === 'dni' && !/^[0-9]{7,8}$/.test(p.taxId ?? '')) {
      errors.push(err('invalid_cuit', `${field}.taxId`))
    }
    if (p.taxId !== null) {
      for (const existing of ctx.parties.values()) {
        if (existing.active && existing.taxId === p.taxId) {
          errors.push(err('duplicate_tax_id', `${field}.taxId`, { name: existing.name }))
          break
        }
      }
    }
    if (!Number.isInteger(p.paymentTermDays) || p.paymentTermDays < 0 || p.paymentTermDays > 365) {
      errors.push(err('invalid_bundle', `${field}.paymentTermDays`, { reason: 'payment_term' }))
    }
  })
  return errors
}

// ─── Imputaciones (C.3.3 paso 12, lo que se puede ver sin la base) ───────────

type ItemView = {
  side: Side
  partyKey: PartyKey | null
  accountId: string
  open: Cents
  date: IsoDate
}

function itemFor(key: LineKey, bundle: ProposedBundle, ctx: PostingContext): ItemView | null {
  if ('lineId' in key) {
    const item = ctx.openItems.get(key.lineId)
    return item
      ? {
          side: item.side,
          partyKey: { id: item.partyId },
          accountId: item.accountId,
          open: item.openCents,
          date: item.entryDate,
        }
      : null
  }
  const doc = bundle.documents.find((d) => d.ref === key.doc)
  const line = doc?.lines.find((l) => l.lineNo === key.lineNo)
  if (!doc || !line || line.partyRef === null) return null
  return {
    side: line.side,
    partyKey: line.partyRef,
    accountId: line.accountId,
    open: line.amountCents,
    date: doc.accountingDate,
  }
}

function lineKeyId(key: LineKey): string {
  return 'lineId' in key ? `id:${key.lineId}` : `doc:${key.doc}:${key.lineNo}`
}

/**
 * Las imputaciones del bundle: partidas que existen (`item_not_found`), lados
 * opuestos (`allocation_side_mismatch`), mismo partícipe y cuenta
 * (`allocation_party_mismatch`) y nunca más que lo abierto de cada partida,
 * contando todas las imputaciones del bundle (`allocation_exceeds_open`).
 */
export function validateAllocations(bundle: ProposedBundle, ctx: PostingContext): PostingError[] {
  const errors: PostingError[] = []
  if (bundle.allocations.length > 200) {
    return [err('invalid_bundle', 'allocations', { reason: 'too_many_allocations' })]
  }
  const used = new Map<string, Cents>()
  bundle.allocations.forEach((a, i) => {
    const field = `allocations.${i}`
    if (!Number.isSafeInteger(a.amountCents) || a.amountCents < 1 || a.amountCents > DB_MAX_CENTS) {
      errors.push(err('invalid_bundle', field, { reason: 'allocation_amount' }))
      return
    }
    const debit = itemFor(a.debit, bundle, ctx)
    const credit = itemFor(a.credit, bundle, ctx)
    if (!debit || !credit) {
      errors.push(err('item_not_found', field))
      return
    }
    if (debit.side !== 'debit' || credit.side !== 'credit') {
      errors.push(err('allocation_side_mismatch', field))
      return
    }
    if (!samePartyKey(debit.partyKey, credit.partyKey) || debit.accountId !== credit.accountId) {
      errors.push(err('allocation_party_mismatch', field))
      return
    }
    for (const [key, item] of [
      [a.debit, debit],
      [a.credit, credit],
    ] as const) {
      const id = lineKeyId(key)
      const total = (used.get(id) ?? 0) + a.amountCents
      used.set(id, total)
      if (total > item.open) {
        errors.push(err('allocation_exceeds_open', field, { open_cents: item.open }))
      }
    }
  })
  return errors
}

// ─── Avisos confirmables ─────────────────────────────────────────────────────

/**
 * Caja que quedaría en negativo (C.3.3 paso 11): solo en cajas con
 * `allow_negative = false` y solo si el bundle le saca plata (no molesta al
 * cargar un ingreso en una caja que ya estaba en rojo). La tarjeta de la
 * empresa (pasivo) no aplica: su saldo es deuda.
 */
export function treasuryNegativeWarnings(
  documents: readonly ProposedDocument[],
  ctx: Pick<PostingContext, 'treasuries'>,
): PostingWarning[] {
  const delta = new Map<string, Cents>()
  for (const doc of documents) {
    for (const l of doc.lines) {
      if (l.role !== 'treasury' || !l.treasuryAccountId) continue
      const signed = l.side === 'debit' ? l.amountCents : -l.amountCents
      delta.set(l.treasuryAccountId, (delta.get(l.treasuryAccountId) ?? 0) + signed)
    }
  }
  const warnings: PostingWarning[] = []
  for (const [id, change] of delta) {
    const t = ctx.treasuries.get(id)
    if (!t || t.allowNegative || t.kind === 'credit_card' || change >= 0) continue
    const after = t.balanceCents + change
    if (after < 0) {
      warnings.push(
        warn('treasury_negative', undefined, {
          treasury_id: t.id,
          treasury_name: t.name,
          balance_after_cents: after,
        }),
      )
    }
  }
  return warnings
}

export type DuplicateCandidate = {
  kind: DocumentKind
  partyId: string | null
  /** La cuenta del gasto cuando no hay partícipe. */
  accountId: string | null
  totalCents: Cents
  accountingDate: IsoDate
  number: number | null
}

export type RecentDocument = DuplicateCandidate & { label: string; partyName?: string | null }

/**
 * «Posible duplicado» de C.3.3 paso 5.5: un gasto o compra sin número igual a
 * otro (mismo partícipe o, sin partícipe, misma cuenta; mismo total; fechas a
 * ≤ `windowDays` de distancia; 24 h → 1 día). Devuelve el más parecido o `null`.
 */
export function findPossibleDuplicate(
  candidate: DuplicateCandidate,
  recent: readonly RecentDocument[],
  windowDays = 1,
): RecentDocument | null {
  if (candidate.number !== null) return null
  if (candidate.kind !== 'expense' && !isPurchaseKind(candidate.kind)) return null
  for (const r of recent) {
    const sameWho =
      candidate.partyId !== null
        ? r.partyId === candidate.partyId
        : r.accountId !== null && r.accountId === candidate.accountId
    if (!sameWho || r.totalCents !== candidate.totalCents) continue
    if (Math.abs(daysBetween(r.accountingDate, candidate.accountingDate)) <= windowDays) return r
  }
  return null
}

/** El aviso `possible_duplicate` listo para el bundle. */
export function possibleDuplicateWarning(
  match: RecentDocument,
  documentRef?: string,
): PostingWarning {
  return warn('possible_duplicate', documentRef, {
    amount_cents: match.totalCents,
    party_name: match.partyName ?? match.label,
    date: match.accountingDate,
  })
}

// ─── Todo junto ──────────────────────────────────────────────────────────────

export type ValidateOptions = DateRulesOptions & {
  /**
   * Saldo disponible de cada cuenta compensable a la fecha del pago
   * (`accountId → centavos`). Si viene, `compensation_exceeds_balance` se
   * avisa antes de guardar; si no, lo decide la RPC.
   */
  compensationBalances?: ReadonlyMap<string, Cents>
}

/** Todas las reglas de un documento del bundle. */
export function validateDocument(
  doc: ProposedDocument,
  ctx: PostingContext,
  newParties: readonly NewParty[] = [],
  opts: ValidateOptions = {},
): ValidationIssues {
  const out = issues()
  if (!BUNDLE_REF_RE.test(doc.ref))
    out.errors.push(err('invalid_bundle', 'ref', { reason: 'document_ref' }))
  if (!entryKindsFor(doc.kind).includes(doc.entryKind)) {
    out.errors.push(err('invalid_bundle', 'entryKind', { reason: 'entry_kind' }))
  }
  const description = doc.description.trim()
  if (description.length < 1 || description.length > 200) {
    out.errors.push(err('invalid_bundle', 'description', { reason: 'description' }))
  }
  if (
    (doc.pointOfSale !== null &&
      (!Number.isInteger(doc.pointOfSale) || doc.pointOfSale < 0 || doc.pointOfSale > 99_999)) ||
    (doc.number !== null &&
      (!Number.isInteger(doc.number) || doc.number < 1 || doc.number > 99_999_999))
  ) {
    out.errors.push(err('invalid_bundle', 'number', { reason: 'voucher_number_range' }))
  }
  if (
    doc.voucherType &&
    VOUCHER_CATALOG[doc.voucherType].numbered &&
    doc.kind !== 'expense' &&
    (doc.pointOfSale === null || doc.number === null)
  ) {
    out.errors.push(err('voucher_number_required', 'number'))
  }
  if (doc.overrideReason !== null) {
    const reason = doc.overrideReason.trim()
    if (reason.length < 5 || reason.length > 300)
      out.errors.push(err('reason_required', 'overrideReason'))
  }

  merge(out, validateDates(doc, ctx, opts))
  const { errors: partyErrors, party } = validateParty(doc, ctx, newParties)
  out.errors.push(...partyErrors)
  merge(out, validateVoucher(doc, party))
  out.errors.push(...validateLines(doc, ctx, newParties))
  out.errors.push(...validateStructure(doc, ctx, opts))
  out.errors.push(...validateTotals(doc))
  out.errors.push(...validateFiscalVouchers(doc, ctx, party))
  return out
}

/**
 * Todo el bundle: forma, composición permitida, partícipes nuevos, cada
 * documento, imputaciones y avisos de caja negativa. El motor lo corre antes de
 * devolver la vista previa; la RPC repite todo.
 */
export function validateBundle(
  bundle: ProposedBundle,
  ctx: PostingContext,
  opts: ValidateOptions = {},
): ValidationIssues {
  const out = issues()
  const n = bundle.documents.length
  if (n < 1 || n > 10) {
    out.errors.push(err('invalid_bundle', 'documents', { reason: 'document_count' }))
    return out
  }
  const refs = bundle.documents.map((d) => d.ref)
  if (new Set(refs).size !== refs.length) {
    out.errors.push(err('invalid_bundle', 'documents', { reason: 'duplicate_ref' }))
  }
  const kinds = bundle.documents.map((d) => d.kind)
  if (kinds.some((k) => RPC_ONLY_KINDS.includes(k))) {
    out.errors.push(err('kind_not_allowed', 'documents'))
    return out
  }
  if (!isAllowedComposition(kinds)) {
    out.errors.push(err('invalid_bundle', 'documents', { reason: 'composition' }))
  }
  out.errors.push(...validateNewParties(bundle.newParties, ctx))
  for (const doc of bundle.documents)
    merge(out, validateDocument(doc, ctx, bundle.newParties, opts))
  out.errors.push(...validateAllocations(bundle, ctx))
  out.warnings.push(...treasuryNegativeWarnings(bundle.documents, ctx))
  return out
}
