/**
 * Lo que Tex arma para compras, sin tocar la base: de lo que dijo la persona (ya pasado a ids) a lo
 * mismo que manda el formulario, con su tique. Puro: usa las piezas de cada pantalla
 * (`buildPurchaseValues`, `purchaseRoute`, `buildQuickExpenseValues`, `planPayment`), así que una compra
 * cargada con Tex es la misma que cargada a mano. Lo que hay que leer de la base lo trae `compras.ts`.
 * Lo prueba `tests/lib/tex-actions-compras.test.ts`.
 *
 * Cada función devuelve `{ ok: false, message }` cuando falta algo: el mensaje es para Tex y le dice qué
 * preguntar. Tex nunca elige a ojo.
 */

import { z } from 'zod'
import { isPurchaseImputation } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import {
  bankTaxNote,
  paymentBankTax,
  paymentOutcome,
  payTicketRows,
  quickSelections,
  weekBudgetNote,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-summary'
import {
  defaultDebtSelection,
  type PlanCredit,
  type PlanDebt,
  planPayment,
  resolveMethods,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/payment-plan'
import {
  buildPurchaseValues,
  detailVat,
  discriminatesVat,
  type PurchaseFormState,
  purchaseTotal,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase'
import {
  conditionForVoucher,
  conditionNoun,
  pendingItemText,
  purchaseRoute,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase-paper'
import {
  buildQuickExpenseValues,
  buildQuickFromPurchase,
  type ExpenseTarget,
  isInvoiceVoucher,
  isQuickVatRate,
  type QuickVoucher,
  quickExpenseOutcome,
  quickVoucherFromType,
  splitTotal,
  suggestQuickVatRate,
  suggestQuickVoucher,
  VAT_ADJUST_LIMIT,
  withRemito,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import { supplierDefaultAccount } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/supplier-account'
import {
  anyVoucherOptions,
  defaultVoucherFor,
  notInvoicedDefault,
  rememberedVoucherType,
  voucherOptionsFor,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/vouchers'
import {
  paperOutcomeNote,
  paperStamp,
  ticketTotalLabel,
} from '@/components/administracion/acciones/gasto-papel'
import { amountLooksOff, suggestDueDate } from '@/lib/accounting/defaults'
import { isVatRateBp, vatFromNet, vatRateLabel } from '@/lib/accounting/iva'
import { partySchema } from '@/lib/accounting/schemas'
import type { DocumentForm } from '@/lib/accounting/server/document-types'
import type {
  AccountType,
  IvaCondition,
  OpenItemRef,
  PartyKind,
  PostingContext,
  TreasuryKind,
  VatRateBp,
  VoucherType,
} from '@/lib/accounting/types'
import {
  isVoucherType,
  VOUCHER_CATALOG,
  voucherDisplay,
  voucherLabel,
  voucherNumberRequired,
} from '@/lib/accounting/voucher-types'
import { type BudgetItem, type WeekPlanRow, weekLabel } from '@/lib/accounting/week-plan'
import { capitalizeFirst, formatIsoDay, formatMonthYear } from '@/lib/dates'
import type { TexTicketWarning } from '../../protocol'
import { dayText, money, type TexTicketDraft, type TexToolResult, zodIssuesText } from '../types'

// ─── Lo que comparten las herramientas ───────────────────────────────────────

export type PlanFailure = { ok: false; message: string }
export type TicketBase = Omit<TexTicketDraft, 'entry' | 'warnings'>
export type DocumentPlan<F extends DocumentForm = DocumentForm> = {
  ok: true
  form: F
  values: Record<string, unknown>
  ticket: TicketBase
}

export function fail(message: string): PlanFailure {
  return { ok: false, message }
}

type Row = { label: string; value: string }

export function row(label: string, value: string): Row {
  return { label, value }
}

/** Los renglones que van: `cond && row(…)` deja afuera lo que no corresponde. */
export function rows(list: ReadonlyArray<Row | null | false | undefined | ''>): Row[] {
  return list.filter((r): r is Row => Boolean(r))
}

/** `2026-11-05` → `05/11/2026`, sin el `null` de `dayText` (acá la fecha siempre existe). */
export function dayRow(label: string, iso: string): Row {
  return row(label, dayText(iso) ?? iso)
}

/** Un aviso del tique que no sale del motor: se lee, no hay que aceptarlo para guardar. */
export function notice(key: string, title: string): TexTicketWarning {
  return { key, title, body: null }
}

/** Le suma esos avisos al tique que armó `prepareDocument`. */
export function withNotices(
  result: TexToolResult,
  notices: readonly TexTicketWarning[],
): TexToolResult {
  if (result.kind !== 'prepared' || notices.length === 0) return result
  const { ticket } = result.prepared
  return {
    kind: 'prepared',
    prepared: {
      ...result.prepared,
      ticket: { ...ticket, warnings: [...ticket.warnings, ...notices] },
    },
  }
}

export function isUuid(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
}

/** Sin tildes y en minúsculas. Es `searchKey`, que acá no se importa: vive con las lecturas de la base. */
export function textKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export type NameMatch<T> =
  | { kind: 'one'; value: T }
  | { kind: 'many'; options: T[] }
  | { kind: 'none' }

/** Lo que dijo la gente contra una lista: primero igual, después «contiene». Nunca elige entre dos. */
export function matchByName<T>(
  wanted: string,
  list: readonly T[],
  names: (item: T) => ReadonlyArray<string | null | undefined>,
): NameMatch<T> {
  const key = textKey(wanted)
  if (key === '') return { kind: 'none' }
  const namesOf = (item: T) => names(item).flatMap((n) => (n ? [textKey(n)] : []))
  const exact = list.filter((item) => namesOf(item).includes(key))
  const pool =
    exact.length > 0 ? exact : list.filter((item) => namesOf(item).some((n) => n.includes(key)))
  const [first] = pool
  if (first === undefined) return { kind: 'none' }
  return pool.length === 1 ? { kind: 'one', value: first } : { kind: 'many', options: pool }
}

/** La alícuota como la dice la gente: 21, 10.5… */
export const alicuotaField = (description = 'En %: 21, 10.5, 27, 5, 2.5 o 0.') =>
  z
    .number()
    .refine((v) => isVatRateBp(Math.round(v * 100)), 'Las alícuotas son 21, 10.5, 27, 5, 2.5 y 0.')
    .describe(description)

export function rateBpOf(percent: number): VatRateBp {
  const bp = Math.round(percent * 100)
  return isVatRateBp(bp) ? bp : 2100
}

function positive(cents: number | null | undefined): cents is number {
  return typeof cents === 'number' && cents > 0
}

// ─── Cuentas ─────────────────────────────────────────────────────────────────

type AccountFacts = {
  id: string
  code: string
  name: string
  type: AccountType
  postable: boolean
  active: boolean
  requiresParty: boolean
  isTreasury: boolean
  purchaseSelectable: boolean
  systemKey: string | null
}

/** Las cuentas que se pueden elegir en «¿En qué?» de una compra o un gasto: id → nombre. */
export function imputableAccounts(accounts: Iterable<AccountFacts>): Map<string, string> {
  const out = new Map<string, string>()
  for (const account of accounts) {
    if (isPurchaseImputation(account)) out.set(account.id, account.name)
  }
  return out
}

/**
 * «Mercadería», «bebidas» o el código, entre las que se pueden imputar. Sin el «Compras: » adelante,
 * que es como las dice la gente.
 */
export function matchImputable(
  wanted: string,
  accounts: Iterable<AccountFacts>,
): NameMatch<AccountFacts> {
  const usable = [...accounts].filter(isPurchaseImputation)
  const byId = usable.filter((a) => a.id === wanted || a.code === wanted.trim())
  const [first] = byId
  if (first && byId.length === 1) return { kind: 'one', value: first }
  return matchByName(wanted, usable, (a) => [a.name, a.name.replace(/^compras\s*:\s*/i, '')])
}

// ─── El proveedor ────────────────────────────────────────────────────────────

/** Su ficha. */
export type SupplierFacts = {
  id: string
  /** Como se lo conoce. */
  name: string
  kind: PartyKind
  ivaCondition: IvaCondition
  taxId: string | null
  paymentTermDays: number
  defaultAccountId: string | null
  defaultVoucherType: string | null
}

/** Lo que el sistema recuerda de él (`acc_form_defaults`). */
export type SupplierMemory = {
  accountId: string | null
  voucherType: string | null
  vatRateBp: number | null
  pointOfSale: number | null
  treasuryAccountId: string | null
  medianTotalCents: number | null
}

export type DraftSupplier =
  | { kind: 'existing'; facts: SupplierFacts; memory: SupplierMemory | null }
  | { kind: 'new'; name: string; ivaCondition: IvaCondition | null; taxId: string | null }

export type RecurringFacts = {
  id: string
  name: string
  partyId: string | null
  accountId: string
  voucherType: string | null
  vatRateBp: number | null
  amountCents: number | null
  treasuryAccountId: string | null
}

export type TreasuryFacts = { id: string; name: string; kind: TreasuryKind }

/** Los papeles que se le pueden pedir a Tex. */
export const COMPRA_PAPERS = [
  'factura_a',
  'factura_b',
  'factura_c',
  'tique',
  'sin_comprobante',
] as const satisfies readonly VoucherType[]
export type CompraPaper = (typeof COMPRA_PAPERS)[number]

/** Los que no se cargan por charla: tienen partidas que elegir o reglas propias. */
export const SCREEN_PAPERS = [
  'nota_de_credito',
  'nota_de_debito',
  'ddjj',
  'factura_de_comisiones',
] as const
export type ScreenPaper = (typeof SCREEN_PAPERS)[number]

export function isScreenPaper(paper: string): paper is ScreenPaper {
  return (SCREEN_PAPERS as readonly string[]).includes(paper)
}

/** A dónde llevar a la persona con cada uno. */
export function screenPaperMessage(paper: ScreenPaper): string {
  switch (paper) {
    case 'nota_de_credito':
      return 'Una nota de crédito de un proveedor se carga en su pantalla, porque hay que elegir qué compra corrige: llevala con ir_a a compras.nueva y señalale «Es una nota de crédito».'
    case 'nota_de_debito':
      return 'Una nota de débito de un proveedor se carga en su pantalla: llevala con ir_a a compras.nueva y señalale «Es una nota de débito».'
    case 'ddjj':
      return 'Una DDJJ o boleta de impuesto se carga en su pantalla, porque lleva la cuenta del impuesto: llevala con ir_a a compras.nueva y elegí el organismo.'
    case 'factura_de_comisiones':
      return 'La factura de comisiones de una tarjeta o una app no es una compra: entra desde Importar, con el comprobante de ARCA, y libera el IVA que quedó a documentar. Llevala con ir_a a importar.'
  }
}

/** «Septiembre está cerrado…»: el mismo aviso de la pantalla, cuando la fecha cae en un mes cerrado. */
function closedMonthNotice(date: string, firstOpenDate: string | null): TexTicketWarning[] {
  if (!firstOpenDate || date >= firstOpenDate) return []
  return [
    notice(
      'tex_mes_cerrado',
      `${capitalizeFirst(formatMonthYear(date))} está cerrado: lo cargamos el ${formatIsoDay(firstOpenDate)} (el IVA va a ${formatMonthYear(firstOpenDate)}).`,
    ),
  ]
}

function supplierName(supplier: DraftSupplier | null): string | null {
  if (supplier === null) return null
  return supplier.kind === 'existing' ? supplier.facts.name : supplier.name
}

/** El papel no entra con lo que sabemos del proveedor: lo mismo que abre «¿Cómo te factura?». */
function paperGapMessage(input: {
  name: string
  isNew: boolean
  condition: IvaCondition
  voucher: VoucherType
}): string {
  const label = voucherLabel(input.voucher)
  if (input.condition === 'sin_datos') {
    return `Todavía no sabemos cómo factura ${input.name}, y sin eso no se le puede cargar ${label}. Preguntale si es responsable inscripto, monotributista o exento, cargalo con preparar_proveedor y volvé a preparar esto.`
  }
  const noun = conditionNoun(input.condition)
  if (input.isNew) {
    return `Un ${noun} no da ${label}. Preguntale cómo factura ${input.name} o qué papel le dio.`
  }
  return `${input.name} figura como ${noun}, que no da ${label}. Preguntale qué papel le dieron; si de verdad es ese, corregí cómo factura con preparar_proveedor y volvé a preparar esto.`
}

function cuitGapMessage(name: string, isNew: boolean): string {
  return isNew
    ? `Con ese papel, el proveedor nuevo necesita CUIT para el Libro IVA. Preguntale el CUIT de ${name}.`
    : `${name} no tiene CUIT cargado y ese papel va al Libro IVA. Preguntale el CUIT y cargalo con preparar_proveedor antes de volver a preparar esto.`
}

// ─── La compra ───────────────────────────────────────────────────────────────

export type CompraExtras = {
  nonTaxedCents: number | null
  exemptCents: number | null
  internalTaxCents: number | null
  percIvaCents: number | null
  percIibbCents: number | null
  percGananciasCents: number | null
  otherTaxesCents: number | null
}

export const NO_EXTRAS: CompraExtras = {
  nonTaxedCents: null,
  exemptCents: null,
  internalTaxCents: null,
  percIvaCents: null,
  percIibbCents: null,
  percGananciasCents: null,
  otherTaxesCents: null,
}

export type CompraDraft = {
  today: string
  supplier: DraftSupplier | null
  /** `null`: el habitual del proveedor. */
  paper: CompraPaper | null
  pointOfSale: number | null
  number: number | null
  /** El número de remito, si va sin factura. */
  remito: string | null
  /** `null`: hoy. */
  issueDate: string | null
  /** `null`: la fecha más el plazo. */
  dueDate: string | null
  /** A cuántos días. `null`: el de su ficha. */
  termDays: number | null
  /** Con IVA, percepciones y otros tributos. Con `nets`, es el total de control. */
  totalCents: number | null
  /** `null`: la del proveedor, o 21 %. */
  vatRateBp: VatRateBp | null
  /** El IVA impreso, si se cargó por total. */
  vatCents: number | null
  /** Neto por alícuota, si los dijo: pasa a modo detalle. */
  nets: ReadonlyArray<{ rateBp: VatRateBp; netCents: number; vatCents: number | null }>
  extras: CompraExtras
  iibbJurisdictionCode: number
  otherTaxesAccountId: string | null
  /** En qué, si lo dijo. */
  account: { id: string; name: string } | null
  /** Las que se pueden imputar: id → nombre. */
  imputable: ReadonlyMap<string, string>
  /** «Ya la pagué». */
  pay: {
    treasury: TreasuryFacts
    /** `null`: el total. */
    amountCents: number | null
    /** `null`: hoy. */
    date: string | null
    reference: string | null
  } | null
  recurring: RecurringFacts | null
  notes: string | null
  /** El primer día abierto, si hay meses cerrados. */
  firstOpenDate: string | null
}

export type CompraPlan = DocumentPlan<'purchase' | 'quick_expense'> & {
  notices: TexTicketWarning[]
  voucherType: VoucherType
  totalCents: number | null
  pointOfSale: number | null
  number: number | null
}

/** Lo que manda «Cargar una compra» (o «Compra y pago», que sin factura es un gasto). */
export function compraPlan(draft: CompraDraft): PlanFailure | CompraPlan {
  const { supplier, recurring, extras } = draft
  const existing = supplier?.kind === 'existing' ? supplier : null
  const fresh = supplier?.kind === 'new' ? supplier : null
  const memory = existing?.memory ?? null
  const name = supplierName(supplier)
  const paying = draft.pay !== null

  if (supplier === null && !paying) {
    return fail(
      'Falta el proveedor. Si no tiene proveedor y ya está pagado, es un gasto: usá preparar_gasto.',
    )
  }
  if (recurring?.partyId && existing && recurring.partyId !== existing.facts.id) {
    return fail(`«${recurring.name}» es un gasto fijo de otro proveedor. Preguntale cuál es.`)
  }

  // ── El papel ──
  const wanted = draft.paper
  const condition: IvaCondition | null = existing
    ? existing.facts.ivaCondition
    : fresh
      ? (fresh.ivaCondition ??
        (wanted ? conditionForVoucher(wanted) : null) ??
        'responsable_inscripto')
      : null
  const options =
    supplier === null
      ? anyVoucherOptions('factura')
      : voucherOptionsFor({
          family: 'factura',
          condition,
          isTaxAgency: existing?.facts.kind === 'tax_agency',
        })
  if (wanted && !options.includes(wanted) && condition && name) {
    return fail(paperGapMessage({ name, isNew: fresh !== null, condition, voucher: wanted }))
  }
  const fromRecurring =
    isVoucherType(recurring?.voucherType) && options.includes(recurring.voucherType)
      ? recurring.voucherType
      : null
  const voucherType =
    wanted ??
    fromRecurring ??
    (supplier === null && paying
      ? notInvoicedDefault(options)
      : defaultVoucherFor({
          family: 'factura',
          options,
          remembered: rememberedVoucherType({
            habitual: existing?.facts.defaultVoucherType,
            lastUsed: memory?.voucherType,
          }),
          condition,
        }))
  if (voucherType === null) {
    return fail(
      `No hay un papel que se le pueda cargar a ${name ?? 'esta compra'}: preguntale cuál le dio.`,
    )
  }

  // ── El número ──
  const info = VOUCHER_CATALOG[voucherType]
  const numberRequired = voucherNumberRequired(voucherType)
  const pointOfSale = draft.pointOfSale ?? (info.numbered ? (memory?.pointOfSale ?? null) : null)
  const hasNumber = pointOfSale !== null && draft.number !== null
  if (numberRequired && !hasNumber) {
    return fail(
      wanted
        ? `${info.label} lleva punto de venta y número. Preguntáselos.`
        : `A ${name ?? 'este proveedor'} se le carga ${info.label}, que lleva punto de venta y número. Preguntale esos números, o qué papel le dieron.`,
    )
  }
  const entersBook = info.ivaBook && (numberRequired || hasNumber)
  if (entersBook && name && (existing ? !existing.facts.taxId : fresh ? !fresh.taxId : false)) {
    return fail(cuitGapMessage(name, fresh !== null))
  }

  // ── En qué ──
  const imputableIds = new Set(draft.imputable.keys())
  const fromRecurringAccount =
    recurring && imputableIds.has(recurring.accountId) ? recurring.accountId : null
  const fromMemory =
    memory?.accountId && imputableIds.has(memory.accountId) ? memory.accountId : null
  const accountId =
    draft.account?.id ??
    fromRecurringAccount ??
    fromMemory ??
    supplierDefaultAccount(existing?.facts.defaultAccountId, imputableIds)
  if (accountId === null) {
    return fail(
      `Preguntale en qué es esta compra${name ? ` a ${name}` : ''} (mercadería, bebidas, limpieza…) y pasalo en cuenta; si no la encontrás, buscala con buscar_cuenta.`,
    )
  }

  // ── Los importes ──
  const vat = discriminatesVat(voucherType)
  const detail =
    draft.nets.length > 0 ||
    positive(extras.nonTaxedCents) ||
    positive(extras.exemptCents) ||
    positive(extras.internalTaxCents)
  if (detail && !vat) {
    return fail(`${info.label} no discrimina IVA: pasame solo el total.`)
  }
  const remembered = (value: number | null | undefined): VatRateBp | null =>
    isVatRateBp(value) ? value : null
  const vatRateBp =
    draft.vatRateBp ?? remembered(recurring?.vatRateBp) ?? remembered(memory?.vatRateBp) ?? 2100
  const totalCents = draft.totalCents ?? (detail ? null : (recurring?.amountCents ?? null))
  const taxedOutside =
    (extras.percIvaCents ?? 0) +
    (extras.percIibbCents ?? 0) +
    (extras.percGananciasCents ?? 0) +
    (extras.otherTaxesCents ?? 0)

  const nets: Partial<Record<VatRateBp, number>> = {}
  const vatAdjust: Partial<Record<VatRateBp, number>> = {}
  for (const net of draft.nets) {
    if (nets[net.rateBp] !== undefined) {
      return fail(`La alícuota de ${vatRateLabel(net.rateBp)} está dos veces: sumalas en una.`)
    }
    nets[net.rateBp] = net.netCents
    if (net.vatCents === null) continue
    const computed = net.rateBp === 0 ? 0 : vatFromNet(net.netCents, net.rateBp)
    const diff = net.vatCents - computed
    if (Math.abs(diff) > VAT_ADJUST_LIMIT) {
      return fail(
        `El IVA de ${money(net.vatCents)} no coincide con el ${vatRateLabel(net.rateBp)} de ${money(net.netCents)}, que da ${money(computed)}. Preguntale si la alícuota o el neto son otros.`,
      )
    }
    if (diff !== 0) vatAdjust[net.rateBp] = diff
  }

  let vatAdjustCents = 0
  if (!detail && vat && draft.vatCents !== null && totalCents !== null && vatRateBp !== 0) {
    const split = splitTotal(totalCents - taxedOutside, vatRateBp)
    if (split === null) return fail('Las percepciones superan el total: revisá los importes.')
    const diff = draft.vatCents - split.vatCents
    if (Math.abs(diff) > VAT_ADJUST_LIMIT) {
      return fail(
        `El IVA de ${money(draft.vatCents)} no coincide con el ${vatRateLabel(vatRateBp)} del total, que da ${money(split.vatCents)}. Si la factura tiene más de una alícuota, pasame los netos.`,
      )
    }
    vatAdjustCents = diff
  }

  // ── Lo que se manda ──
  const issueDate = draft.issueDate ?? draft.today
  const termDays = draft.termDays ?? existing?.facts.paymentTermDays ?? 0
  const dueDate = draft.dueDate ?? suggestDueDate(issueDate, termDays)
  const notes = draft.notes ?? ''
  const remito = draft.remito ?? ''
  const state: PurchaseFormState = {
    party: existing
      ? { kind: 'existing', id: existing.facts.id }
      : fresh
        ? {
            kind: 'new',
            name: fresh.name,
            ivaCondition: condition ?? 'responsable_inscripto',
            taxId: fresh.taxId ?? '',
            // «Pagarle siempre a N días» solo se ofrece en lo que queda a deber.
            paymentTermDays: paying ? 0 : (draft.termDays ?? 0),
          }
        : null,
    voucherType,
    pointOfSale,
    number: draft.number,
    issueDate,
    dueDate,
    amountMode: detail ? 'detail' : 'total',
    totalCents,
    vatRateBp,
    vatAdjustCents,
    accountId,
    nets,
    vatAdjust,
    grossCents: null,
    nonTaxedCents: extras.nonTaxedCents,
    exemptCents: extras.exemptCents,
    internalTaxCents: extras.internalTaxCents,
    percIvaCents: extras.percIvaCents,
    percIibbCents: extras.percIibbCents,
    iibbJurisdictionCode: draft.iibbJurisdictionCode,
    percGananciasCents: extras.percGananciasCents,
    otherTaxesCents: extras.otherTaxesCents,
    otherTaxesAccountId: draft.otherTaxesAccountId,
    controlTotalCents: detail ? totalCents : null,
    relatedDocumentId: null,
    recurringExpenseId: recurring?.id ?? null,
    payNow: draft.pay
      ? {
          treasuryAccountId: draft.pay.treasury.id,
          amountCents: draft.pay.amountCents,
          date: draft.pay.date ?? draft.today,
          reference: draft.pay.reference ?? '',
        }
      : null,
    notes: voucherType === 'sin_comprobante' ? withRemito(remito, notes) : notes,
  }
  const route = purchaseRoute(state, { family: 'factura', today: draft.today, notes, remito })
  const built =
    route === 'quick_expense'
      ? buildQuickFromPurchase(state, { notes, remito })
      : buildPurchaseValues(state)
  if (built.values === null) return fail(Object.values(built.missing).join(' '))

  // ── El tique ──
  const total = purchaseTotal(state)
  const numbered = info.numbered && (numberRequired || hasNumber)
  const paper = voucherDisplay(
    voucherType,
    numbered ? pointOfSale : null,
    numbered ? draft.number : null,
  )
  const pay = draft.pay
  const split =
    !detail && vat && totalCents !== null
      ? splitTotal(totalCents - taxedOutside, vatRateBp, vatAdjustCents)
      : null
  const median = memory?.medianTotalCents ?? null
  const ticket: TicketBase = {
    kind: paying ? 'compra_y_pago' : 'compra',
    title: paying ? 'Compra y pago' : 'Compra',
    subtitle: name ? `${name} · ${paper}` : paper,
    rows: rows([
      fresh && row('Proveedor nuevo', newSupplierWords(fresh, condition)),
      row('Va a', draft.account?.name ?? draft.imputable.get(accountId) ?? 'La cuenta elegida'),
      dayRow('Fecha', issueDate),
      !paying && dayRow('Vence', dueDate),
      split && row('Neto', money(split.netCents)),
      split && row(`IVA ${vatRateLabel(vatRateBp)}`, money(split.vatCents)),
      ...draft.nets.flatMap((net) => [
        row(`Neto ${vatRateLabel(net.rateBp)}`, money(net.netCents)),
        net.rateBp !== 0 &&
          row(
            `IVA ${vatRateLabel(net.rateBp)}`,
            money(detailVat(net.netCents, net.rateBp, vatAdjust[net.rateBp] ?? 0)),
          ),
      ]),
      positive(extras.nonTaxedCents) && row('No gravado', money(extras.nonTaxedCents)),
      positive(extras.exemptCents) && row('Exento', money(extras.exemptCents)),
      positive(extras.internalTaxCents) &&
        row('Impuestos internos', money(extras.internalTaxCents)),
      positive(extras.percIvaCents) && row('Percepción de IVA', money(extras.percIvaCents)),
      positive(extras.percIibbCents) &&
        row('Percepción de Ingresos Brutos', money(extras.percIibbCents)),
      positive(extras.percGananciasCents) &&
        row('Percepción de Ganancias', money(extras.percGananciasCents)),
      positive(extras.otherTaxesCents) && row('Otros tributos', money(extras.otherTaxesCents)),
      pay && row('Pagada con', pay.treasury.name),
      pay?.amountCents != null && row('Paga ahora', money(pay.amountCents)),
      pay?.amountCents != null &&
        total !== null &&
        total > pay.amountCents &&
        row('Queda debiendo', money(total - pay.amountCents)),
      pay?.date && pay.date !== draft.today && dayRow('Fecha del pago', pay.date),
      pay?.reference && row('Referencia', pay.reference),
      recurring && row('Gasto fijo', recurring.name),
      state.notes.trim() !== '' && row('Nota', state.notes.trim()),
    ]),
    total: total !== null ? row('Total', money(total)) : null,
    confirmLabel: paying ? 'Cargar compra y pago' : 'Cargar la compra',
  }
  return {
    ok: true,
    form: route,
    values: built.values,
    ticket,
    // «¿Un cero de más?»: lo que la pantalla avisa al lado del total.
    notices: [
      ...closedMonthNotice(issueDate, draft.firstOpenDate),
      ...(total !== null && amountLooksOff(total, median)
        ? [notice('tex_monto_raro', `Con ${name} solés gastar alrededor de ${money(median)}.`)]
        : []),
    ],
    voucherType,
    totalCents: total,
    pointOfSale: numbered ? pointOfSale : null,
    number: numbered ? draft.number : null,
  }
}

function newSupplierWords(
  supplier: Extract<DraftSupplier, { kind: 'new' }>,
  condition: IvaCondition | null,
): string {
  return [
    supplier.name,
    supplier.taxId ? `CUIT ${supplier.taxId}` : null,
    condition ? conditionNoun(condition) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

// ─── El gasto ────────────────────────────────────────────────────────────────

export const GASTO_PAPERS = ['sin_comprobante', 'tique'] as const
export type GastoPaper = (typeof GASTO_PAPERS)[number]

const GASTO_VOUCHERS: Readonly<Record<GastoPaper, QuickVoucher>> = {
  sin_comprobante: 'none',
  tique: 'ticket',
}

export type GastoDraft = {
  supplier: DraftSupplier | null
  /** `null`: lo que se propone para ese proveedor. */
  paper: GastoPaper | null
  pointOfSale: number | null
  number: number | null
  remito: string | null
  /** `null`: el del gasto fijo. */
  amountCents: number | null
  account: { id: string; name: string } | null
  imputable: ReadonlyMap<string, string>
  treasury: TreasuryFacts
  date: string
  detail: string | null
  recurring: RecurringFacts | null
  /** El primer día abierto, si hay meses cerrados. */
  firstOpenDate: string | null
}

/**
 * Lo que manda «Nuevo gasto»: lo de todos los días, sin factura de un proveedor. Con factura es una
 * compra pagada en el momento: la misma carga, con el resto del papel (`compraPlan`).
 */
export function gastoPlan(
  draft: GastoDraft,
): PlanFailure | (DocumentPlan<'quick_expense'> & { notices: TexTicketWarning[] }) {
  const { supplier, recurring } = draft
  const existing = supplier?.kind === 'existing' ? supplier : null
  const fresh = supplier?.kind === 'new' ? supplier : null
  const memory = existing?.memory ?? null
  const name = supplierName(supplier)
  if (recurring?.partyId && existing && recurring.partyId !== existing.facts.id) {
    return fail(`«${recurring.name}» es un gasto fijo de otro proveedor. Preguntale cuál es.`)
  }

  // ── El papel: el que dijo o el que propone la hoja. Con factura, es una compra ──
  const condition: IvaCondition | null = existing
    ? existing.facts.ivaCondition
    : (fresh?.ivaCondition ?? (fresh ? 'responsable_inscripto' : null))
  // Una factura pide proveedor: la de un gasto fijo sin proveedor no se propone (`recurringPrefill`).
  const habitual = recurring ? quickVoucherFromType(recurring.voucherType) : null
  const proposed: QuickVoucher =
    (habitual !== null && (supplier !== null || !isInvoiceVoucher(habitual)) ? habitual : null) ??
    suggestQuickVoucher({
      hasParty: supplier !== null,
      habitualVoucherType: existing?.facts.defaultVoucherType ?? null,
      lastVoucherType: memory?.voucherType ?? null,
      condition,
    })
  const voucher = draft.paper ? GASTO_VOUCHERS[draft.paper] : proposed
  if (voucher === 'a' || voucher === 'bc') {
    return fail(
      `A ${recurring?.name ?? name ?? 'esto'} se le carga factura, y eso es una compra: usá preparar_compra con pagada y el número del papel. Si no le dieron factura, mandá papel sin_comprobante.`,
    )
  }

  // ── En qué ──
  const imputableIds = new Set(draft.imputable.keys())
  const accountId =
    draft.account?.id ??
    (recurring && imputableIds.has(recurring.accountId) ? recurring.accountId : null) ??
    supplierDefaultAccount(existing?.facts.defaultAccountId, imputableIds) ??
    (memory?.accountId && imputableIds.has(memory.accountId) ? memory.accountId : null)
  if (accountId === null) {
    return fail(
      'Preguntale en qué se gastó y pasalo en cuenta (hielo, limpieza, mantenimiento…); si no la encontrás, buscala con buscar_cuenta.',
    )
  }

  const target: ExpenseTarget = existing
    ? { kind: 'party', partyId: existing.facts.id, accountId }
    : fresh
      ? {
          kind: 'new',
          name: fresh.name,
          ivaCondition: condition ?? 'responsable_inscripto',
          taxId: fresh.taxId ?? '',
          accountId,
        }
      : { kind: 'account', accountId }
  const pointOfSale =
    voucher === 'ticket' ? (draft.pointOfSale ?? memory?.pointOfSale ?? null) : null
  const number = voucher === 'ticket' ? draft.number : null
  // Un tique con los dos entra al Libro IVA; a medias, va como gasto.
  const hasNumber = pointOfSale !== null && number !== null
  const amountCents = draft.amountCents ?? recurring?.amountCents ?? null
  const built = buildQuickExpenseValues({
    amountCents,
    target,
    treasuryAccountId: draft.treasury.id,
    voucher,
    vatRateBp: suggestQuickVatRate(
      isQuickVatRate(recurring?.vatRateBp) ? recurring?.vatRateBp : memory?.vatRateBp,
    ),
    vatAdjustCents: 0,
    pointOfSale: hasNumber ? pointOfSale : null,
    number: hasNumber ? number : null,
    date: draft.date,
    detail: draft.detail ?? '',
    remito: draft.remito ?? '',
    recurringExpenseId: recurring?.id ?? null,
  })
  if (built.values === null) {
    return fail(
      amountCents === null ? 'Preguntale cuánto gastó.' : Object.values(built.missing).join(' '),
    )
  }

  const outcome = quickExpenseOutcome({ voucher, hasParty: supplier !== null, hasNumber })
  const accountName = draft.account?.name ?? draft.imputable.get(accountId) ?? 'La cuenta elegida'
  const detail =
    voucher === 'none' ? withRemito(draft.remito ?? '', draft.detail ?? '') : (draft.detail ?? '')
  const stamp = paperStamp({ voucher, hasParty: supplier !== null, condition })
  return {
    ok: true,
    form: 'quick_expense',
    values: built.values,
    notices: closedMonthNotice(draft.date, draft.firstOpenDate),
    ticket: {
      kind: 'gasto',
      title: 'Gasto',
      subtitle: `${name ?? accountName} · ${stamp.text}`,
      rows: rows([
        fresh && row('Proveedor nuevo', newSupplierWords(fresh, condition)),
        row('Va a', accountName),
        dayRow('Fecha', draft.date),
        recurring && row('Gasto fijo', recurring.name),
        detail !== '' && row('Detalle', detail),
        row('Papel', paperOutcomeNote({ voucher, outcome, recovers: false })),
      ]),
      total: row(ticketTotalLabel(draft.treasury), money(amountCents)),
      confirmLabel: 'Cargar el gasto',
    },
  }
}

// ─── El pago ─────────────────────────────────────────────────────────────────

export const PAGO_SCOPES = ['lo_vencido', 'todo', 'a_cuenta'] as const
export type PagoScope = (typeof PAGO_SCOPES)[number]

export type PagoDraft = {
  today: string
  date: string
  party: { id: string; name: string; legalName: string; tradeName: string | null }
  /** Sus partidas abiertas, como las lee la hoja. */
  items: readonly OpenItemRef[]
  /** Si le debe en más de una cuenta: de cuál. */
  account: string | null
  accountNames: ReadonlyMap<string, string>
  /** `null`: lo que hace falta para cancelar lo elegido. */
  amountCents: number | null
  scope: PagoScope | null
  /** Comprobantes puntuales: el id de la partida o una parte de cómo se llama. */
  lines: readonly string[] | null
  /** «Dar por cancelado el resto», hasta $ 1.000. */
  writeOff: boolean
  treasury: TreasuryFacts
  reference: string | null
  notes: string | null
  recurring: { id: string; name: string } | null
  taxes: Pick<PostingContext, 'treasuries' | 'settings'>
  /** Lo que dice el Plan de la semana. */
  week: { budgetCents: number; paidCents: number } | null
}

/** El orden de la hoja: el que vence antes primero, los que no vencen al final. */
export function byDue(a: OpenItemRef, b: OpenItemRef): number {
  const da = a.dueDate ?? '9999-12-31'
  const db = b.dueDate ?? '9999-12-31'
  if (da !== db) return da < db ? -1 : 1
  return a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0
}

/** Los comprobantes que nombró: por su id, o por una parte de cómo se llaman («1290»). */
export function pickLines(
  wanted: readonly string[],
  debts: readonly OpenItemRef[],
): { ok: true; items: OpenItemRef[] } | PlanFailure {
  const items: OpenItemRef[] = []
  for (const text of wanted) {
    const byId = debts.find((d) => d.lineId === text)
    const match = byId
      ? ({ kind: 'one', value: byId } as const)
      : matchByName(text, debts, (d) => [d.label])
    if (match.kind === 'many') {
      return fail(
        `«${text}» puede ser ${match.options
          .slice(0, 6)
          .map((d) => `${d.label} (${money(d.openCents)})`)
          .join(', ')}. Preguntale cuál.`,
      )
    }
    if (match.kind === 'none') {
      const list = debts
        .slice(0, 8)
        .map((d) => `${d.label} (${money(d.openCents)})`)
        .join(', ')
      return fail(
        list
          ? `No hay un comprobante pendiente «${text}». Los que hay: ${list}.`
          : `No hay comprobantes pendientes: «${text}» no se puede aplicar.`,
      )
    }
    if (!items.includes(match.value)) items.push(match.value)
  }
  return { ok: true, items }
}

/**
 * Lo que manda la hoja «Pago». Con un monto, se aplica a los comprobantes más viejos hasta cubrirlo y
 * lo que sobra queda a cuenta; sin monto, cancela lo que la hoja trae tildado (lo vencido y lo de esta
 * semana). Los saldos a favor se usan primero, como vienen tildados en la hoja.
 */
export function pagoPlan(draft: PagoDraft): PlanFailure | DocumentPlan<'payment'> {
  const { party, items } = draft

  // ── Se paga de una cuenta por vez ──
  const debtByAccount = new Map<string, number>()
  for (const item of items) {
    const before = debtByAccount.get(item.accountId) ?? 0
    debtByAccount.set(item.accountId, before + (item.side === 'credit' ? item.openCents : 0))
  }
  const accountsWithDebt = [...debtByAccount.entries()].filter(([, debt]) => debt > 0)
  const accountNameOf = (id: string) => draft.accountNames.get(id) ?? 'Cuenta'
  let accountId: string | null = accountsWithDebt[0]?.[0] ?? [...debtByAccount.keys()][0] ?? null
  if (draft.account !== null && accountsWithDebt.length > 0) {
    const match = matchByName(draft.account, [...debtByAccount.keys()], (id) => [accountNameOf(id)])
    if (match.kind !== 'one') {
      return fail(
        `A ${party.name} se le debe en: ${accountsWithDebt
          .map(([id, debt]) => `${accountNameOf(id)} (${money(debt)})`)
          .join(', ')}. Preguntale de cuál paga.`,
      )
    }
    accountId = match.value
  } else if (draft.account === null && accountsWithDebt.length > 1) {
    return fail(
      `A ${party.name} se le debe en más de una cuenta: ${accountsWithDebt
        .map(([id, debt]) => `${accountNameOf(id)} (${money(debt)})`)
        .join(', ')}. Se paga de una por vez: preguntale cuál y pasala en de_cuenta.`,
    )
  }

  const debts = items
    .filter((i) => i.side === 'credit' && i.accountId === accountId && i.openCents > 0)
    .sort(byDue)
  const credits = items.filter(
    (i) => i.side === 'debit' && i.accountId === accountId && i.openCents > 0,
  )
  const debtTotal = debts.reduce((sum, d) => sum + d.openCents, 0)

  // ── Qué paga ──
  let selected: readonly OpenItemRef[]
  if (draft.lines !== null) {
    const picked = pickLines(draft.lines, debts)
    if (!picked.ok) return picked
    selected = picked.items
  } else if (draft.scope === 'a_cuenta') {
    if (draft.amountCents === null) return fail('Preguntale cuánto le deja a cuenta.')
    selected = []
  } else if (draft.scope === 'lo_vencido') {
    const overdue = new Set(quickSelections(debts, draft.today).overdue.ids)
    selected = debts.filter((d) => overdue.has(d.lineId))
    if (selected.length === 0) {
      return fail(
        `${party.name} no tiene nada vencido; le debés ${money(debtTotal)} sin vencer. Preguntale cuánto paga.`,
      )
    }
  } else if (draft.scope === 'todo' || draft.amountCents !== null) {
    selected = debts
  } else {
    const tildado = new Set(defaultDebtSelection(debts, draft.today))
    selected = debts.filter((d) => tildado.has(d.lineId))
    if (selected.length === 0) {
      return fail(
        debts.length > 0
          ? `A ${party.name} no se le vence nada esta semana; le debés ${money(debtTotal)}. Preguntale cuánto paga o si paga todo.`
          : `No le debés nada a ${party.name}. Si le querés dejar plata a cuenta, preguntale cuánto.`,
      )
    }
  }

  // ── La cuenta del pago: la misma de la hoja ──
  const planDebts: PlanDebt[] = selected.map((d) => ({
    lineId: d.lineId,
    label: d.label,
    accountId: d.accountId,
    openCents: d.openCents,
    targetCents: d.openCents,
    dueDate: d.dueDate,
    entryDate: d.entryDate,
  }))
  const planCredits: PlanCredit[] = credits.map((c) => ({
    lineId: c.lineId,
    label: c.label,
    accountId: c.accountId,
    openCents: c.openCents,
    entryDate: c.entryDate,
  }))
  const plan = planPayment({
    debts: planDebts,
    credits: planCredits,
    amountCents: draft.amountCents,
    writeOff: draft.writeOff,
  })
  if (draft.writeOff && plan.restCents > 0 && plan.writeOffCents === 0) {
    return fail(
      `Solo se puede dar por cancelada una diferencia de hasta $ 1.000, y acá quedan ${money(plan.restCents)} de lo elegido. Si es la diferencia de un comprobante, pasalo en comprobantes.`,
    )
  }
  if (plan.amountCents <= 0 && plan.writeOffCents <= 0) {
    return fail(
      plan.creditAvailableCents > 0 && plan.debtCents > 0
        ? `Lo que tenés a favor con ${party.name} ya cubre eso: no hace falta pagar. Se aplica desde la hoja «Pago»: llevala con ir_a a la ficha del proveedor.`
        : 'Preguntale cuánto paga.',
    )
  }
  const resolved = resolveMethods(
    [
      {
        key: 'm1',
        treasuryId: draft.treasury.id,
        amountCents: null,
        reference: draft.reference ?? '',
      },
    ],
    plan.amountCents,
  )

  // ── El tique ──
  const labelOf = new Map(debts.map((d) => [d.lineId, d.label]))
  const paid = payTicketRows(plan.applications, (id) => labelOf.get(id))
  const outcome = paymentOutcome({ plan, debtTotalCents: debtTotal })
  const bankTax = paymentBankTax(resolved.methods, draft.taxes)
  const budget = weekBudgetNote(draft.week)
  const itemText = (label: string) => pendingItemText(label, [party.legalName, party.tradeName])
  return {
    ok: true,
    form: 'payment',
    values: {
      partyId: party.id,
      date: draft.date,
      applications: plan.applications,
      creditsUsed: plan.creditsUsed,
      methods: resolved.methods,
      writeOffCents: plan.writeOffCents,
      notes: draft.notes,
      recurringExpenseId: draft.recurring?.id ?? null,
    },
    ticket: {
      kind: 'pago',
      title: 'Pago',
      subtitle: party.name,
      rows: rows([
        ...paid.rows.map((r) => row(itemText(r.label), money(r.cents))),
        paid.more > 0 && row(`Y ${paid.more} más`, money(paid.moreCents)),
        plan.creditUsedCents > 0 && row('Usa lo que tenés a favor', money(plan.creditUsedCents)),
        plan.writeOffCents > 0 && row('Da por cancelado', money(plan.writeOffCents)),
        draft.recurring && row('Gasto fijo', draft.recurring.name),
        draft.date !== draft.today && dayRow('Fecha', draft.date),
        draft.reference && row('Referencia', draft.reference),
        draft.notes && row('Nota', draft.notes),
        row('Cómo queda', outcome.sentence),
        ...outcome.details.map((d) => row('También', d)),
        bankTax && row('Se suma', bankTaxNote(bankTax)),
        budget && row('Plan de la semana', budget),
      ]),
      total: row(ticketTotalLabel(draft.treasury), money(plan.amountCents)),
      confirmLabel: 'Pagar',
    },
  }
}

// ─── El proveedor: alta o edición ────────────────────────────────────────────

export type ProveedorChanges = {
  name: string | null
  tradeName: string | null
  cuit: string | null
  condition: IvaCondition | null
  termDays: number | null
  account: { id: string; name: string } | null
  voucherType: VoucherType | null
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  active: boolean | null
}

/** Lo que hace falta de su ficha para editarlo. */
export type ProveedorExisting = {
  id: string
  updatedAt: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  defaultAccountName: string | null
  defaultVoucherType: string | null
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  active: boolean
}

export type ProveedorPlan = {
  ok: true
  /** Lo que recibe `saveParty`: en una edición, solo lo que cambia (lo demás no se toca). */
  values: Record<string, unknown>
  ticket: TexTicketDraft
}

const CONDITION_WORDS: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'No se sabe',
}

function termWords(days: number): string {
  return days > 0 ? `A ${days} días` : 'Sin plazo'
}

function fromTo(before: string | null | undefined, after: string): string {
  return before && before !== after ? `${before} → ${after}` : after
}

/** Lo mismo que mandan «Editar datos» y «Crear proveedor». Lo valida el esquema de `saveParty`. */
export function proveedorPlan(input: {
  kind: 'supplier' | 'customer'
  existing: ProveedorExisting | null
  changes: ProveedorChanges
}): PlanFailure | ProveedorPlan {
  const { existing, changes, kind } = input
  const noun = kind === 'customer' ? 'cliente' : 'proveedor'
  if (!existing && !changes.name) return fail(`Preguntale el nombre del ${noun} nuevo.`)

  const values: Record<string, unknown> = existing
    ? {
        id: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        kind: existing.kind,
        name: changes.name ?? existing.name,
      }
    : {
        kind,
        name: changes.name,
        ivaCondition:
          changes.condition ?? (kind === 'customer' ? 'consumidor_final' : 'responsable_inscripto'),
        taxIdType: changes.cuit ? 'cuit' : 'none',
        taxId: changes.cuit,
      }
  if (existing && changes.condition) values.ivaCondition = changes.condition
  if (existing && changes.cuit) {
    values.taxIdType = 'cuit'
    values.taxId = changes.cuit
  }
  if (changes.tradeName !== null) values.tradeName = changes.tradeName
  if (changes.termDays !== null) values.paymentTermDays = changes.termDays
  if (changes.account) values.defaultAccountId = changes.account.id
  if (changes.voucherType) values.defaultVoucherType = changes.voucherType
  if (changes.email !== null) values.email = changes.email
  if (changes.phone !== null) values.phone = changes.phone
  if (changes.address !== null) values.address = changes.address
  if (changes.notes !== null) values.notes = changes.notes
  if (changes.active !== null) values.active = changes.active

  const parsed = partySchema.safeParse(values)
  if (!parsed.success) return fail(zodIssuesText(parsed.error))

  const before = existing
  const list = rows([
    changes.name && before && row('Razón social', fromTo(before.name, changes.name)),
    changes.tradeName !== null &&
      row('Nombre de fantasía', fromTo(before?.tradeName, changes.tradeName)),
    changes.cuit && row('CUIT', fromTo(before?.taxId, parsed.data.taxId ?? changes.cuit)),
    before
      ? changes.condition &&
        row(
          'Cómo factura',
          fromTo(CONDITION_WORDS[before.ivaCondition], CONDITION_WORDS[changes.condition]),
        )
      : row('Cómo factura', CONDITION_WORDS[parsed.data.ivaCondition]),
    changes.termDays !== null &&
      row(
        'Se le paga',
        fromTo(before ? termWords(before.paymentTermDays) : null, termWords(changes.termDays)),
      ),
    changes.account && row('Va a', fromTo(before?.defaultAccountName, changes.account.name)),
    changes.voucherType &&
      row(
        'Papel habitual',
        fromTo(
          isVoucherType(before?.defaultVoucherType)
            ? voucherLabel(before.defaultVoucherType)
            : null,
          voucherLabel(changes.voucherType),
        ),
      ),
    changes.email !== null && row('Email', fromTo(before?.email, changes.email)),
    changes.phone !== null && row('Teléfono', fromTo(before?.phone, changes.phone)),
    changes.address !== null && row('Dirección', fromTo(before?.address, changes.address)),
    changes.notes !== null && row('Observaciones', changes.notes),
    changes.active !== null &&
      row('Estado', changes.active ? 'Activo' : `Dado de baja: no se le puede cargar nada nuevo`),
  ])
  if (before && list.length === 0) {
    return fail(`No dijo qué cambiar de ${before.tradeName ?? before.name}: preguntale.`)
  }
  const shown = String(values.name)
  return {
    ok: true,
    values,
    ticket: {
      kind: before ? 'proveedor_edicion' : 'proveedor_alta',
      title: before
        ? `Cambios en el ${noun}`
        : `${kind === 'customer' ? 'Cliente' : 'Proveedor'} nuevo`,
      subtitle: before?.tradeName ?? shown,
      rows: list,
      total: null,
      entry: [],
      warnings: [],
      confirmLabel: before ? 'Guardar los cambios' : `Crear el ${noun}`,
    },
  }
}

// ─── El plan de la semana ────────────────────────────────────────────────────

export type PlanSemanaPlan = {
  ok: true
  values: { weekStart: string; items: BudgetItem[] }
  ticket: TexTicketDraft
}

/** Lo que manda la planilla al escribir en sus celdas: un presupuesto por proveedor (un cero lo saca). */
export function planSemanaPlan(input: {
  weekStart: string
  items: ReadonlyArray<{ partyId: string; name: string; cents: number }>
  current: ReadonlyArray<Pick<WeekPlanRow, 'partyId' | 'budgetCents'>>
}): PlanFailure | PlanSemanaPlan {
  const seen = new Set<string>()
  for (const item of input.items) {
    if (seen.has(item.partyId)) return fail(`${item.name} está dos veces: dejá un solo monto.`)
    seen.add(item.partyId)
  }
  if (input.items.length === 0) return fail('Preguntale cuánto le paga a cada proveedor.')
  const budgetOf = new Map(input.current.map((r) => [r.partyId, r.budgetCents]))
  const after = new Map(budgetOf)
  for (const item of input.items) after.set(item.partyId, item.cents)
  const total = [...after.values()].reduce((sum, cents) => sum + cents, 0)
  return {
    ok: true,
    values: {
      weekStart: input.weekStart,
      items: input.items.map((i) => ({ partyId: i.partyId, amountCents: i.cents })),
    },
    ticket: {
      kind: 'plan_semana',
      title: 'Plan de la semana',
      subtitle: weekLabel(input.weekStart),
      rows: input.items.map((item) => {
        const before = budgetOf.get(item.partyId) ?? 0
        const now = item.cents > 0 ? money(item.cents) : 'Sin presupuesto'
        return row(
          item.name,
          before > 0 && before !== item.cents ? `${money(before)} → ${now}` : now,
        )
      }),
      total: row('Total de la semana', money(total)),
      entry: [],
      warnings: [],
      confirmLabel: 'Guardar el plan',
    },
  }
}
