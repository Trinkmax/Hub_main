'use server'

/**
 * Datos maestros de Administración (C.2, H.16, H.17): datos de la SAS, plan de
 * cuentas, partícipes, cajas, medios de cobro, puntos de venta y gastos fijos.
 *
 * Todas: dueño con acceso (`write`) → zod → UNA RPC con la sesión del usuario
 * (vuelve a chequear todo, toma el lock del bar y audita adentro) → error del
 * catálogo → revalidación. Concurrencia optimista con `expectedUpdatedAt`
 * (`stale`). Reciben un objeto o el `FormData` del formulario.
 *
 * **Altas y ediciones.** Sin `id` es un alta. Con `id` es una edición y viajan
 * SOLO los campos que mandó el formulario: uno parcial (el CUIT y las tasas de
 * un partícipe del sistema, el «Activo» de una caja) no pisa el resto con
 * defaults. Los tildes tienen que venir explícitos (`true`/`false`).
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import { type AccSettingsRow, parseSettingsRow } from '@/lib/accounting/context'
import {
  type ChartImportResult,
  parseChartImportResult,
  parseSystemRemapResult,
  type SystemRemapResult,
} from '@/lib/accounting/queries/accounts'
import {
  accountSchema,
  chartImportSchema,
  partySchema,
  recurringSchema,
  salesMethodSchema,
  salesPointSchema,
  settingsSchema,
  skipRecurringDueSchema,
  systemRemapSchema,
  treasurySchema,
} from '@/lib/accounting/schemas'
import {
  ACCOUNT_TYPES,
  type AccountType,
  CHANNELS,
  type Channel,
  COMMISSION_VAT_MODES,
  type CommissionVatMode,
  IVA_CONDITIONS,
  type IvaCondition,
  PARTY_KINDS,
  type PartyKind,
  SALES_METHOD_KINDS,
  type SalesMethodKind,
  SIDES,
  type Side,
  TAX_ID_TYPES,
  type TaxIdType,
  TREASURY_KINDS,
  type TreasuryKind,
} from '@/lib/accounting/types'
import { formatIsoDay } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import {
  accFailure,
  asRecord,
  boolOf,
  dayOf,
  type FieldMap,
  fieldFailure,
  formInput,
  intOf,
  presentKeys,
  type Rec,
  revalidateAccounting,
  rpcFailure,
  rpcPayload,
  textOf,
  unexpectedFailure,
} from './support'

// ─── Lo que devuelven (la fila guardada, en camelCase) ───────────────────────

export type SavedAccount = {
  id: string
  code: string
  name: string
  type: AccountType
  normalSide: Side
  parentId: string | null
  level: number
  postable: boolean
  active: boolean
  requiresParty: boolean
  isTreasury: boolean
  purchaseSelectable: boolean
  manualSelectable: boolean
  systemKey: string | null
  description: string | null
  updatedAt: string | null
}

export type SavedParty = {
  id: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  email: string | null
  phone: string | null
  address: string | null
  paymentTermDays: number
  defaultAccountId: string | null
  defaultVoucherType: string | null
  payableAccountId: string | null
  receivableAccountId: string | null
  commissionVatMode: CommissionVatMode
  commissionBp: number | null
  iibbWithholdingBp: number | null
  vatWithholdingBp: number | null
  incomeTaxWithholdingBp: number | null
  sircupaBp: number | null
  notes: string | null
  active: boolean
  systemKey: string | null
  updatedAt: string | null
}

export type SavedTreasury = {
  id: string
  accountId: string
  accountCode: string | null
  name: string
  kind: TreasuryKind
  bankPartyId: string | null
  bankName: string | null
  cbuCvu: string | null
  alias: string | null
  accountNumber: string | null
  allowNegative: boolean
  lastCheckedOn: string | null
  sort: number
  active: boolean
  updatedAt: string | null
}

export type SavedSalesMethod = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  treasuryAccountId: string | null
  partyId: string | null
  settlementDays: number
  sort: number
  active: boolean
  systemKey: string | null
  updatedAt: string | null
}

export type SavedSalesPoint = {
  id: string
  number: number
  label: string
  defaultChannel: Channel
  active: boolean
  updatedAt: string | null
}

export type SavedRecurringExpense = {
  id: string
  name: string
  partyId: string | null
  accountId: string
  voucherType: string | null
  vatRateBp: number | null
  amountCents: number | null
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'yearly'
  dueDay: number
  nextDueDate: string
  remindDaysBefore: number
  treasuryAccountId: string | null
  active: boolean
  notes: string | null
  updatedAt: string | null
}

// ─── Lectura de las filas ────────────────────────────────────────────────────

function pick<T extends string>(list: ReadonlyArray<T>, v: unknown, fallback: T): T {
  return (list as ReadonlyArray<unknown>).includes(v) ? (v as T) : fallback
}

function accountRow(r: Rec): SavedAccount {
  const code = textOf(r.code) ?? ''
  return {
    id: textOf(r.id) ?? '',
    code,
    name: textOf(r.name) ?? '',
    type: pick(ACCOUNT_TYPES, r.type, 'asset'),
    normalSide: pick(SIDES, r.normal_side, 'debit'),
    parentId: textOf(r.parent_id),
    level: intOf(r.level) ?? code.split('.').length,
    postable: boolOf(r.postable),
    active: boolOf(r.active, true),
    requiresParty: boolOf(r.requires_party),
    isTreasury: boolOf(r.is_treasury),
    purchaseSelectable: boolOf(r.purchase_selectable),
    manualSelectable: boolOf(r.manual_selectable, true),
    systemKey: textOf(r.system_key),
    description: textOf(r.description),
    updatedAt: textOf(r.updated_at),
  }
}

function partyRow(r: Rec): SavedParty {
  return {
    id: textOf(r.id) ?? '',
    kind: pick(PARTY_KINDS, r.kind, 'supplier'),
    name: textOf(r.name) ?? '',
    tradeName: textOf(r.trade_name),
    taxIdType: pick(TAX_ID_TYPES, r.tax_id_type, 'none'),
    taxId: textOf(r.tax_id),
    ivaCondition: pick(IVA_CONDITIONS, r.iva_condition, 'sin_datos'),
    email: textOf(r.email),
    phone: textOf(r.phone),
    address: textOf(r.address),
    paymentTermDays: intOf(r.payment_term_days) ?? 0,
    defaultAccountId: textOf(r.default_account_id),
    defaultVoucherType: textOf(r.default_voucher_type),
    payableAccountId: textOf(r.payable_account_id),
    receivableAccountId: textOf(r.receivable_account_id),
    commissionVatMode: pick(COMMISSION_VAT_MODES, r.commission_vat_mode, 'none'),
    commissionBp: intOf(r.commission_bp),
    iibbWithholdingBp: intOf(r.iibb_withholding_bp),
    vatWithholdingBp: intOf(r.vat_withholding_bp),
    incomeTaxWithholdingBp: intOf(r.income_tax_withholding_bp),
    sircupaBp: intOf(r.sircupa_bp),
    notes: textOf(r.notes),
    active: boolOf(r.active, true),
    systemKey: textOf(r.system_key),
    updatedAt: textOf(r.updated_at),
  }
}

function treasuryRow(r: Rec): SavedTreasury {
  return {
    id: textOf(r.id) ?? '',
    accountId: textOf(r.account_id) ?? '',
    accountCode: textOf(r.account_code),
    name: textOf(r.name) ?? '',
    kind: pick(TREASURY_KINDS, r.kind, 'other'),
    bankPartyId: textOf(r.bank_party_id),
    bankName: textOf(r.bank_name),
    cbuCvu: textOf(r.cbu_cvu),
    alias: textOf(r.alias),
    accountNumber: textOf(r.account_number),
    allowNegative: boolOf(r.allow_negative),
    lastCheckedOn: dayOf(r.last_checked_on),
    sort: intOf(r.sort) ?? 0,
    active: boolOf(r.active, true),
    updatedAt: textOf(r.updated_at),
  }
}

function methodRow(r: Rec): SavedSalesMethod {
  return {
    id: textOf(r.id) ?? '',
    name: textOf(r.name) ?? '',
    kind: pick(SALES_METHOD_KINDS, r.kind, 'treasury'),
    channel: pick(CHANNELS, r.channel, 'salon'),
    treasuryAccountId: textOf(r.treasury_account_id),
    partyId: textOf(r.party_id),
    settlementDays: intOf(r.settlement_days) ?? 0,
    sort: intOf(r.sort) ?? 0,
    active: boolOf(r.active, true),
    systemKey: textOf(r.system_key),
    updatedAt: textOf(r.updated_at),
  }
}

function salesPointRow(r: Rec): SavedSalesPoint {
  const number = intOf(r.number) ?? 0
  return {
    id: textOf(r.id) ?? '',
    number,
    label: textOf(r.label) ?? `Punto de venta ${number}`,
    defaultChannel: pick(CHANNELS, r.default_channel, 'salon'),
    active: boolOf(r.active, true),
    updatedAt: textOf(r.updated_at),
  }
}

const FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'yearly'] as const

function recurringRow(r: Rec): SavedRecurringExpense {
  return {
    id: textOf(r.id) ?? '',
    name: textOf(r.name) ?? '',
    partyId: textOf(r.party_id),
    accountId: textOf(r.account_id) ?? '',
    voucherType: textOf(r.voucher_type),
    vatRateBp: intOf(r.vat_rate_bp),
    amountCents: intOf(r.amount_cents),
    frequency: pick(FREQUENCIES, r.frequency, 'monthly'),
    dueDay: intOf(r.due_day) ?? 1,
    nextDueDate: dayOf(r.next_due_date) ?? '',
    remindDaysBefore: intOf(r.remind_days_before) ?? 5,
    treasuryAccountId: textOf(r.treasury_account_id),
    active: boolOf(r.active, true),
    notes: textOf(r.notes),
    updatedAt: textOf(r.updated_at),
  }
}

// ─── Pieza común ─────────────────────────────────────────────────────────────

type MasterSpec<T> = {
  op: string
  rpc: string
  /** El jsonb de la RPC y el token de concurrencia (`null` en un alta). */
  args: { payload: Record<string, unknown>; expected: string | null }
  row: (r: Rec) => T
  message: (row: T) => string
}

