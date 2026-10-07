import 'server-only'
import {
  accErrorMessage,
  CLOSE_WARNING_COPY,
  detailVars,
  isAccErrorKey,
} from '@/lib/accounting/errors'
import {
  CLOSE_WARNING_KEYS,
  type CloseWarningKey,
  type MessageDetail,
} from '@/lib/accounting/types'
import { formatDayMonth } from '@/lib/dates/format'
import { formatCents } from '@/lib/money/format'
import { type IvaPosition, parseIvaPosition } from './books'
import {
  asRecord,
  asRecords,
  bool,
  callRpc,
  callRpcRows,
  centsOrNull,
  day,
  dayOrNull,
  instantOrNull,
  intOrNull,
  isRecord,
  isUuid,
  queryError,
  readerClient,
  requireMonth,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Ejercicios, meses y sus cierres (H.15, H.17 «Ejercicio y meses»; §F.13,
 * §F.14). Los meses se leen de `acc_periods`; el checklist, la integridad y la
 * verificación de meses cerrados, de sus RPC.
 */

export type PeriodKind = 'month' | 'fy_adjustments' | 'fy_opening'

export type PeriodRow = {
  id: string
  fiscalYearId: string
  kind: PeriodKind
  /** Primer día del mes (`yyyy-MM-01`). */
  month: string
  startsOn: string
  endsOn: string
  status: 'open' | 'closed'
  closedAt: string | null
  closedByName: string | null
  numberFrom: number | null
  numberTo: number | null
  entriesCount: number | null
  debitTotalCents: number | null
  ivaSettlementDocumentId: string | null
}

export type FiscalYearRow = {
  id: string
  startDate: string
  endDate: string
  status: 'open' | 'closed'
  openingNumberReserved: boolean
  closedAt: string | null
  closedByName: string | null
  /** «Apertura» (si existe), los meses en orden y «Ajustes de cierre». */
  periods: PeriodRow[]
}

export type PeriodEventRow = {
  id: string
  periodId: string | null
  fiscalYearId: string | null
  action: 'closed' | 'reopened' | 'fy_closed' | 'fy_reopened'
  reason: string | null
  actorName: string
  createdAt: string
  /** Números del cierre (`number_from`, `entries_count`…): sin datos personales. */
  payload: Readonly<Record<string, string | number | boolean | null>>
}

export type CloseChecklistSeverity = 'blocker' | 'warning' | 'info'

export type CloseChecklistItem = {
  key: string
  severity: CloseChecklistSeverity
  /** Texto listo para mostrar (de la base, o el de G.4 / C.5.1 para esa clave). */
  label: string
  /** Lo que ubica el aviso (días, cajas, comprobantes). */
  detail: Readonly<Record<string, unknown>>
  amountCents: number | null
  count: number | null
}

/**
 * La liquidación de IVA que va a tomar el cierre (C.5.1 paso 5): la posición
 * del mes más lo que decide el cierre. `applies` = la SAS liquida IVA
 * (responsable inscripta), `mode` = si se liquida al cerrar o a mano, y
 * `willGenerate` = este cierre la genera.
 */
export type CloseChecklistIva = IvaPosition & {
  /** Al cerrar se genera la liquidación (no hay una vigente al día y no da todo cero). */
  willGenerate: boolean
  /** La liquidación vigente que quedó vieja y se reemplaza al cerrar. */
  replacesDocumentId: string | null
}

export type CloseChecklist = {
  month: string
  periodId: string | null
  fiscalYearId: string | null
  /** Primer y último día del mes en los libros (el primero puede ser el inicio de Administración). */
  startsOn: string | null
  endsOn: string | null
  status: 'open' | 'closed'
  /** Sin bloqueos (orden, mes sin terminar, apertura pendiente) y abierto. */
  canClose: boolean
  blockers: CloseChecklistItem[]
  warnings: CloseChecklistItem[]
  info: CloseChecklistItem[]
  /** Claves de los avisos, para `closePeriod` (`warnings_ack`). */
  warningKeys: CloseWarningKey[]
  entriesCount: number | null
  /** Σ Debe = Σ Haber de los asientos vigentes del mes. */
  debitTotalCents: number | null
  creditTotalCents: number | null
  /** «Los asientos de octubre van a quedar del 2 al 241» (`null` si el mes no tiene asientos). */
  numberFrom: number | null
  numberTo: number | null
  /** `true` mientras el mes está abierto: la numeración es la que va a quedar al cerrar. */
  numberingProvisional: boolean
  isLastMonthOfFiscalYear: boolean
  /** La liquidación de IVA del cierre, tipada; `null` si la base no la manda. */
  iva: CloseChecklistIva | null
  /**
   * La posición de IVA tal cual la manda la base. `closePeriod` manda como
   * `expected` lo que vio la persona: la base acepta las 7 cifras de
   * `ivaExpectedJson` (de `iva`) o las `figures` (`{df, cf, perc, ret, st0, ld0}`).
   */
  ivaPosition: Readonly<Record<string, unknown>> | null
  closedAt: string | null
  closedByName: string | null
  /** Lo que la base manda tal cual, para lo que la pantalla quiera mostrar además. */
  raw: Readonly<Record<string, unknown>>
}

export type IntegrityCheckRow = {
  checkKey: string
  ok: boolean
  /** Lo que no cierra (ids y montos); `null` si está bien. */
  detail: Readonly<Record<string, unknown>> | null
}

export type ClosedPeriodCheckRow = {
  periodId: string
  label: string
  ok: boolean
  storedHash: string | null
  currentHash: string | null
}

const PERIOD_COLUMNS =
  'id, fiscal_year_id, kind, month, starts_on, ends_on, status, closed_at, closed_by_name, number_from, number_to, entries_count, debit_total_cents, iva_settlement_document_id'

function periodKind(value: unknown): PeriodKind {
  return value === 'fy_adjustments' || value === 'fy_opening' ? value : 'month'
}

function parsePeriod(row: UnknownRecord): PeriodRow {
  return {
    id: str(row.id),
    fiscalYearId: str(row.fiscal_year_id),
    kind: periodKind(row.kind),
    month: day(row.month),
    startsOn: day(row.starts_on),
    endsOn: day(row.ends_on),
    status: row.status === 'closed' ? 'closed' : 'open',
    closedAt: instantOrNull(row.closed_at),
    closedByName: strOrNull(row.closed_by_name),
    numberFrom: intOrNull(row.number_from),
    numberTo: intOrNull(row.number_to),
    entriesCount: intOrNull(row.entries_count),
    debitTotalCents: centsOrNull(row.debit_total_cents),
    ivaSettlementDocumentId: strOrNull(row.iva_settlement_document_id),
  }
}

const KIND_ORDER: Readonly<Record<PeriodKind, number>> = {
  fy_opening: 0,
  month: 1,
  fy_adjustments: 2,
}

function comparePeriods(a: PeriodRow, b: PeriodRow): number {
  return a.startsOn.localeCompare(b.startsOn) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
}

/** Los ejercicios con sus períodos, el más viejo primero. */
export async function listFiscalYears(tenantId: string): Promise<FiscalYearRow[]> {
  const supabase = await readerClient()
  const [years, periods] = await Promise.all([
    supabase
      .from('acc_fiscal_years')
      .select(
        'id, start_date, end_date, status, opening_number_reserved, closed_at, closed_by_name',
      )
      .eq('tenant_id', tenantId)
      .order('start_date', { ascending: true })
      .limit(100),
    supabase
      .from('acc_periods')
      .select(PERIOD_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('starts_on', { ascending: true })
      .limit(1000),
  ])
  if (years.error) throw queryError('acc_fiscal_years', years.error)
  if (periods.error) throw queryError('acc_periods', periods.error)
  const byYear = new Map<string, PeriodRow[]>()
  for (const raw of (periods.data ?? []) as unknown[]) {
    if (!isRecord(raw)) continue
    const period = parsePeriod(raw)
    const list = byYear.get(period.fiscalYearId) ?? []
    list.push(period)
    byYear.set(period.fiscalYearId, list)
  }
  return ((years.data ?? []) as unknown[]).filter(isRecord).map((row) => {
    const id = str(row.id)
    return {
      id,
      startDate: day(row.start_date),
      endDate: day(row.end_date),
      status: row.status === 'closed' ? 'closed' : 'open',
      openingNumberReserved: bool(row.opening_number_reserved),
      closedAt: instantOrNull(row.closed_at),
      closedByName: strOrNull(row.closed_by_name),
      periods: (byYear.get(id) ?? []).sort(comparePeriods),
    }
  })
}

/** El período mensual de un mes (`yyyy-MM`); `null` si todavía no existe. */
export async function getPeriodByMonth(tenantId: string, month: string): Promise<PeriodRow | null> {
  const first = requireMonth(month)
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_periods')
    .select(PERIOD_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('kind', 'month')
    .eq('month', first)
    .maybeSingle()
  if (error) throw queryError('acc_periods', error)
  return isRecord(data) ? parsePeriod(data) : null
}

const EVENT_ACTIONS: ReadonlySet<string> = new Set([
  'closed',
  'reopened',
  'fy_closed',
  'fy_reopened',
])

function scalarPayload(raw: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(asRecord(raw))) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    }
  }
  return out
}

