import 'server-only'
import {
  POS_METHOD_SYSTEM_KEY,
  type PosCommissionRates,
  type PosPayMethod,
  type PosSalesOfDay,
  type ProjectionSourceDay,
  type TargetOfDay,
  withPosSales,
} from '@/lib/accounting/projection'
import { TREASURY_KINDS, type TreasuryKind } from '@/lib/accounting/types'
import { eventTitle } from '@/lib/salon/events-report'
import {
  asRecord,
  asRecords,
  bool,
  callRpcRows,
  cents,
  centsOrNull,
  dayOrNull,
  int,
  intOrNull,
  isRecord,
  queryError,
  readerClient,
  requireRange,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Lecturas de Ventas › Proyección y «Ventas contra caja» (12/10/2026): el
 * reporte por día (`acc_report_sales_projection`), lo que entró en cada caja y
 * los eventos del calendario del bar. Las cuentas se hacen en
 * `lib/accounting/projection.ts`.
 */

export function parseProjectionRow(row: UnknownRecord): ProjectionSourceDay | null {
  const day = dayOrNull(row.day)
  if (!day) return null
  return {
    day,
    targetCents: centsOrNull(row.target_cents),
    note: strOrNull(row.note),
    closes: int(row.closes),
    salonCents: cents(row.salon_cents),
    deliveryCents: cents(row.delivery_cents),
    eventsCents: cents(row.events_cents),
    salonCommissionCents: cents(row.salon_commission_cents),
    deliveryCommissionCents: cents(row.delivery_commission_cents),
    eventsCommissionCents: cents(row.events_commission_cents),
    cashCountedCents: centsOrNull(row.cash_counted_cents),
  }
}

export type SalesProjectionOptions = {
  /**
   * El bar tiene el punto de venta prendido y quien mira es dueño: los días sin cierre toman lo que
   * cobró (`withPosSales`). Lo decide quien llama, con el acceso que ya resolvió la página; la base lo
   * vuelve a decidir en `pos_sales_days`. Sin esto, la proyección sale solo de los cierres, como siempre.
   */
  pos?: boolean
}

/** Una fila por día del rango (también los días sin nada), del más viejo al más nuevo. */
export async function getSalesProjection(
  tenantId: string,
  range: { from: string; to: string },
  options: SalesProjectionOptions = {},
): Promise<ProjectionSourceDay[]> {
  const { from, to } = requireRange(range.from, range.to)
  const [raw, pos] = await Promise.all([
    callRpcRows('acc_report_sales_projection', {
      p_tenant_id: tenantId,
      p_from: from,
      p_to: to,
    }),
    options.pos ? getPosSales(tenantId, { from, to }) : null,
  ])
  const rows = raw.map(parseProjectionRow).filter((row): row is ProjectionSourceDay => row !== null)
  return pos ? withPosSales(rows, pos.days, pos.rates) : rows
}

// ─── Las ventas del punto de venta ───────────────────────────────────────────

const POS_METHODS = Object.keys(POS_METHOD_SYSTEM_KEY) as PosPayMethod[]

/** Un día de `pos_sales_days` → lo que necesita la proyección. `null` si no trae el día. */
export function parsePosSalesDay(row: UnknownRecord): PosSalesOfDay | null {
  const day = dayOrNull(row.day)
  if (!day) return null
  const raw = asRecord(row.by_method)
  const byMethod: PosSalesOfDay['byMethod'] = {}
  for (const method of POS_METHODS) {
    const value = centsOrNull(raw[method])
    if (value !== null && value > 0) byMethod[method] = value
  }
  return { day, byMethod, depositCents: Math.max(0, cents(row.deposit_cents)) }
}

/**
 * La comisión de cada medio del punto de venta: la del partícipe del medio de Administración que le
 * corresponde (`POS_METHOD_SYSTEM_KEY`). Un medio sin par, o sin porcentaje cargado, no figura.
 */
export function posCommissionRates(
  methods: readonly UnknownRecord[],
  parties: readonly UnknownRecord[],
): PosCommissionRates {
  const bpOfParty = new Map<string, number>()
  for (const party of parties) {
    const id = strOrNull(party.id)
    const bp = intOrNull(party.commission_bp)
    if (id && bp !== null && bp > 0) bpOfParty.set(id, bp)
  }
  const partyOfKey = new Map<string, string>()
  for (const method of methods) {
    const key = strOrNull(method.system_key)
    const partyId = strOrNull(method.party_id)
    if (key && partyId) partyOfKey.set(key, partyId)
  }
  const rates: PosCommissionRates = {}
  for (const method of POS_METHODS) {
    const key = POS_METHOD_SYSTEM_KEY[method]
    const partyId = key ? partyOfKey.get(key) : undefined
    const bp = partyId ? bpOfParty.get(partyId) : undefined
    if (bp !== undefined) rates[method] = bp
  }
  return rates
}

/**
 * Lo que cobró el punto de venta en el rango y las comisiones de Ajustes para estimar su neto.
 *
 * `null` si no se pudo leer: la proyección sale de los cierres, como siempre, y queda anotado (sin
 * datos de nadie: la función y el código). Es un agregado a una pantalla que ya funciona; que falle
 * no puede tirarla. Si lo que falla son las comisiones, las ventas se muestran igual, enteras.
 */
async function getPosSales(
  tenantId: string,
  range: { from: string; to: string },
): Promise<{ days: PosSalesOfDay[]; rates: PosCommissionRates } | null> {
  const supabase = await readerClient()
  const keys = POS_METHODS.map((m) => POS_METHOD_SYSTEM_KEY[m]).filter(
    (k): k is string => k !== null,
  )
  const [sales, methods] = await Promise.all([
    supabase.rpc('pos_sales_days', { p_tenant_id: tenantId, p_from: range.from, p_to: range.to }),
    supabase
      .from('acc_sales_methods')
      .select('system_key, party_id')
      .eq('tenant_id', tenantId)
      .in('system_key', keys)
      .limit(20),
  ])
  if (sales.error) {
    console.error('[acc.projection.pos] pos_sales_days', sales.error.code ?? 'sin-codigo')
    return null
  }
  const days = asRecords(asRecord(sales.data).days)
    .map(parsePosSalesDay)
    .filter((day): day is PosSalesOfDay => day !== null)
  if (days.length === 0) return { days, rates: {} }

  if (methods.error) {
    console.error('[acc.projection.pos] acc_sales_methods', methods.error.code ?? 'sin-codigo')
    return { days, rates: {} }
  }
  const methodRows = ((methods.data ?? []) as unknown[]).filter(isRecord)
  const partyIds = [
    ...new Set(methodRows.map((m) => strOrNull(m.party_id)).filter((id): id is string => !!id)),
  ]
  if (partyIds.length === 0) return { days, rates: {} }
  const parties = await supabase
    .from('acc_parties')
    .select('id, commission_bp')
    .eq('tenant_id', tenantId)
    .in('id', partyIds)
    .limit(20)
  if (parties.error) {
    console.error('[acc.projection.pos] acc_parties', parties.error.code ?? 'sin-codigo')
    return { days, rates: {} }
  }
  const partyRows = ((parties.data ?? []) as unknown[]).filter(isRecord)
  return { days, rates: posCommissionRates(methodRows, partyRows) }
}

/**
 * Solo los objetivos de un rango, sin el reporte: lo que necesita «Copiar el mes pasado». Vienen los días que
 * tienen objetivo (una fila puede guardar solo la nota: esa no).
 */
export async function listSalesTargets(
  tenantId: string,
  range: { from: string; to: string },
): Promise<TargetOfDay[]> {
  const { from, to } = requireRange(range.from, range.to)
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_sales_targets')
    .select('day, target_cents')
    .eq('tenant_id', tenantId)
    .gte('day', from)
    .lte('day', to)
    .not('target_cents', 'is', null)
    .order('day', { ascending: true })
    .limit(100)
  if (error) throw queryError('acc_sales_targets', error)
  const out: TargetOfDay[] = []
  for (const row of ((data ?? []) as unknown[]).filter(isRecord)) {
    const day = dayOrNull(row.day)
    if (day) out.push({ day, targetCents: centsOrNull(row.target_cents) })
  }
  return out
}

// ─── Lo que entró en cada caja ───────────────────────────────────────────────

export type CashCountTreasury = {
  id: string
  name: string
  kind: TreasuryKind
  active: boolean
}

/** Por día, lo cargado en cada caja: `{ '2026-10-05': { '<caja>': 6000000 } }`. */
export type DailyCashCounts = Record<string, Record<string, number>>

function treasuryKind(value: unknown): TreasuryKind {
  return typeof value === 'string' && (TREASURY_KINDS as readonly string[]).includes(value)
    ? (value as TreasuryKind)
    : 'other'
}

/**
 * Las cajas donde puede entrar plata (todas menos la tarjeta de la empresa),
 * en el orden de Ajustes. Vienen también las desactivadas: un día viejo puede
 * tener algo cargado en una que ya no se usa.
 */
export async function listCashCountTreasuries(tenantId: string): Promise<CashCountTreasury[]> {
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_treasury_accounts')
    .select('id, name, kind, active, sort')
    .eq('tenant_id', tenantId)
    .neq('kind', 'credit_card')
    .order('sort', { ascending: true })
    .order('name', { ascending: true })
    .limit(200)
  if (error) throw queryError('acc_treasury_accounts', error)
  return ((data ?? []) as unknown[]).filter(isRecord).map((row) => ({
    id: str(row.id),
    name: str(row.name),
    kind: treasuryKind(row.kind),
    active: bool(row.active),
  }))
}

/** Lo que entró cada día del rango, caja por caja (para abrir el diálogo con lo ya cargado). */
export async function listDailyCashCounts(
  tenantId: string,
  range: { from: string; to: string },
): Promise<DailyCashCounts> {
  const { from, to } = requireRange(range.from, range.to)
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_daily_cash_counts')
    .select('day, treasury_account_id, amount_cents')
    .eq('tenant_id', tenantId)
    .gte('day', from)
    .lte('day', to)
    .limit(5000)
  if (error) throw queryError('acc_daily_cash_counts', error)
  const out: DailyCashCounts = {}
  for (const row of ((data ?? []) as unknown[]).filter(isRecord)) {
    const day = dayOrNull(row.day)
    const treasuryId = strOrNull(row.treasury_account_id)
    const amount = centsOrNull(row.amount_cents)
    if (!day || !treasuryId || amount === null) continue
    const byTreasury = out[day] ?? {}
    byTreasury[treasuryId] = amount
    out[day] = byTreasury
  }
  return out
}

// ─── Eventos del calendario del bar ──────────────────────────────────────────

/** Los nombres de los eventos de cada día: `{ '2026-10-17': ['Noche de tacos'] }`. */
export type DayEvents = Record<string, string[]>

/**
 * Los eventos programados en el calendario del bar, por día (la columna
 * «Evento» de la planilla). Solo lectura y solo el nombre: un grupo privado no
 * es un evento para mostrar. La contadora no lee el calendario (está aislada de
 * todo lo que no es Administración): para ella vuelve vacío.
 */
export async function listDayEvents(
  tenantId: string,
  range: { from: string; to: string },
): Promise<DayEvents> {
  const { from, to } = requireRange(range.from, range.to)
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('scheduled_events')
    .select('event_date, name_override, private_group, template:scheduled_event_templates(name)')
    .eq('tenant_id', tenantId)
    .gte('event_date', from)
    .lte('event_date', to)
    .order('event_date', { ascending: true })
    .order('starts_at_local', { ascending: true })
    .limit(1000)
  if (error) throw queryError('scheduled_events', error)
  const out: DayEvents = {}
  for (const row of ((data ?? []) as unknown[]).filter(isRecord)) {
    const day = dayOrNull(row.event_date)
    if (!day || row.private_group === true) continue
    const tpl = Array.isArray(row.template) ? row.template[0] : row.template
    const title = eventTitle({
      name_override: strOrNull(row.name_override),
      template: isRecord(tpl) ? { name: strOrNull(tpl.name) } : null,
    })
    const names = out[day] ?? []
    if (!names.includes(title)) names.push(title)
    out[day] = names
  }
  return out
}