/** Una RPC `acc_save_*(p_tenant_id, p_<entidad>, p_expected_updated_at)`. */
async function saveVia<T>(
  slug: string,
  tenantId: string,
  param: string,
  spec: MasterSpec<T>,
): Promise<AccSimpleState<T>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(spec.rpc, {
    p_tenant_id: tenantId,
    [param]: spec.args.payload,
    p_expected_updated_at: spec.args.expected,
  })
  if (error) return rpcFailure(spec.op, error)
  const r = asRecord(data)
  if (!r) return unexpectedFailure(spec.op, new Error('respuesta vacía'))
  const row = spec.row(r)
  revalidateAccounting(slug)
  return { ok: true, data: row, message: spec.message(row) }
}

/** En una edición, viaja lo que mandó el formulario. */
function keepPresent(raw: unknown): (field: string) => boolean {
  const present = presentKeys(raw)
  return (field) => present.has(field)
}

// ─── Datos de la SAS ─────────────────────────────────────────────────────────

const SETTINGS_FIELDS: FieldMap = [
  ['legalName', 'legal_name'],
  ['cuit', 'cuit'],
  ['ivaCondition', 'iva_condition'],
  ['iibbRegime', 'iibb_regime'],
  ['iibbNumber', 'iibb_number'],
  ['iibbJurisdictionCode', 'iibb_jurisdiction_code'],
  ['activityStartDate', 'activity_start_date'],
  ['fiscalAddress', 'fiscal_address'],
  ['booksStartDate', 'books_start_date'],
  ['fiscalYearEndMonth', 'fiscal_year_end_month'],
  ['ivaSettlementMode', 'iva_settlement_mode'],
  ['ivaDueDay', 'iva_due_day'],
  ['iibbDueDay', 'iibb_due_day'],
  ['vatToleranceCents', 'vat_tolerance_cents'],
  ['bankTaxCreditComputableBp', 'bank_tax_credit_computable_bp'],
  ['bankTaxDebitComputableBp', 'bank_tax_debit_computable_bp'],
  ['uninvoicedSalesMode', 'uninvoiced_sales_mode'],
  ['closedPeriodVoidIvaMode', 'closed_period_void_iva_mode'],
  ['dueSoonDays', 'due_soon_days'],
]