/** Historia de cierres y reaperturas (quién, cuándo, por qué), la más reciente primero. */
export async function listPeriodEvents(
  tenantId: string,
  opts: { periodId?: string | null; fiscalYearId?: string | null; limit?: number } = {},
): Promise<PeriodEventRow[]> {
  const supabase = await readerClient()
  let query = supabase
    .from('acc_period_events')
    .select('id, period_id, fiscal_year_id, action, reason, actor_name, payload, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 100))))
  if (opts.periodId && isUuid(opts.periodId)) query = query.eq('period_id', opts.periodId)
  if (opts.fiscalYearId && isUuid(opts.fiscalYearId)) {
    query = query.eq('fiscal_year_id', opts.fiscalYearId)
  }
  const { data, error } = await query
  if (error) throw queryError('acc_period_events', error)
  return ((data ?? []) as unknown[]).filter(isRecord).flatMap((row) => {
    const action = str(row.action)
    if (!EVENT_ACTIONS.has(action)) return []
    return [
      {
        id: str(row.id),
        periodId: strOrNull(row.period_id),
        fiscalYearId: strOrNull(row.fiscal_year_id),
        action: action as PeriodEventRow['action'],
        reason: strOrNull(row.reason),
        actorName: str(row.actor_name),
        createdAt: str(row.created_at),
        payload: scalarPayload(row.payload),
      },
    ]
  })
}

// ─── Checklist del cierre (F.13) ─────────────────────────────────────────────

function isCloseWarningKey(value: string): value is CloseWarningKey {
  return (CLOSE_WARNING_KEYS as readonly string[]).includes(value)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** `['03/10', '04/10', '11/10']` → «03/10, 04/10 y 11/10». */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

/** Los nombres de una lista de la base (`[{name, …}]`), sin vacíos. */
function namesOf(value: unknown): string[] {
  return asRecords(value)
    .map((row) => str(row.name).trim())
    .filter((name) => name !== '')
}

/**
 * El texto de un aviso con sus números (cuántos, cuánto, cuáles), armado con
 * lo que manda `acc_report_close_checklist`. Sin datos, el texto general.
 */
function warningLabel(key: CloseWarningKey, rec: UnknownRecord): string {
  const count = intOrNull(rec.count)
  const amount = centsOrNull(rec.amount_cents)
  switch (key) {
    case 'missing_daily_closes': {
      const days = (Array.isArray(rec.dates) ? rec.dates : [])
        .map((d) => (typeof d === 'string' ? formatDayMonth(d) : ''))
        .filter((d) => d !== '')
      const n = count ?? days.length
      if (n <= 0) break
      if (n === 1 && days[0]) return `Falta el cierre del día del ${days[0]}.`
      if (days.length === n && n <= 4) return `Faltan los cierres del día del ${joinList(days)}.`
      return days[0]
        ? `Faltan ${n} cierres del día (el primero, del ${days[0]}).`
        : `Faltan ${n} cierres del día.`
    }
    case 'receivables_overdue':
      if (count !== null && count > 0 && amount !== null) {
        return `Hay ${plural(count, 'acreditación atrasada', 'acreditaciones atrasadas')} de tarjetas, billeteras o plataformas por ${formatCents(amount)}.`
      }
      break
    case 'treasury_negative': {
      const list = asRecords(rec.treasuries)
      const names = namesOf(rec.treasuries)
      const balance = list.length === 1 ? centsOrNull(list[0]?.balance_cents) : null
      if (names.length === 1 && balance !== null) {
        return `${names[0]} quedó en ${formatCents(balance)} al último día del mes.`
      }
      if (names.length === 1) return `${names[0]} quedó en negativo al último día del mes.`
      if (names.length > 1) {
        return `${joinList(names)} quedaron en negativo al último día del mes.`
      }
      break
    }
    case 'treasuries_not_reconciled': {
      const names = namesOf(rec.treasuries)
      if (names.length > 0) return `Sin «Ajustar saldo» en el mes: ${joinList(names)}.`
      break
    }
    case 'vat_pending_documentation':
      if (amount !== null && amount !== 0) {
        return `Hay ${formatCents(Math.abs(amount))} de IVA de comisiones a documentar con más de 45 días: falta la factura.`
      }
      break
    case 'recurring_not_loaded': {
      const names = namesOf(rec.items)
      if (names.length > 0 && names.length <= 4) {
        return `Gastos fijos del mes sin cargar: ${joinList(names)}.`
      }
      if (names.length > 4) return `Hay ${names.length} gastos fijos del mes sin cargar.`
      break
    }
    case 'tickets_without_vendor':
      if (count !== null && count > 0) {
        const money = amount !== null && amount !== 0 ? ` (${formatCents(amount)})` : ''
        return `Hay ${plural(count, 'tique', 'tiques')} sin comercio${money}: no entran al Libro IVA.`
      }
      break
    case 'sas_cuit_missing':
      break
  }
  return CLOSE_WARNING_COPY[key]
}

/** Información del cierre (no frena nada). `null` = una clave que esta versión no conoce: no se muestra. */
function infoLabel(key: string, rec: UnknownRecord): string | null {
  switch (key) {
    case 'opening_equity_unassigned':
    case 'opening_unassigned': {
      const amount = centsOrNull(rec.amount_cents)
      return amount !== null && amount !== 0
        ? `Hay ${formatCents(Math.abs(amount))} de patrimonio inicial sin asignar: lo revisa la contadora.`
        : 'Hay patrimonio inicial sin asignar: lo revisa la contadora.'
    }
    case 'last_month_of_fiscal_year':
    case 'fiscal_year_last_month':
      return 'Es el último mes del ejercicio: después vas a poder cargar los ajustes de cierre.'
    default:
      return null
  }
}

/** Un bloqueo (orden, mes sin terminar, apertura pendiente), con el texto de G.4. */
function blockerLabel(key: string, rec: UnknownRecord): string {
  if (isAccErrorKey(key)) {
    return accErrorMessage(key, detailVars(scalarPayload(rec) as MessageDetail))
  }
  return 'Este mes todavía no se puede cerrar.'
}

function parseItem(raw: unknown, severity: CloseChecklistSeverity): CloseChecklistItem | null {
  const rec: UnknownRecord = typeof raw === 'string' ? { key: raw } : asRecord(raw)
  const key = str(rec.key ?? rec.code ?? rec.warning)
  if (!key) return null
  const detail: UnknownRecord = { ...asRecord(rec.detail), ...rec }
  delete detail.label
  delete detail.message
  const given = strOrNull(rec.label ?? rec.message)
  let label: string | null = given
  if (label === null) {
    if (severity === 'blocker') label = blockerLabel(key, detail)
    else if (severity === 'info') label = infoLabel(key, detail)
    else label = isCloseWarningKey(key) ? warningLabel(key, detail) : null
  }
  if (label === null) {
    // Un aviso que esta versión no conoce igual se muestra (frena el cierre en la base).
    if (severity !== 'warning') return null
    label = 'Hay algo para revisar antes de cerrar.'
  }
  return {
    key,
    severity,
    label,
    detail,
    amountCents: centsOrNull(detail.amount_cents),
    count: intOrNull(detail.count),
  }
}

function severityOf(value: unknown): CloseChecklistSeverity {
  return value === 'blocker' || value === 'block' || value === 'error'
    ? 'blocker'
    : value === 'info'
      ? 'info'
      : 'warning'
}

function parseCloseIva(
  raw: UnknownRecord,
  month: string,
  status: 'open' | 'closed',
  closedAt: string | null,
): CloseChecklistIva {
  return {
    ...parseIvaPosition(raw, month),
    status,
    closedAt,
    willGenerate: bool(raw.will_generate),
    replacesDocumentId: strOrNull(raw.replaces_document_id),
  }
}

/**
 * El JSON de `acc_report_close_checklist` → `CloseChecklist`:
 * `{month, period_id, fiscal_year_id, status, starts_on, ends_on, can_close,
 * blockers, warnings, info, entries_count, debit_total_cents,
 * credit_total_cents, number_from, number_to, numbers_provisional,
 * is_last_month_of_fiscal_year, iva_position, closed_at, closed_by_name}`.
 * También acepta la forma anidada de un borrador anterior (`blocks`,
 * `entries: {count, …}`, `numbering: {from, to, provisional}`, `iva`) y una
 * sola lista `items` con `severity`.
 */
export function parseCloseChecklist(raw: unknown, month: string): CloseChecklist {
  const data = asRecord(raw)
  const blockers: CloseChecklistItem[] = []
  const warnings: CloseChecklistItem[] = []
  const info: CloseChecklistItem[] = []
  const push = (item: CloseChecklistItem | null) => {
    if (!item) return
    if (item.severity === 'blocker') blockers.push(item)
    else if (item.severity === 'info') info.push(item)
    else warnings.push(item)
  }
  for (const item of asRecords(data.items)) {
    push(parseItem(item, severityOf(item.severity ?? item.level)))
  }
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
  for (const item of list(data.blocks)) push(parseItem(item, 'blocker'))
  for (const item of list(data.blockers)) push(parseItem(item, 'blocker'))
  for (const item of list(data.warnings)) push(parseItem(item, 'warning'))
  for (const item of list(data.info)) push(parseItem(item, 'info'))

  const first = dayOrNull(data.month) ?? month
  const status = data.status === 'closed' ? 'closed' : 'open'
  const closedAt = instantOrNull(data.closed_at)
  const entries = asRecord(data.entries)
  const numbering = asRecord(data.numbering)
  const ivaRaw = isRecord(data.iva)
    ? data.iva
    : isRecord(data.iva_position)
      ? data.iva_position
      : null
  const debitTotalCents = centsOrNull(entries.debit_total_cents ?? data.debit_total_cents)
  const lastMonthKeys = new Set(['last_month_of_fiscal_year', 'fiscal_year_last_month'])
  const provisionalFlag = numbering.provisional ?? data.numbers_provisional
  return {
    month: first,
    periodId: strOrNull(data.period_id),
    fiscalYearId: strOrNull(data.fiscal_year_id),
    startsOn: dayOrNull(data.starts_on),
    endsOn: dayOrNull(data.ends_on),
    status,
    canClose:
      data.can_close === undefined
        ? status === 'open' && blockers.length === 0
        : bool(data.can_close) && status === 'open',
    blockers,
    warnings,
    info,
    warningKeys: [...new Set(warnings.map((w) => w.key).filter(isCloseWarningKey))],
    entriesCount: intOrNull(entries.count ?? data.entries_count),
    debitTotalCents,
    // Cada asiento cuadra: el Haber total es el mismo que el Debe.
    creditTotalCents:
      centsOrNull(entries.credit_total_cents ?? data.credit_total_cents) ?? debitTotalCents,
    numberFrom: intOrNull(numbering.from ?? data.number_from),
    numberTo: intOrNull(numbering.to ?? data.number_to),
    numberingProvisional:
      provisionalFlag === undefined || provisionalFlag === null
        ? status === 'open'
        : bool(provisionalFlag),
    isLastMonthOfFiscalYear:
      info.some((i) => lastMonthKeys.has(i.key)) ||
      bool(data.is_last_month_of_fiscal_year ?? data.last_month_of_fiscal_year),
    iva: ivaRaw ? parseCloseIva(ivaRaw, first, status, closedAt) : null,
    ivaPosition: ivaRaw,
    closedAt,
    closedByName: strOrNull(data.closed_by_name),
    raw: data,
  }
}

/** Lo que hay que revisar antes de cerrar un mes (F.13): bloqueos, avisos, números e IVA. */
export async function getCloseChecklist(tenantId: string, month: string): Promise<CloseChecklist> {
  const first = requireMonth(month)
  const data = await callRpc('acc_report_close_checklist', {
    p_tenant_id: tenantId,
    p_month: first,
  })
  return parseCloseChecklist(data, first)
}

// ─── Integridad y verificación (F.14) ────────────────────────────────────────

/** Los invariantes de A.6 (Ajustes › Integridad): «Todo en orden» o lo que no cierra. */
export async function getIntegrity(tenantId: string): Promise<IntegrityCheckRow[]> {
  const raw = await callRpcRows('acc_report_integrity', { p_tenant_id: tenantId })
  return raw.map((row) => {
    const ok = bool(row.ok)
    const detail = row.detail
    return {
      checkKey: str(row.check_key),
      ok,
      detail: ok || detail === null || detail === undefined ? null : asRecord(detail),
    }
  })
}

/** Recalcula el hash de cada mes cerrado: si algo cambió por fuera, `ok: false`. */
export async function verifyClosedPeriods(tenantId: string): Promise<ClosedPeriodCheckRow[]> {
  const raw = await callRpcRows('acc_report_verify_closed_periods', { p_tenant_id: tenantId })
  return raw.map((row) => ({
    periodId: str(row.period_id),
    label: str(row.label),
    ok: bool(row.ok),
    storedHash: strOrNull(row.stored_hash),
    currentHash: strOrNull(row.current_hash),
  }))
}