/** Ajustes › Datos de la SAS y Ejercicio y meses (`acc_save_settings`). */
export async function saveSettings(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<AccSettingsRow>> {
  const op = 'master.saveSettings'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = settingsSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_save_settings', {
      p_tenant_id: auth.tenantId,
      p_settings: rpcPayload(parsed.data, SETTINGS_FIELDS),
      p_expected_updated_at: parsed.data.expectedUpdatedAt,
    })
    if (error) return rpcFailure(op, error)
    const row = parseSettingsRow(data)
    if (!row) return unexpectedFailure(op, new Error('respuesta vacía'))

    revalidateAccounting(slug)
    return { ok: true, data: row, message: 'Datos guardados.' }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Plan de cuentas ─────────────────────────────────────────────────────────

const ACCOUNT_CREATE_FIELDS: FieldMap = [
  ['parentId', 'parent_id'],
  ['type', 'type'],
  ['code', 'code'],
  ['name', 'name'],
  ['postable', 'postable'],
  ['contra', 'contra'],
  ['requiresParty', 'requires_party'],
  ['purchaseSelectable', 'purchase_selectable'],
  ['manualSelectable', 'manual_selectable'],
  ['description', 'description'],
]

const ACCOUNT_UPDATE_FIELDS: FieldMap = [
  ['name', 'name'],
  ['code', 'code'],
  ['type', 'type'],
  ['active', 'active'],
  ['requiresParty', 'requires_party'],
  ['purchaseSelectable', 'purchase_selectable'],
  ['manualSelectable', 'manual_selectable'],
  ['description', 'description'],
  ['parentId', 'parent_id'],
]

/**
 * Plan de cuentas (`acc_save_account`, #16): alta (`mode: 'create'`) adentro de un grupo o como
 * cuenta principal (`parentId: null` + `type` + `code`), o edición (`mode: 'update'`): nombre,
 * código, tipo (bajo resultados o en una principal), «Para qué se usa», tildes, activa, y mover
 * (`parentId`: otro grupo, o `null`) con todo su subárbol. La base hace cumplir el resto.
 */
export async function saveAccount(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedAccount>> {
  const op = 'master.saveAccount'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const input = formInput(raw)
    const parsed = accountSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    if (v.mode === 'create') {
      const payload = rpcPayload(v, ACCOUNT_CREATE_FIELDS)
      if (v.code === null) delete payload.code // el siguiente código libre del grupo
      if (v.type === null) delete payload.type // el de su grupo
      return await saveVia(slug, auth.tenantId, 'p_account', {
        op,
        rpc: 'acc_save_account',
        args: { payload, expected: null },
        row: accountRow,
        message: (row) => `Cuenta ${row.code} · ${row.name} creada.`,
      })
    }

    const keep = keepPresent(input)
    const payload = { id: v.id, ...rpcPayload(v, ACCOUNT_UPDATE_FIELDS, keep) }
    const toggled = keep('active') ? v.active : undefined
    const moved = keep('parentId')
    return await saveVia(slug, auth.tenantId, 'p_account', {
      op,
      rpc: 'acc_save_account',
      args: { payload, expected: v.expectedUpdatedAt },
      row: accountRow,
      message: (row) =>
        toggled === false
          ? `Cuenta ${row.code} desactivada.`
          : toggled === true
            ? `Cuenta ${row.code} activada.`
            : moved
              ? `Cuenta ${row.code} movida.`
              : 'Cuenta guardada.',
    })
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * «Importar plan» (`acc_import_accounts`, #16): con `dryRun` es la vista previa (no escribe nada);
 * sin él crea los códigos nuevos y actualiza los que ya existen, todo o nada. Nunca borra ni
 * desactiva. Escritor y administrador de accesos, como pide la base.
 */
export async function importAccounts(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ChartImportResult>> {
  const op = 'master.importAccounts'
  try {
    const auth = await authorizeAccounting(slug, 'admin')
    if (!auth.ok) return auth.state
    const parsed = chartImportSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)
    const { rows, dryRun } = parsed.data

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_import_accounts', {
      p_tenant_id: auth.tenantId,
      p_rows: rows.map((r) => ({
        code: r.code,
        name: r.name,
        ...(r.type ? { type: r.type } : {}),
        ...(r.postable === undefined ? {} : { postable: r.postable }),
        ...(r.contra === undefined ? {} : { contra: r.contra }),
        ...(r.parentCode ? { parent_code: r.parentCode } : {}),
        ...(r.description === undefined ? {} : { description: r.description }),
      })),
      p_dry_run: dryRun,
    })
    if (error) return rpcFailure(op, error)
    const result = parseChartImportResult(data)
    if (!result) return unexpectedFailure(op, new Error('respuesta vacía'))

    if (result.applied) revalidateAccounting(slug)
    const changed = result.creates + result.updates
    return {
      ok: true,
      data: result,
      message: result.applied
        ? changed === 0
          ? 'No había nada para cambiar: el plan ya estaba así.'
          : `Listo: ${importCounts(result)}.`
        : result.errors > 0
          ? `Hay ${result.errors === 1 ? 'una línea' : `${result.errors} líneas`} para corregir.`
          : 'Vista previa lista.',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/** «8 cuentas nuevas y 2 actualizadas». */
function importCounts(result: ChartImportResult): string {
  const parts: string[] = []
  if (result.creates > 0) {
    parts.push(result.creates === 1 ? '1 cuenta nueva' : `${result.creates} cuentas nuevas`)
  }
  if (result.updates > 0) {
    parts.push(result.updates === 1 ? '1 actualizada' : `${result.updates} actualizadas`)
  }
  return parts.join(' y ')
}

/**
 * «Usar otra cuenta» para una clave del sistema (`acc_remap_system_account`, #16): desde ahora el
 * motor usa esa cuenta. La historia queda donde estaba (la anterior no puede tener saldo). Escritor
 * y administrador de accesos, como pide la base.
 */
export async function remapSystemAccount(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SystemRemapResult>> {
  const op = 'master.remapSystemAccount'
  try {
    const auth = await authorizeAccounting(slug, 'admin')
    if (!auth.ok) return auth.state
    const parsed = systemRemapSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_remap_system_account', {
      p_tenant_id: auth.tenantId,
      p_system_key: parsed.data.systemKey,
      p_account_id: parsed.data.accountId,
    })
    if (error) return rpcFailure(op, error)
    const result = parseSystemRemapResult(data)
    if (!result) return unexpectedFailure(op, new Error('respuesta vacía'))

    if (result.changed) revalidateAccounting(slug)
    return {
      ok: true,
      data: result,
      message: result.changed
        ? `Listo: desde ahora el sistema usa ${result.to.code} ${result.to.name}.`
        : `Ya usaba ${result.to.code} ${result.to.name}: no cambió nada.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Proveedores, clientes y partícipes del sistema ──────────────────────────

const PARTY_FIELDS: FieldMap = [
  ['kind', 'kind'],
  ['name', 'name'],
  ['tradeName', 'trade_name'],
  ['taxIdType', 'tax_id_type'],
  ['taxId', 'tax_id'],
  ['ivaCondition', 'iva_condition'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['paymentTermDays', 'payment_term_days'],
  ['defaultAccountId', 'default_account_id'],
  ['defaultVoucherType', 'default_voucher_type'],
  ['payableAccountId', 'payable_account_id'],
  ['receivableAccountId', 'receivable_account_id'],
  ['commissionVatMode', 'commission_vat_mode'],
  ['commissionBp', 'commission_bp'],
  ['iibbWithholdingBp', 'iibb_withholding_bp'],
  ['vatWithholdingBp', 'vat_withholding_bp'],
  ['incomeTaxWithholdingBp', 'income_tax_withholding_bp'],
  ['sircupaBp', 'sircupa_bp'],
  ['notes', 'notes'],
  ['active', 'active'],
]

/**
 * Alta o edición de un proveedor, cliente o partícipe del sistema. Las
 * cuentas de control vacías quieren decir «la habitual»: en un alta la elige
 * la base según el tipo; en una edición no se tocan.
 */
export async function saveParty(slug: string, raw: unknown): Promise<AccSimpleState<SavedParty>> {
  const op = 'master.saveParty'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const input = formInput(raw)
    const parsed = partySchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    const editing = v.id !== null
    if (editing && v.expectedUpdatedAt === null) return accFailure('stale')
    const keep = editing ? keepPresent(input) : () => true
    const payload = rpcPayload(v, PARTY_FIELDS, keep)
    if (v.payableAccountId === null) delete payload.payable_account_id
    if (v.receivableAccountId === null) delete payload.receivable_account_id
    if (editing) payload.id = v.id

    return await saveVia(slug, auth.tenantId, 'p_party', {
      op,
      rpc: 'acc_save_party',
      args: { payload, expected: editing ? v.expectedUpdatedAt : null },
      row: partyRow,
      message: (row) =>
        !editing
          ? `${row.name} quedó cargado.`
          : keep('active') && !v.active
            ? `${row.name} quedó desactivado.`
            : 'Datos guardados.',
    })
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Cajas, bancos, billeteras y tarjeta de la empresa ──────────────────────

const TREASURY_CREATE_FIELDS: FieldMap = [
  ['name', 'name'],
  ['kind', 'kind'],
  ['bankName', 'bank_name'],
  ['cbuCvu', 'cbu_cvu'],
  ['alias', 'alias'],
  ['accountNumber', 'account_number'],
  ['allowNegative', 'allow_negative'],
  ['createBankParty', 'create_bank_party'],
]

const TREASURY_UPDATE_FIELDS: FieldMap = [...TREASURY_CREATE_FIELDS, ['active', 'active']]

/**
 * Alta o edición de una caja o cuenta. El alta crea su cuenta contable; el
 * saldo inicial de una caja nueva entra con «Otro ingreso».
 */
export async function saveTreasuryAccount(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedTreasury>> {
  const op = 'master.saveTreasuryAccount'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const input = formInput(raw)
    const parsed = treasurySchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    const editing = v.id !== null
    if (editing && v.expectedUpdatedAt === null) return accFailure('stale')
    const payload = editing
      ? { id: v.id, ...rpcPayload(v, TREASURY_UPDATE_FIELDS, keepPresent(input)) }
      : rpcPayload(v, TREASURY_CREATE_FIELDS)
    const deactivating = editing && payload.active === false

    const result = await saveVia(slug, auth.tenantId, 'p_treasury', {
      op,
      rpc: 'acc_save_treasury_account',
      args: { payload, expected: editing ? v.expectedUpdatedAt : null },
      row: treasuryRow,
      message: (row) =>
        !editing
          ? `«${row.name}» quedó creada.`
          : deactivating
            ? `«${row.name}» quedó desactivada.`
            : 'Datos guardados.',
    })
    // La base no deja que una caja pase a ser la tarjeta de la empresa (ni al revés).
    if (!result.ok && editing && result.detail?.key === 'treasury_account_invalid') {
      return fieldFailure(
        'kind',
        'Una caja no puede pasar a ser la tarjeta de la empresa (ni al revés). Creá una nueva.',
      )
    }
    return result
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Medios de cobro ─────────────────────────────────────────────────────────

const METHOD_FIELDS: FieldMap = [
  ['name', 'name'],
  ['kind', 'kind'],
  ['channel', 'channel'],
  ['treasuryAccountId', 'treasury_account_id'],
  ['partyId', 'party_id'],
  ['settlementDays', 'settlement_days'],
  ['active', 'active'],
  ['sort', 'sort'],
]

/** Alta o edición de un medio de cobro del cierre del día. */
export async function saveSalesMethod(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedSalesMethod>> {
  const op = 'master.saveSalesMethod'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const input = formInput(raw)
    const parsed = salesMethodSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    const editing = v.id !== null
    if (editing && v.expectedUpdatedAt === null) return accFailure('stale')
    const present = keepPresent(input)
    // El orden: si el formulario no lo manda, en un alta lo pone la base (al final).
    const keep = editing ? present : (field: string) => field !== 'sort' || present('sort')
    const payload = rpcPayload(v, METHOD_FIELDS, keep)
    if (editing) payload.id = v.id
    const toggled = editing && present('active') ? v.active : undefined

    return await saveVia(slug, auth.tenantId, 'p_method', {
      op,
      rpc: 'acc_save_sales_method',
      args: { payload, expected: editing ? v.expectedUpdatedAt : null },
      row: methodRow,
      message: (row) =>
        !editing
          ? `«${row.name}» quedó creado.`
          : toggled === false
            ? `«${row.name}» quedó apagado.`
            : toggled === true
              ? `«${row.name}» quedó prendido.`
              : 'Datos guardados.',
    })
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Puntos de venta ─────────────────────────────────────────────────────────

const SALES_POINT_FIELDS: FieldMap = [
  ['number', 'number'],
  ['label', 'label'],
  ['defaultChannel', 'default_channel'],
  ['active', 'active'],
]

/** Alta o edición de un punto de venta de la SAS. */
export async function saveSalesPoint(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedSalesPoint>> {
  const op = 'master.saveSalesPoint'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const input = formInput(raw)
    const parsed = salesPointSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    const editing = v.id !== null
    if (editing && v.expectedUpdatedAt === null) return accFailure('stale')
    const payload = editing
      ? { id: v.id, ...rpcPayload(v, SALES_POINT_FIELDS, keepPresent(input)) }
      : rpcPayload(v, SALES_POINT_FIELDS)

    return await saveVia(slug, auth.tenantId, 'p_point', {
      op,
      rpc: 'acc_save_sales_point',
      args: { payload, expected: editing ? v.expectedUpdatedAt : null },
      row: salesPointRow,
      message: (row) =>
        editing ? 'Datos guardados.' : `Punto de venta ${row.number} · ${row.label} cargado.`,
    })
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Gastos fijos ────────────────────────────────────────────────────────────

const RECURRING_FIELDS: FieldMap = [
  ['name', 'name'],
  ['partyId', 'party_id'],
  ['accountId', 'account_id'],
  ['voucherType', 'voucher_type'],
  ['vatRateBp', 'vat_rate_bp'],
  ['amountCents', 'amount_cents'],
  ['frequency', 'frequency'],
  ['dueDay', 'due_day'],
  ['nextDueDate', 'next_due_date'],
  ['remindDaysBefore', 'remind_days_before'],
  ['treasuryAccountId', 'treasury_account_id'],
  ['active', 'active'],
  ['notes', 'notes'],
]

/** Alta o edición de un gasto fijo (recordatorio con vencimiento; no devenga). */
export async function saveRecurringExpense(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedRecurringExpense>> {
  const op = 'master.saveRecurringExpense'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const input = formInput(raw)
    const parsed = recurringSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    if (v.voucherType?.startsWith('nota_credito')) {
      return fieldFailure('voucherType', 'Un gasto fijo no se carga con una nota de crédito.')
    }
    const editing = v.id !== null
    if (editing && v.expectedUpdatedAt === null) return accFailure('stale')
    const payload = editing
      ? { id: v.id, ...rpcPayload(v, RECURRING_FIELDS, keepPresent(input)) }
      : rpcPayload(v, RECURRING_FIELDS)

    return await saveVia(slug, auth.tenantId, 'p_expense', {
      op,
      rpc: 'acc_save_recurring_expense',
      args: { payload, expected: editing ? v.expectedUpdatedAt : null },
      row: recurringRow,
      message: (row) =>
        editing
          ? 'Gasto fijo guardado.'
          : `«${row.name}» quedó cargado: vence el ${formatIsoDay(row.nextDueDate)}.`,
    })
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * «Saltear este vencimiento»: avanza al próximo sin cargar nada. `dueDate` es
 * el vencimiento que vio la persona (si cambió: `stale`).
 */
export async function skipRecurringDue(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedRecurringExpense>> {
  const op = 'master.skipRecurringDue'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = skipRecurringDueSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_skip_recurring_due', {
      p_tenant_id: auth.tenantId,
      p_id: parsed.data.id,
      p_due_date: parsed.data.dueDate,
    })
    if (error) return rpcFailure(op, error)
    const r = asRecord(data)
    if (!r) return unexpectedFailure(op, new Error('respuesta vacía'))
    const row = recurringRow(r)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: row,
      message: `Listo: el próximo vencimiento es el ${formatIsoDay(row.nextDueDate)}.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
