import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { cordobaDayStartUtc, isoDayInCordoba, nextIsoDay } from './date-presets'
import { type RangeTotals, type RangeTotalsRow, tallyRangeTotals } from './day-counter'
import {
  aggregateDepositsByDay,
  type DepositBasis,
  type DepositSourceRow,
  type DepositsReport,
} from './deposits'
import {
  buildMonthMarketingReport,
  type EventMarketingRow,
  type MonthMarketingReport,
} from './event-marketing'
import {
  EVENT_MARKETING_DB_SELECT,
  type EventMarketingDbRow,
  toEventMarketingRow,
} from './event-marketing-schemas'
import {
  aggregateDayReport,
  aggregateEditions,
  aggregateTemplateReport,
  type DayReport,
  type ReportEventRow,
  type ReportReservationRow,
  type TemplateReport,
} from './events-report'
import {
  type PartySizeBucket,
  type PartySizeCountable,
  partySizePostgrestFilter,
} from './party-size'
import { computePeakWindow, type PeakWindow } from './peak'
import type { ServiceRow } from './services'
import type {
  CakeOptionRow,
  CommissionBonusRuleRow,
  CommissionLedgerRow,
  CommissionRateTierRow,
  DayCapacityBucket,
  MealType,
  ReservationManagerRow,
  ReservationWithJoins,
  SalonReservationStatus,
  SalonZone,
  SalonZoneCapacityOverrideRow,
  ScheduledEventRow,
  ScheduledEventTemplateRow,
} from './types'

// Hasta que `npm run db:types` regenere los tipos, casteamos la API
// de Supabase a `any` puntualmente. Los rows recibidos los tipamos
// duro con `as Type`.
// biome-ignore lint/suspicious/noExplicitAny: <generated types pending>
type SBAny = any

const RESERVATION_JOIN_SELECT = `
  *,
  primary_manager:reservation_managers!salon_reservations_primary_manager_id_fkey(id, display_name),
  assistant_manager:reservation_managers!salon_reservations_assistant_manager_id_fkey(id, display_name),
  scheduled_event:scheduled_events(
    id, capacity, starts_at_local, meal_type,
    template:scheduled_event_templates(id, name, slug, color_hex, consume_special_reservations)
  ),
  customer:customers(id, first_name, last_name, phone, service_alerts, points_balance, tier:loyalty_tiers!customers_current_tier_id_fkey(name, color)),
  cake_option:cake_options(id, name, base, fillings)
`

function normalizeJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

type ScheduledEventJoin = NonNullable<ReservationWithJoins['scheduled_event']>
type TemplateJoin = ScheduledEventJoin['template']
type CustomerJoin = NonNullable<ReservationWithJoins['customer']>

function flattenReservation(row: Record<string, unknown>): ReservationWithJoins {
  const base = { ...row } as ReservationWithJoins
  base.primary_manager = normalizeJoin(
    row.primary_manager as ReservationWithJoins['primary_manager'],
  )
  base.assistant_manager = normalizeJoin(
    row.assistant_manager as ReservationWithJoins['assistant_manager'],
  )
  const se = normalizeJoin(
    row.scheduled_event as
      | (ScheduledEventJoin & { template?: TemplateJoin | TemplateJoin[] })
      | null,
  )
  if (se) {
    const template = normalizeJoin(
      (se as { template?: TemplateJoin | TemplateJoin[] }).template as
        | TemplateJoin
        | TemplateJoin[]
        | null,
    )
    base.scheduled_event = {
      ...(se as object),
      template,
    } as ReservationWithJoins['scheduled_event']
  } else {
    base.scheduled_event = null
  }
  // El nivel del socio viene como embed anidado y PostgREST puede devolverlo
  // como array: se aplana igual que el template del evento.
  const customer = normalizeJoin(
    row.customer as
      | (Omit<CustomerJoin, 'tier'> & { tier?: CustomerJoin['tier'] | CustomerJoin['tier'][] })
      | null,
  )
  base.customer = customer
    ? ({
        ...customer,
        points_balance: customer.points_balance ?? 0,
        tier: normalizeJoin(customer.tier as CustomerJoin['tier'] | CustomerJoin['tier'][] | null),
      } as CustomerJoin)
    : null
  base.cake_option = normalizeJoin(row.cake_option as ReservationWithJoins['cake_option'])
  return base
}

// ──────────────────────────────────────────────────────────
// Reservas
// ──────────────────────────────────────────────────────────

export type ReservationFilters = {
  tenantId: string
  dateFrom?: string // YYYY-MM-DD inclusive
  dateTo?: string
  zone?: ReservationWithJoins['zone']
  /** Un solo servicio: desayuno, almuerzo, merienda o cena. */
  mealType?: MealType
  /** Solo cumpleaños / solo especiales — el filtro de "lo que no es una mesa más". */
  kind?: ReservationWithJoins['kind']
  /**
   * Un tamaño de mesa: 1, 2, 3, 4, 5, 6 o 7 y más personas
   * (`coalesce(actual_guests, estimated_guests)`). Ver `partySize` en
   * `applyReservationFilters`.
   */
  partySize?: PartySizeBucket
  status?: SalonReservationStatus | SalonReservationStatus[]
  /**
   * Estados que NO entran en el listado. La agenda saca las `cancelled`: una
   * reserva cancelada al lado de las activas se termina armando igual, que es
   * justo el error que el dueño quiere evitar.
   *
   * Va en la QUERY y no en el cliente porque el listado pagina server-side: si
   * se filtrara después de traer la página, una de 25 con 5 canceladas mostraría
   * 20 filas, el total diría 25 y las páginas quedarían desparejas.
   */
  excludeStatus?: SalonReservationStatus[]
  managerId?: string
  /** Solo las reservas colgadas de este evento programado. */
  scheduledEventId?: string
  q?: string // busca en guest_name
  page?: number
  pageSize?: number
  /**
   * Orden por fecha. 'desc' (default) sirve al modo día / histórico; en un
   * rango a futuro ("esta semana", "este mes") lo que se quiere leer es la
   * agenda en el orden en que va a pasar, así que ahí va 'asc'.
   */
  sort?: 'asc' | 'desc'
}

/**
 * La página pedida quedó fuera de rango: hay menos filas que el offset.
 *
 * Pasa de verdad y por el camino más común: el listado saca las canceladas, el
 * dueño está parado en `?page=2` y cancela una reserva desde el popup. La action
 * revalida sin tocar la URL, el listado vuelve con menos filas y PostgREST
 * responde 416 (PGRST103). Sin este tipo, ese error subía como excepción y —como
 * no hay `error.tsx` en el workspace del manager— se caía la pantalla entera
 * justo por hacer lo que la feature vino a resolver.
 */
export class PageOutOfRangeError extends Error {
  constructor() {
    super('page_out_of_range')
    this.name = 'PageOutOfRangeError'
  }
}

/**
 * Los filtros del listado, aplicados a un query ya armado. Compartido entre la
 * página (paginada) y la exportación (entera): un filtro nuevo se agrega acá y
 * los dos lo respetan.
 */
function applyReservationFilters(query: SBAny, opts: ReservationFilters): SBAny {
  let q = query
  if (opts.dateFrom) q = q.gte('reservation_date', opts.dateFrom)
  if (opts.dateTo) q = q.lte('reservation_date', opts.dateTo)
  if (opts.zone) q = q.eq('zone', opts.zone)
  if (opts.mealType) q = q.eq('meal_type', opts.mealType)
  if (opts.kind) q = q.eq('kind', opts.kind)
  if (opts.status) {
    if (Array.isArray(opts.status)) q = q.in('status', opts.status)
    else q = q.eq('status', opts.status)
  } else if (opts.excludeStatus?.length) {
    // Solo cuando NO hay filtro explícito: si el usuario pidió ver las
    // canceladas, mandan las canceladas.
    q = q.not('status', 'in', `(${opts.excludeStatus.join(',')})`)
  }
  if (opts.managerId) {
    q = q.or(`primary_manager_id.eq.${opts.managerId},assistant_manager_id.eq.${opts.managerId}`)
  }
  if (opts.partySize) {
    // Un tamaño de mesa es una MESA QUE SE ARMA: las canceladas y las no-show
    // no ocupan mesa, así que salen aunque haya un estado elegido. Es la misma
    // regla que `tallyPartySizes`, y es lo que hace que el número del chip sea
    // exactamente la cantidad de filas que se listan al tocarlo.
    q = q.not('status', 'in', '(cancelled,no_show)')
    // Dos `.or()` en la misma query son dos parámetros `or=`, y PostgREST los
    // combina con AND: el del gestor y el del tamaño no se pisan.
    q = q.or(partySizePostgrestFilter(opts.partySize))
  }
  if (opts.scheduledEventId) q = q.eq('scheduled_event_id', opts.scheduledEventId)
  if (opts.q && opts.q.trim().length >= 2) {
    const safe = opts.q.trim().replace(/[%,]/g, '')
    q = q.ilike('guest_name', `%${safe}%`)
  }
  return q
}

/** Tope de la exportación: el mes más cargado del HUB tiene ~400 reservas. */
export const EXPORT_MAX_ROWS = 2000

/**
 * Todas las reservas que cumplen los filtros, sin paginar, para exportar.
 * Devuelve `truncated` si se llegó al tope: la planilla lo dice, no lo esconde.
 */
export async function listSalonReservationsForExport(
  opts: Omit<ReservationFilters, 'page' | 'pageSize' | 'sort'>,
): Promise<{ rows: ReservationWithJoins[]; truncated: boolean }> {
  const supabase = (await createClient()) as SBAny
  const q = applyReservationFilters(
    supabase
      .from('salon_reservations')
      .select(RESERVATION_JOIN_SELECT)
      .eq('tenant_id', opts.tenantId)
      .order('reservation_date', { ascending: true })
      .order('reservation_time_local', { ascending: true })
      .order('guest_name', { ascending: true })
      .limit(EXPORT_MAX_ROWS + 1),
    opts,
  )
  const { data, error } = await q
  if (error) throw error
  const all = (data ?? []).map((r: Record<string, unknown>) => flattenReservation(r))
  return { rows: all.slice(0, EXPORT_MAX_ROWS), truncated: all.length > EXPORT_MAX_ROWS }
}

export async function listSalonReservations(
  opts: ReservationFilters,
): Promise<{ rows: ReservationWithJoins[]; total: number }> {
  const supabase = (await createClient()) as SBAny
  const pageSize = opts.pageSize ?? 25
  const page = Math.max(1, opts.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const ascending = opts.sort === 'asc'

  const q = applyReservationFilters(
    supabase
      .from('salon_reservations')
      .select(RESERVATION_JOIN_SELECT, { count: 'exact' })
      .eq('tenant_id', opts.tenantId)
      .order('reservation_date', { ascending })
      .order('reservation_time_local', { ascending: true })
      .range(from, to),
    opts,
  )

  const { data, error, count } = await q
  if (error) {
    // 416: pidió un offset mayor a la cantidad de filas. En ese camino
    // postgrest-js no devuelve `count`, así que tragarse el error dejaría el
    // header en cero: hay que avisar arriba para que redirija.
    if ((error as { code?: string }).code === 'PGRST103') throw new PageOutOfRangeError()
    throw error
  }
  const rows = (data ?? []).map((r: Record<string, unknown>) => flattenReservation(r))
  return { rows, total: count ?? 0 }
}

/**
 * Totales del período para la barra de rango: cuántas reservas y cuántos
 * cubiertos hay entre dos fechas. En modo día ese número lo da
 * `getDayCapacitySnapshot` (que además conoce el tope del salón); en un rango
 * el tope no significa nada, pero el volumen sí — sin esto, al pasar a "este
 * mes" se perdía el contador de cubiertos.
 *
 * `guests` es el total (salón + eventos), con el desglose por zona. La usa la
 * barra de rango de la lista /reservas; el cupo del DÍA no sale de acá sino del
 * corte por servicio (lib/salon/segments.ts).
 *
 * Excluye canceladas y no-show: no ocupan mesa.
 */
export async function getRangeReservationTotals(opts: {
  tenantId: string
  from: string
  to: string
}): Promise<RangeTotals> {
  const supabase = (await createClient()) as SBAny
  // `scheduled_event_id` y no `zone`: una reserva de evento con planta sigue
  // siendo de evento (ver `tallyRangeTotals`).
  const { data, error } = await supabase
    .from('salon_reservations')
    .select('estimated_guests, actual_guests, scheduled_event_id, kind, cake_count')
    .eq('tenant_id', opts.tenantId)
    .gte('reservation_date', opts.from)
    .lte('reservation_date', opts.to)
    .not('status', 'in', '(cancelled,no_show)')
  if (error) throw error

  return tallyRangeTotals((data ?? []) as RangeTotalsRow[])
}

/**
 * Las filas del día reducidas a lo que necesita el corte por servicio.
 *
 * Va aparte del listado paginado a propósito: los chips "Cena 12 · Merienda 3"
 * tienen que seguir diciendo la verdad cuando el usuario filtra por un servicio
 * (si salieran de la página cargada, filtrar por Cena dejaría los otros en 0 y
 * no habría manera de volver). Son 7 columnas de un día: más barato que traer
 * las reservas con sus joins de nuevo.
 */
export async function listDayServiceRows(opts: {
  tenantId: string
  date: string
  /**
   * Los OTROS filtros de la pantalla (zona, estado, gestor, búsqueda). Se
   * aplican a propósito, y el de servicio NO: un chip tiene que contar lo que
   * vas a ver si lo tocás. Si contara el día crudo, con "Planta Baja" activo
   * diría "Cena 12" arriba de 4 filas; si además se filtrara por servicio, los
   * otros chips darían 0 y no habría manera de volver.
   */
  zone?: SalonZone
  status?: SalonReservationStatus
  managerId?: string
  q?: string
}): Promise<ServiceRow[]> {
  const supabase = (await createClient()) as SBAny
  let query = supabase
    .from('salon_reservations')
    .select(
      'meal_type, zone, status, kind, cake_count, estimated_guests, actual_guests, reservation_time_local',
    )
    .eq('tenant_id', opts.tenantId)
    .eq('reservation_date', opts.date)

  if (opts.zone) query = query.eq('zone', opts.zone)
  if (opts.status) query = query.eq('status', opts.status)
  if (opts.managerId) {
    query = query.or(
      `primary_manager_id.eq.${opts.managerId},assistant_manager_id.eq.${opts.managerId}`,
    )
  }
  if (opts.q && opts.q.trim().length >= 2) {
    const safe = opts.q.trim().replace(/[%,]/g, '')
    query = query.ilike('guest_name', `%${safe}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ServiceRow[]
}

/**
 * Las filas de un PERÍODO reducidas a lo que necesita el contador por tamaño
 * de mesa ("cuántas mesas de 4 hay"). Tres columnas y nada más.
 *
 * Solo hace falta en modo rango ("esta semana", "este mes"): en modo día los
 * mismos números salen de `listDayServiceRows`, que ya se pide para los chips
 * de servicio. Un mes del HUB son ~400 filas de 3 enteros — el mismo costo que
 * `getRangeReservationTotals`, y va en el mismo `Promise.all`, así que no suma
 * un hop.
 *
 * Recibe TODOS los filtros de la pantalla menos el de tamaño: un chip tiene
 * que contar lo que vas a ver si lo tocás (si se contara ya filtrado, los
 * otros seis darían 0 y no habría manera de volver).
 */
export async function listPartySizeRows(opts: {
  tenantId: string
  dateFrom?: string
  dateTo?: string
  zone?: SalonZone
  status?: SalonReservationStatus
  mealType?: MealType
  managerId?: string
  q?: string
}): Promise<PartySizeCountable[]> {
  const supabase = (await createClient()) as SBAny
  const query = applyReservationFilters(
    supabase
      .from('salon_reservations')
      .select('status, estimated_guests, actual_guests')
      .eq('tenant_id', opts.tenantId),
    {
      ...opts,
      // Lo que no ocupa mesa no tiene tamaño: se descarta en la query para no
      // traerlo al pedo (el contador lo descartaría igual). Si el usuario
      // eligió un estado, manda el suyo — ver `applyReservationFilters`.
      excludeStatus: ['cancelled', 'no_show'],
    },
  )
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as PartySizeCountable[]
}

/**
 * Los festejos del día — cumpleaños, reservas especiales y cualquier mesa que
 * deje una torta para hacer — con sus joins.
 *
 * Va aparte del listado paginado por la misma razón que los chips: el renglón de
 * hitos tiene que decir la verdad del DÍA. Si saliera de las filas cargadas,
 * cualquier filtro activo (`?zone=`, `?q=`, `?servicio=`) haría desaparecer el
 * cumple mientras el evento —que se pide con su propia query— sigue ahí: el
 * cumpleaños volvería a esconderse adentro del evento, que es exactamente el
 * moco que esto vino a arreglar.
 *
 * Son 0-3 filas por día (40 cumpleaños en 194 reservas de historia).
 */
export async function listDayCelebrations(opts: {
  tenantId: string
  date: string
}): Promise<ReservationWithJoins[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('salon_reservations')
    .select(RESERVATION_JOIN_SELECT)
    .eq('tenant_id', opts.tenantId)
    .eq('reservation_date', opts.date)
    // …o cualquier mesa con torta, sea del tipo que sea: la torta la hace el bar
    // y perderla en una reserva "normal" es el mismo moco (hay una así del 28/05).
    .or('kind.in.(birthday,special),cake_count.gt.0')
    .not('status', 'in', '(cancelled,no_show)')
    .order('reservation_time_local', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => flattenReservation(r))
}

export async function getSalonReservation(opts: {
  tenantId: string
  id: string
}): Promise<ReservationWithJoins | null> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('salon_reservations')
    .select(RESERVATION_JOIN_SELECT)
    .eq('tenant_id', opts.tenantId)
    .eq('id', opts.id)
    .maybeSingle()
  if (error || !data) return null
  return flattenReservation(data as Record<string, unknown>)
}

export type TodaySalonOverview = {
  date: string
  reservationsCount: number
  estimatedGuests: number
  peak: PeakWindow | null
  byStatus: { pending: number; arrived: number; seated: number; closed: number }
  byMeal: Record<MealType, { count: number; guests: number }>
}

/**
 * Snapshot del salón para el día indicado — pensado para mostrar al
 * arrancar el dashboard. Excluye reservas canceladas o no-show porque
 * no aportan al "qué esperar hoy".
 *
 * `estimatedGuests` usa `actual_guests` cuando ya hubo cierre y
 * `estimated_guests` mientras la reserva sigue activa.
 */
export async function getTodaySalonOverview(opts: {
  tenantId: string
  date: string
}): Promise<TodaySalonOverview> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('salon_reservations')
    .select('meal_type, reservation_time_local, estimated_guests, actual_guests, status')
    .eq('tenant_id', opts.tenantId)
    .eq('reservation_date', opts.date)
    .not('status', 'in', '(cancelled,no_show)')

  if (error) throw error

  const rows = (data ?? []) as Array<{
    meal_type: MealType
    reservation_time_local: string
    estimated_guests: number
    actual_guests: number | null
    status: 'pending' | 'arrived' | 'seated' | 'closed'
  }>

  const byStatus = { pending: 0, arrived: 0, seated: 0, closed: 0 }
  const byMeal: TodaySalonOverview['byMeal'] = {
    breakfast: { count: 0, guests: 0 },
    lunch: { count: 0, guests: 0 },
    tea_time: { count: 0, guests: 0 },
    dinner: { count: 0, guests: 0 },
    hub_event: { count: 0, guests: 0 },
  }
  let estimatedGuests = 0

  for (const r of rows) {
    const guests = r.actual_guests ?? r.estimated_guests ?? 0
    estimatedGuests += guests
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    byMeal[r.meal_type].count += 1
    byMeal[r.meal_type].guests += guests
  }

  const peak = computePeakWindow(
    rows.map((r) => ({
      time: r.reservation_time_local,
      guests: r.actual_guests ?? r.estimated_guests,
    })),
  )

  return {
    date: opts.date,
    reservationsCount: rows.length,
    estimatedGuests,
    peak,
    byStatus,
    byMeal,
  }
}

export async function listTimelineForDate(opts: {
  tenantId: string
  date: string // YYYY-MM-DD
}): Promise<ReservationWithJoins[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('salon_reservations')
    .select(RESERVATION_JOIN_SELECT)
    .eq('tenant_id', opts.tenantId)
    .eq('reservation_date', opts.date)
    .order('reservation_time_local', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => flattenReservation(r))
}

// ──────────────────────────────────────────────────────────
// Capacidad por día (RPC)
// ──────────────────────────────────────────────────────────

/**
 * Buckets de `evaluate_day_capacity`. El cupo del día ya NO sale de acá: el
 * corte por servicio (almuerzo/merienda/cena) lo calcula lib/salon/segments.ts.
 * Queda vivo solo por los `event:*` que leen el operativo y el salón; se
 * retira desde el BACKLOG cuando esos lectores pasen a los segmentos.
 */
export async function getDayCapacitySnapshot(opts: {
  tenantId: string
  date: string
}): Promise<DayCapacityBucket[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('evaluate_day_capacity', {
    p_tenant_id: opts.tenantId,
    p_date: opts.date,
  })
  if (error) throw error
  return (data ?? []) as DayCapacityBucket[]
}

// ──────────────────────────────────────────────────────────
// Eventos programados + templates
// ──────────────────────────────────────────────────────────

export type ScheduledEventWithTemplate = ScheduledEventRow & {
  template: Pick<
    ScheduledEventTemplateRow,
    'id' | 'name' | 'slug' | 'color_hex' | 'default_capacity' | 'consume_special_reservations'
  > | null
}

export async function listScheduledEventsForDateRange(opts: {
  tenantId: string
  from: string
  to: string
}): Promise<ScheduledEventWithTemplate[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('scheduled_events')
    .select(
      'id, tenant_id, template_id, name_override, event_date, starts_at_local, ends_at_local, capacity, meal_type, full_bonus_active, attendance_points, notes, created_at, updated_at, template:scheduled_event_templates(id, name, slug, color_hex, default_capacity, consume_special_reservations)',
    )
    .eq('tenant_id', opts.tenantId)
    .gte('event_date', opts.from)
    .lte('event_date', opts.to)
    .order('event_date', { ascending: true })
    .order('starts_at_local', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => {
    const tpl = r.template
    const template = Array.isArray(tpl) ? (tpl[0] ?? null) : (tpl ?? null)
    return { ...(r as object), template } as ScheduledEventWithTemplate
  })
}

export async function listScheduledEventsForDate(opts: {
  tenantId: string
  date: string
}): Promise<ScheduledEventWithTemplate[]> {
  return listScheduledEventsForDateRange({
    tenantId: opts.tenantId,
    from: opts.date,
    to: opts.date,
  })
}

export async function getScheduledEvent(opts: {
  tenantId: string
  id: string
}): Promise<ScheduledEventWithTemplate | null> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('scheduled_events')
    .select(
      '*, template:scheduled_event_templates(id, name, slug, color_hex, default_capacity, consume_special_reservations)',
    )
    .eq('tenant_id', opts.tenantId)
    .eq('id', opts.id)
    .maybeSingle()
  if (error || !data) return null
  const d = data as Record<string, unknown>
  const tpl = d.template
  const template = Array.isArray(tpl) ? (tpl[0] ?? null) : (tpl ?? null)
  return { ...(d as object), template } as ScheduledEventWithTemplate
}

export async function listScheduledTemplates(opts: {
  tenantId: string
  onlyActive?: boolean
}): Promise<ScheduledEventTemplateRow[]> {
  const supabase = (await createClient()) as SBAny
  let q = supabase
    .from('scheduled_event_templates')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .order('name', { ascending: true })
  if (opts.onlyActive !== false) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ScheduledEventTemplateRow[]
}

// ──────────────────────────────────────────────────────────
// Tortas de cumpleaños
// ──────────────────────────────────────────────────────────

/**
 * El menú de tortas del bar. `onlyActive` para el selector del alta de reserva
 * (no se ofrece una torta dada de baja); completo para el editor del dueño.
 */
export async function listCakeOptions(opts: {
  tenantId: string
  onlyActive?: boolean
}): Promise<CakeOptionRow[]> {
  const supabase = (await createClient()) as SBAny
  let q = supabase
    .from('cake_options')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (opts.onlyActive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as CakeOptionRow[]
}

/**
 * Cuántas reservas eligieron cada torta. El editor lo usa para no dejar borrar
 * una opción que la cocina ya tiene comprometida (la FK es `restrict`, así que
 * sin esto el dueño se comería un error crudo de Postgres).
 */
export async function countReservationsByCakeOption(opts: {
  tenantId: string
}): Promise<Record<string, number>> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('salon_reservations')
    .select('cake_option_id')
    .eq('tenant_id', opts.tenantId)
    .not('cake_option_id', 'is', null)
  if (error) throw error
  const counts: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{ cake_option_id: string }>) {
    counts[r.cake_option_id] = (counts[r.cake_option_id] ?? 0) + 1
  }
  return counts
}

// ──────────────────────────────────────────────────────────
// Gestores
// ──────────────────────────────────────────────────────────

export async function listManagers(opts: {
  tenantId: string
  onlyActive?: boolean
}): Promise<ReservationManagerRow[]> {
  const supabase = (await createClient()) as SBAny
  let q = supabase
    .from('reservation_managers')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .order('display_name', { ascending: true })
  if (opts.onlyActive !== false) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ReservationManagerRow[]
}

// ──────────────────────────────────────────────────────────
// Capacidades zona (defaults + overrides)
// ──────────────────────────────────────────────────────────

export async function getZoneCapacityDefaults(opts: {
  tenantId: string
}): Promise<{ planta_alta: number; planta_baja: number }> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', opts.tenantId)
    .maybeSingle()
  if (error || !data) return { planta_alta: 0, planta_baja: 0 }
  const settings = (data.settings ?? {}) as {
    salon_capacities?: { planta_alta?: number; planta_baja?: number }
  }
  const caps = settings.salon_capacities ?? {}
  return {
    planta_alta: Number(caps.planta_alta ?? 0),
    planta_baja: Number(caps.planta_baja ?? 0),
  }
}

export async function listZoneOverrides(opts: {
  tenantId: string
  from?: string
  to?: string
}): Promise<SalonZoneCapacityOverrideRow[]> {
  const supabase = (await createClient()) as SBAny
  let q = supabase
    .from('salon_zone_capacity_overrides')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .order('override_date', { ascending: false })
  if (opts.from) q = q.gte('override_date', opts.from)
  if (opts.to) q = q.lte('override_date', opts.to)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as SalonZoneCapacityOverrideRow[]
}

// ──────────────────────────────────────────────────────────
// Comisiones: tarifas, bonus, ledger
// ──────────────────────────────────────────────────────────

export async function listRateTiers(opts: { tenantId: string }): Promise<CommissionRateTierRow[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('commission_rate_tiers')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .order('meal_type', { ascending: true })
    .order('min_guests', { ascending: true })
  if (error) throw error
  return (data ?? []) as CommissionRateTierRow[]
}

export async function getBonusRule(opts: {
  tenantId: string
}): Promise<CommissionBonusRuleRow | null> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('commission_bonus_rules')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .eq('scope', 'scheduled_event_full')
    .maybeSingle()
  if (error || !data) return null
  return data as CommissionBonusRuleRow
}

export type CommissionSummaryRow = {
  manager: Pick<ReservationManagerRow, 'id' | 'display_name'>
  reservations_count: number
  /** Cubiertos facturados (lo que el sistema propone cobrar). */
  guests_total: number
  /** Cubiertos que se reservaron. */
  booked_total: number
  /** Cubiertos contados de verdad. Solo suma las reservas con conteo cargado. */
  attended_total: number
  /**
   * Reservas sin conteo. Su comisión se está proponiendo sobre el ESTIMADO, así
   * que los dueños tienen que saber cuántas son antes de aprobar el pago: si no,
   * estarían firmando plata sobre un número que nadie midió.
   */
  uncounted_count: number
  base_cents: number
  bonus_cents: number
  payable_cents: number
  paid_cents: number
  pending_cents: number
}

/**
 * Techo de TODA lectura de comisiones. Igual que en el reporte de señas:
 * PostgREST corta en 1000 filas SIN error, y un total de plata truncado no tiene
 * ningún síntoma — se ve igual de prolijo, solo que con menos plata. Mientras el
 * período fue siempre un mes calendario no se llegaba ni cerca; desde que el
 * rango es libre (hasta `MAX_COMMISSION_PERIOD_DAYS`, ~13 meses) sí se llega, así
 * que pedimos el tope explícito y devolvemos `truncated` para que la pantalla
 * avise en vez de mentir. (El mes más cargado del HUB ronda las 250 reservas.)
 *
 * Las tres lecturas piden además el conteo exacto: ver `isTruncated`.
 */
export const COMMISSION_MAX_ROWS = 1000

/**
 * ¿De verdad quedó algo afuera?
 *
 * `rows.length >= COMMISSION_MAX_ROWS` no alcanza: con exactamente 1000 filas
 * prende el aviso sin faltar ninguna, y en el pago por rango eso manda al dueño
 * a repetir una liquidación que ya estaba completa. Pedir una fila sonda
 * (`limit + 1`) tampoco sirve acá: PostgREST tiene su propio tope
 * (`max_rows = 1000` en `supabase/config.toml`) y se comería la sonda, con lo
 * que el aviso nunca volvería a prenderse — un corte silencioso es exactamente
 * lo que esta función existe para evitar. El `count=exact` viene en la MISMA
 * respuesta (header `Content-Range`, sin round-trip extra) y es el único que
 * distingue "vinieron justo 1000" de "hay más".
 */
function isTruncated(count: number | null | undefined, rows: unknown[]): boolean {
  // Sin conteo (no debería pasar) volvemos al criterio conservador: mejor un
  // cartel de más que un total parcial que se ve igual de prolijo.
  return count == null ? rows.length >= COMMISSION_MAX_ROWS : count > rows.length
}

export async function listCommissionSummary(opts: {
  tenantId: string
  from: string
  to: string
}): Promise<{ rows: CommissionSummaryRow[]; truncated: boolean }> {
  const supabase = (await createClient()) as SBAny
  const { data, error, count } = await supabase
    .from('commission_ledger')
    .select(
      `manager_id, guests_billed, base_total_cents, bonus_total_cents, payable_cents, paid_at,
       manager:reservation_managers(id, display_name),
       reservation:salon_reservations!inner(reservation_date, estimated_guests, actual_guests)`,
      { count: 'exact' },
    )
    .eq('tenant_id', opts.tenantId)
    .gte('reservation.reservation_date', opts.from)
    .lte('reservation.reservation_date', opts.to)
    .limit(COMMISSION_MAX_ROWS)

  if (error) throw error

  const source = (data ?? []) as Array<Record<string, unknown>>
  const truncated = isTruncated(count, source)
  const grouped = new Map<string, CommissionSummaryRow>()
  for (const row of source) {
    const mgrRaw = row.manager
    const mgr = (Array.isArray(mgrRaw) ? mgrRaw[0] : mgrRaw) as {
      id: string
      display_name: string
    } | null
    if (!mgr) continue
    const cur =
      grouped.get(mgr.id) ??
      ({
        manager: mgr,
        reservations_count: 0,
        guests_total: 0,
        booked_total: 0,
        attended_total: 0,
        uncounted_count: 0,
        base_cents: 0,
        bonus_cents: 0,
        payable_cents: 0,
        paid_cents: 0,
        pending_cents: 0,
      } as CommissionSummaryRow)
    const resRaw = row.reservation
    const res = (Array.isArray(resRaw) ? resRaw[0] : resRaw) as {
      estimated_guests: number
      actual_guests: number | null
    } | null

    cur.reservations_count += 1
    cur.guests_total += Number(row.guests_billed ?? 0)
    cur.booked_total += Number(res?.estimated_guests ?? 0)
    if (res?.actual_guests != null) cur.attended_total += Number(res.actual_guests)
    else cur.uncounted_count += 1
    cur.base_cents += Number(row.base_total_cents ?? 0)
    cur.bonus_cents += Number(row.bonus_total_cents ?? 0)
    cur.payable_cents += Number(row.payable_cents ?? 0)
    if (row.paid_at) cur.paid_cents += Number(row.payable_cents ?? 0)
    else cur.pending_cents += Number(row.payable_cents ?? 0)
    grouped.set(mgr.id, cur)
  }
  return {
    rows: Array.from(grouped.values()).sort((a, b) => b.payable_cents - a.payable_cents),
    truncated,
  }
}

export type CommissionBreakdownEntry = CommissionLedgerRow & {
  reservation: Pick<
    ReservationWithJoins,
    | 'id'
    | 'guest_name'
    | 'reservation_date'
    | 'reservation_time_local'
    | 'estimated_guests'
    | 'actual_guests'
  >
}

export async function listCommissionBreakdown(opts: {
  tenantId: string
  managerId: string
  from: string
  to: string
}): Promise<{ entries: CommissionBreakdownEntry[]; truncated: boolean }> {
  const supabase = (await createClient()) as SBAny
  const { data, error, count } = await supabase
    .from('commission_ledger')
    .select(
      `*,
       reservation:salon_reservations!inner(
         id, guest_name, reservation_date, reservation_time_local,
         estimated_guests, actual_guests
       )`,
      { count: 'exact' },
    )
    .eq('tenant_id', opts.tenantId)
    .eq('manager_id', opts.managerId)
    .gte('reservation.reservation_date', opts.from)
    .lte('reservation.reservation_date', opts.to)
    .order('calculated_at', { ascending: false })
    .limit(COMMISSION_MAX_ROWS)
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const truncated = isTruncated(count, rows)
  return {
    entries: rows.map((r) => {
      const resRaw = r.reservation
      const reservation = Array.isArray(resRaw) ? resRaw[0] : resRaw
      return { ...(r as object), reservation } as CommissionBreakdownEntry
    }),
    truncated,
  }
}

/**
 * IDs del ledger IMPAGOS de un gestor en un rango, para el botón "marcar todo
 * lo pendiente como pagado".
 *
 * Existe para que la Server Action nunca confíe en ids que manda el browser: la
 * pantalla dice "23 reservas, $184.500" y el servidor vuelve a preguntar quién
 * está pendiente antes de tocar nada. `select` flaco (id + plata) porque no hay
 * nada que dibujar con esto.
 *
 * El corte en `COMMISSION_MAX_ROWS` acá es peor que en un reporte: dejaría
 * comisiones sin marcar creyendo que se pagó todo, así que `truncated` viaja
 * hasta el mensaje de la acción para que el dueño sepa que tiene que repetir.
 */
export async function listUnpaidCommissionLedgerIds(opts: {
  tenantId: string
  managerId: string
  /** `yyyy-MM-dd` inclusive, por fecha de reserva. */
  from: string
  /** `yyyy-MM-dd` inclusive, por fecha de reserva. */
  to: string
}): Promise<{ ids: string[]; totalCents: number; truncated: boolean }> {
  const supabase = (await createClient()) as SBAny
  const { data, error, count } = await supabase
    .from('commission_ledger')
    .select('id, payable_cents, reservation:salon_reservations!inner(reservation_date)', {
      count: 'exact',
    })
    .eq('tenant_id', opts.tenantId)
    .eq('manager_id', opts.managerId)
    .is('paid_at', null)
    // `reservation_date` es `date` puro: se compara con los mismos strings
    // `yyyy-MM-dd` de la URL, sin conversión de zona.
    .gte('reservation.reservation_date', opts.from)
    .lte('reservation.reservation_date', opts.to)
    // MISMO orden que `listCommissionBreakdown`, a propósito: si las dos
    // lecturas se truncan, tienen que cortar por el mismo lado. Con órdenes
    // opuestos la pantalla prometía las 1000 más nuevas y la acción marcaba las
    // 1000 más viejas — otro conjunto y otro monto que el que se confirmó.
    .order('calculated_at', { ascending: false })
    .limit(COMMISSION_MAX_ROWS)
  if (error) throw error

  // `ids` y `totalCents` salen SIEMPRE de las filas que volvieron, nunca del
  // conteo: el monto del toast tiene que ser el de lo que se va a marcar.
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return {
    ids: rows.map((r) => String(r.id)),
    totalCents: rows.reduce((acc, r) => acc + Number(r.payable_cents ?? 0), 0),
    truncated: isTruncated(count, rows),
  }
}

/**
 * Gestor de reservas vinculado a la cuenta del usuario actual (si existe).
 * Usa el client anon con RLS: `rm_select_member` deja leer a cualquier
 * miembro del tenant, así que el host puede resolver su propia identidad.
 */
export async function getManagerForUser(opts: {
  tenantId: string
  userId: string
}): Promise<ReservationManagerRow | null> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('reservation_managers')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .eq('user_id', opts.userId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  const row = (data ?? [])[0] as ReservationManagerRow | undefined
  return row ?? null
}

/**
 * Entradas del ledger de UN gestor para "Mis números", en el mismo rango libre
 * que usa la liquidación del dueño: la gestora cobra "del 15 al 15", no por mes
 * calendario, y tiene que poder ver exactamente el corte que le van a pagar.
 * Client anon + RLS: el owner ve todo (`cl_owner_select`) y el gestor
 * vinculado ve solo lo suyo (`cl_manager_self_select`). Nunca service role.
 */
export async function listMyCommissionEntries(opts: {
  tenantId: string
  managerId: string
  /** `yyyy-MM-dd` inclusive. El período ya no es un mes: es el rango libre de la liquidación. */
  from: string
  /** `yyyy-MM-dd` inclusive. */
  to: string
}): Promise<{ entries: CommissionBreakdownEntry[]; truncated: boolean }> {
  const { entries, truncated } = await listCommissionBreakdown({
    tenantId: opts.tenantId,
    managerId: opts.managerId,
    from: opts.from,
    to: opts.to,
  })
  // El breakdown ordena por calculated_at; acá queremos fecha de reserva desc.
  return {
    entries: entries.sort((a, b) => {
      if (a.reservation.reservation_date !== b.reservation.reservation_date) {
        return a.reservation.reservation_date < b.reservation.reservation_date ? 1 : -1
      }
      return a.calculated_at < b.calculated_at ? 1 : -1
    }),
    truncated,
  }
}

// Inputs requeridos por el motor TS (paridad con SQL).
export type CommissionInputForEngine = {
  reservation: Pick<
    ReservationWithJoins,
    | 'meal_type'
    | 'estimated_guests'
    | 'actual_guests'
    | 'scheduled_event_id'
    | 'primary_manager_id'
    | 'assistant_manager_id'
  >
  rateTiers: CommissionRateTierRow[]
  bonusPerGuestCents: number
  scheduledEvent: { capacity: number; total_used: number; full_bonus_active: boolean } | null
  managers: { primaryEligible: boolean; assistantEligible: boolean }
}

export async function buildCommissionInputForReservation(opts: {
  tenantId: string
  reservationId: string
}): Promise<CommissionInputForEngine | null> {
  const supabase = (await createClient()) as SBAny
  const { data: res, error } = await supabase
    .from('salon_reservations')
    .select(
      `meal_type, estimated_guests, actual_guests, scheduled_event_id,
       primary_manager_id, assistant_manager_id,
       primary:reservation_managers!salon_reservations_primary_manager_id_fkey(commission_eligible),
       assistant:reservation_managers!salon_reservations_assistant_manager_id_fkey(commission_eligible)`,
    )
    .eq('tenant_id', opts.tenantId)
    .eq('id', opts.reservationId)
    .maybeSingle()
  if (error || !res) return null

  const r = res as Record<string, unknown>
  const primary = normalizeJoin(r.primary as { commission_eligible: boolean } | null)
  const assistant = normalizeJoin(r.assistant as { commission_eligible: boolean } | null)

  // Tarifas, bonus, evento y ocupación solo dependen de la reserva ya leída:
  // eran 4 hops secuenciales (tiers → bonus → evento → uso), ahora viajan juntos.
  const scheduledEventId = (r.scheduled_event_id as string | null) ?? null
  const [tiers, bonus, evResult, usageResult] = await Promise.all([
    listRateTiers({ tenantId: opts.tenantId }),
    getBonusRule({ tenantId: opts.tenantId }),
    scheduledEventId
      ? supabase
          .from('scheduled_events')
          .select('capacity, full_bonus_active')
          .eq('id', scheduledEventId)
          .maybeSingle()
      : null,
    scheduledEventId
      ? supabase
          .from('salon_reservations')
          .select('estimated_guests, actual_guests')
          .eq('scheduled_event_id', scheduledEventId)
          .not('status', 'in', '(cancelled,no_show)')
      : null,
  ])

  let scheduledEvent: CommissionInputForEngine['scheduledEvent'] = null
  const ev = evResult?.data ?? null
  if (ev) {
    const usage = usageResult?.data ?? []
    // Lo RESERVADO, igual que la RPC: "lleno" es que se agotó el cupo, y el cupo
    // se agota cuando se vende. Antes usaba `actual ?? estimated` y quedaba
    // fuera de paridad con `recalc_reservation_commission`.
    const total = (usage as Array<Record<string, unknown>>).reduce(
      (acc: number, x: Record<string, unknown>) =>
        acc + Number((x.estimated_guests as number) ?? 0),
      0,
    )
    const e = ev as Record<string, unknown>
    scheduledEvent = {
      capacity: Number(e.capacity ?? 0),
      total_used: total,
      full_bonus_active: Boolean(e.full_bonus_active),
    }
  }

  return {
    reservation: {
      meal_type: r.meal_type as MealType,
      estimated_guests: Number(r.estimated_guests),
      actual_guests:
        r.actual_guests === null || r.actual_guests === undefined ? null : Number(r.actual_guests),
      scheduled_event_id: (r.scheduled_event_id as string | null) ?? null,
      primary_manager_id: r.primary_manager_id as string,
      assistant_manager_id: (r.assistant_manager_id as string | null) ?? null,
    },
    rateTiers: tiers,
    bonusPerGuestCents: bonus?.bonus_per_guest_cents ?? 0,
    scheduledEvent,
    managers: {
      primaryEligible: Boolean(primary?.commission_eligible),
      assistantEligible: Boolean(assistant?.commission_eligible),
    },
  }
}

// ──────────────────────────────────────────────────────────
// Señas por día (reporte de ingresos)
// ──────────────────────────────────────────────────────────

/**
 * Techo de la lectura. PostgREST corta en 1000 filas SIN error: un reporte de
 * plata truncado daría un total equivocado y ningún síntoma. Pedimos el tope y,
 * si vuelve completo, marcamos `truncated` para que la pantalla avise.
 * (Hoy el mes más cargado del HUB tiene ~250 reservas.)
 */
export const DEPOSITS_MAX_ROWS = 1000

/**
 * Todas las señas del rango, ya sumadas por día.
 *
 * `select` flaco de 4 columnas a propósito: para sumar plata no hacen falta los
 * 5 joins de `RESERVATION_JOIN_SELECT`. Y sin `.not('status', 'in', ...)`: al
 * revés que el resto de los agregadores de salón, acá las canceladas y las
 * no-show SUMAN (decisión del dueño) — copiarles el filtro por inercia borraría
 * $140.004 reales del HUB.
 */
export async function getDepositsByDay(opts: {
  tenantId: string
  basis: DepositBasis
  /** `yyyy-MM-dd` inclusive, calendario del bar. */
  from: string
  /** `yyyy-MM-dd` inclusive, calendario del bar. */
  to: string
}): Promise<DepositsReport> {
  const supabase = (await createClient()) as SBAny
  let query = supabase
    .from('salon_reservations')
    .select('reservation_date, created_at, deposit_cents, status')
    .eq('tenant_id', opts.tenantId)
    .limit(DEPOSITS_MAX_ROWS)

  if (opts.basis === 'reservation') {
    // `reservation_date` es `date` puro: se compara con los mismos strings
    // `yyyy-MM-dd` que viajan en la URL, sin conversión de zona.
    query = query.gte('reservation_date', opts.from).lte('reservation_date', opts.to)
  } else {
    // `created_at` es timestamptz y el Postgres corre en UTC. El día del bar
    // arranca a las 00:00 de Córdoba: convertimos los bordes a instantes y
    // usamos un rango medio abierto [from, to+1) — un `.lte('…T23:59:59.999')`
    // se comería una carga hecha en el último milisegundo del día.
    query = query
      .gte('created_at', cordobaDayStartUtc(opts.from))
      .lt('created_at', cordobaDayStartUtc(nextIsoDay(opts.to)))
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as DepositSourceRow[]
  return aggregateDepositsByDay({
    basis: opts.basis,
    from: opts.from,
    to: opts.to,
    rows,
    truncated: rows.length >= DEPOSITS_MAX_ROWS,
  })
}

/**
 * Primer y último día con reservas, para el período "Todo".
 *
 * Dos lecturas de una fila (no hay `min()`/`max()` en PostgREST sin una RPC) y
 * solo se llaman cuando el dueño pide el histórico completo. `null` cuando el
 * bar todavía no cargó ninguna reserva.
 */
export async function getDepositsBounds(opts: {
  tenantId: string
  basis: DepositBasis
}): Promise<{ from: string; to: string } | null> {
  const supabase = (await createClient()) as SBAny
  const column = opts.basis === 'created' ? 'created_at' : 'reservation_date'

  const edge = async (ascending: boolean): Promise<string | null> => {
    const { data, error } = await supabase
      .from('salon_reservations')
      .select(column)
      .eq('tenant_id', opts.tenantId)
      .order(column, { ascending })
      .limit(1)
    if (error) throw error
    const row = ((data ?? []) as Array<Record<string, string>>)[0]
    const value = row?.[column]
    if (!value) return null
    // El borde se guarda como día del bar: con `created_at`, una carga de las
    // 21:30 de Córdoba es del día anterior al que dice el timestamp en UTC.
    return opts.basis === 'created' ? isoDayInCordoba(value) : value.slice(0, 10)
  }

  const [from, to] = await Promise.all([edge(true), edge(false)])
  if (!from || !to) return null
  return { from, to }
}

// ──────────────────────────────────────────────────────────
// Cómo nos fue (reporte de gente por noche y por evento)
// ──────────────────────────────────────────────────────────

/**
 * Techo de la lectura, igual que en el reporte de señas: PostgREST corta en
 * 1000 filas SIN error y un reporte truncado mentiría sin ningún síntoma.
 * Una noche del HUB tiene ~30 reservas y el evento más repetido ~31 en total.
 */
export const EVENTS_REPORT_MAX_ROWS = 1000

const REPORT_ROW_SELECT =
  'id, reservation_date, scheduled_event_id, estimated_guests, actual_guests, status, table_label'

/**
 * Una noche entera: sus eventos programados y todas sus reservas.
 *
 * Sin `.not('status', 'in', ...)`: las canceladas se traen y el agregador puro
 * las separa, así el número grande y la nota al costado salen del mismo pase y
 * no pueden contradecirse.
 */
export type ReportMarketing = Record<string, EventMarketingRow>

export type DayReportWithMarketing = DayReport & {
  /** Pauta por `scheduled_event_id` de los eventos de la noche. Sin fila = «Sin cargar». */
  marketing: ReportMarketing
}

export type TemplateReportWithMarketing = TemplateReport & {
  /** Pauta por `scheduled_event_id` de las ediciones del evento. */
  marketing: ReportMarketing
}

/**
 * La pauta cargada de un set de ediciones, indexada por `scheduled_event_id`.
 *
 * Solo un dueño la lee (RLS `sem_owner_all`, SELECT incluido): con cualquier
 * otra sesión vuelve vacía y todo diría «Sin cargar». No es un problema porque
 * «Cómo nos fue» ya es owner-only en la page y en la exportación.
 *
 * Quién cargó sale de `reservation_managers` (se auto-provisiona desde
 * memberships) en una segunda lectura por `user_id`, con el mismo criterio que
 * `getManagerForUser`: si hay más de una fila, la más vieja. Si ESA lectura
 * falla, la pauta se muestra igual y sin firma: el nombre es un adorno y no
 * vale tumbar el reporte entero por él.
 */
export async function listEventMarketing(opts: {
  tenantId: string
  eventIds: ReadonlyArray<string>
}): Promise<ReportMarketing> {
  const ids = Array.from(new Set(opts.eventIds))
  if (ids.length === 0) return {}

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('scheduled_event_marketing')
    .select(EVENT_MARKETING_DB_SELECT)
    .eq('tenant_id', opts.tenantId)
    .in('scheduled_event_id', ids)
  if (error) throw error
  const rows = (data ?? []) as EventMarketingDbRow[]

  const userIds = Array.from(
    new Set(rows.map((r) => r.updated_by).filter((id): id is string => typeof id === 'string')),
  )
  const names = new Map<string, string>()
  if (userIds.length > 0) {
    const mgrRes = await supabase
      .from('reservation_managers')
      .select('user_id, display_name')
      .eq('tenant_id', opts.tenantId)
      .in('user_id', userIds)
      .order('created_at', { ascending: true })
    if (mgrRes.error) {
      console.error('[salon.listEventMarketing.names]', mgrRes.error.message)
    } else {
      for (const m of (mgrRes.data ?? []) as Array<{
        user_id: string | null
        display_name: string
      }>) {
        if (m.user_id && !names.has(m.user_id)) names.set(m.user_id, m.display_name)
      }
    }
  }

  const out: ReportMarketing = {}
  for (const row of rows) {
    const name = row.updated_by ? (names.get(row.updated_by) ?? null) : null
    out[row.scheduled_event_id] = toEventMarketingRow(row, name)
  }
  return out
}

/**
 * El último dólar cargado en cualquier pauta del bar, para el chip «Usar
 * $ 1.450 (último, 07/09)» del form. Nunca se precarga solo: un dólar viejo se
 * guardaría sin que nadie lo note.
 */
export async function getLastUsdArsRate(opts: {
  tenantId: string
}): Promise<{ rate: number; loadedAt: string } | null> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('scheduled_event_marketing')
    .select('usd_ars_rate, updated_at')
    .eq('tenant_id', opts.tenantId)
    .not('usd_ars_rate', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as { usd_ars_rate: number | string | null; updated_at: string } | null
  if (!row) return null
  const rate = Number(row.usd_ars_rate)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return { rate, loadedAt: row.updated_at }
}

export async function getDayReport(opts: {
  tenantId: string
  day: string
}): Promise<DayReportWithMarketing> {
  const supabase = (await createClient()) as SBAny
  // La pauta cuelga de los ids de los eventos, así que espera a ESA lectura y
  // nada más: corre en paralelo con las reservas en el mismo `Promise.all`, sin
  // sumar un hop en serie a la vista más usada.
  const eventsP = listScheduledEventsForDate({ tenantId: opts.tenantId, date: opts.day })
  const marketingP = eventsP.then((events) =>
    listEventMarketing({ tenantId: opts.tenantId, eventIds: events.map((e) => e.id) }),
  )
  const [events, res, marketing] = await Promise.all([
    eventsP,
    supabase
      .from('salon_reservations')
      .select(REPORT_ROW_SELECT)
      .eq('tenant_id', opts.tenantId)
      .eq('reservation_date', opts.day)
      .limit(EVENTS_REPORT_MAX_ROWS),
    marketingP,
  ])
  if (res.error) throw res.error
  const rows = (res.data ?? []) as ReportReservationRow[]
  const report = aggregateDayReport({
    day: opts.day,
    events: events as unknown as ReportEventRow[],
    rows,
    truncated: rows.length >= EVENTS_REPORT_MAX_ROWS,
  })
  return { ...report, marketing }
}

/**
 * Todas las ediciones de un evento con sus números.
 *
 * Dos lecturas: las ediciones (para tener también las que no vendieron una sola
 * reserva — un cero es información) y las reservas atadas a ellas.
 */
export async function getTemplateReport(opts: {
  tenantId: string
  templateId: string
  /** Hoy en el calendario del bar: define qué edición ya pasó. */
  today: string
}): Promise<TemplateReportWithMarketing | null> {
  const supabase = (await createClient()) as SBAny

  const tplRes = await supabase
    .from('scheduled_event_templates')
    .select('id, name, color_hex')
    .eq('tenant_id', opts.tenantId)
    .eq('id', opts.templateId)
    .maybeSingle()
  if (tplRes.error) throw tplRes.error
  const tpl = tplRes.data as { id: string; name: string; color_hex: string | null } | null
  if (!tpl) return null

  const evRes = await supabase
    .from('scheduled_events')
    .select(
      'id, template_id, name_override, event_date, starts_at_local, capacity, template:scheduled_event_templates(id, name, color_hex)',
    )
    .eq('tenant_id', opts.tenantId)
    .eq('template_id', opts.templateId)
    .order('event_date', { ascending: false })
    .limit(EVENTS_REPORT_MAX_ROWS)
  if (evRes.error) throw evRes.error
  const events = ((evRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const t = r.template
    return { ...r, template: Array.isArray(t) ? (t[0] ?? null) : (t ?? null) }
  }) as unknown as ReportEventRow[]

  const eventIds = events.map((e) => e.id)
  // Reservas y pauta cuelgan de los mismos ids y no una de la otra: van juntas.
  const [rows, marketing] = await Promise.all([
    listReportRowsForEvents({ tenantId: opts.tenantId, eventIds }),
    listEventMarketing({ tenantId: opts.tenantId, eventIds }),
  ])

  const report = aggregateTemplateReport({
    templateId: tpl.id,
    templateName: tpl.name,
    colorHex: tpl.color_hex,
    today: opts.today,
    events,
    rows,
    truncated: rows.length >= EVENTS_REPORT_MAX_ROWS,
  })
  return { ...report, marketing }
}

/** Las reservas (todas, caídas incluidas) atadas a un set de ediciones. */
async function listReportRowsForEvents(opts: {
  tenantId: string
  eventIds: ReadonlyArray<string>
}): Promise<ReportReservationRow[]> {
  if (opts.eventIds.length === 0) return []
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('salon_reservations')
    .select(REPORT_ROW_SELECT)
    .eq('tenant_id', opts.tenantId)
    .in('scheduled_event_id', opts.eventIds)
    .limit(EVENTS_REPORT_MAX_ROWS)
  if (error) throw error
  return (data ?? []) as ReportReservationRow[]
}

const YM_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/

/**
 * La pestaña «Pauta»: todas las ediciones de un mes con su gente y su pauta.
 *
 * Tres lecturas en dos tandas: las fechas del mes, y después reservas y pauta
 * en paralelo (las dos cuelgan de los ids). El agrupado por edición es el MISMO
 * `aggregateEditions` de la vista por evento: las "11 reservas" de una fecha
 * tienen que ser las mismas en las tres vistas o la pauta dividiría por otro
 * número.
 *
 * `ym` llega validado por la page; si no, se corta acá antes de armar un rango
 * que Postgres rebotaría como 22008.
 *
 * Las ediciones viajan enteras a `buildMonthMarketingReport` (son
 * `EditionSummary`, que cumple `MonthEditionInput`), así que la pestaña del mes
 * recibe también `billableGuests` y `attendedGuests`: la gente con la que se
 * multiplica el ingreso y el costo por persona sale del MISMO agregador que la
 * ficha de la noche. Armar acá un objeto más chico sería la manera de que las
 * dos pantallas dijeran números distintos para la misma fecha.
 */
export async function getMonthMarketingReport(opts: {
  tenantId: string
  /** `YYYY-MM`. */
  ym: string
  /** Hoy en el calendario del bar: define qué edición ya pasó. */
  today: string
}): Promise<MonthMarketingReport> {
  if (!YM_RE.test(opts.ym)) throw new Error('invalid_ym')
  const year = Number(opts.ym.slice(0, 4))
  const month = Number(opts.ym.slice(5, 7))
  // Día 0 del mes siguiente = último día de este (cubre bisiestos solo).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const from = `${opts.ym}-01`
  const to = `${opts.ym}-${String(lastDay).padStart(2, '0')}`

  const events = await listScheduledEventsForDateRange({ tenantId: opts.tenantId, from, to })
  const eventIds = events.map((e) => e.id)
  const [rows, marketing] = await Promise.all([
    listReportRowsForEvents({ tenantId: opts.tenantId, eventIds }),
    listEventMarketing({ tenantId: opts.tenantId, eventIds }),
  ])

  const editions = aggregateEditions({
    events: events as unknown as ReportEventRow[],
    rows,
    today: opts.today,
  })
  return buildMonthMarketingReport({
    ym: opts.ym,
    today: opts.today,
    editions,
    marketing,
    truncated: rows.length >= EVENTS_REPORT_MAX_ROWS,
  })
}

/** Ventana de lectura del atajo del calendario. */
const RECENT_DAYS_WINDOW = 400

/**
 * Las últimas noches con al menos una reserva EN PIE, de la más nueva a la más
 * vieja.
 *
 * Alimenta el default de la pantalla (abrir un reporte retrospectivo en una
 * noche vacía es una mala primera pantalla) y el atajo del calendario. Las
 * flechas ‹ › se mueven de a un día real: un martes sin nadie ES el dato.
 *
 * Las canceladas y las no-show se descartan acá igual que en el agregador: sin
 * eso, el popover ofrecía una noche con un "2" que en la ficha valía 0 porque
 * sus dos únicas reservas se habían cancelado.
 */
export async function listRecentReservationDays(opts: {
  tenantId: string
  /** No mira más allá de este día (normalmente hoy en Córdoba). */
  until: string
  limit?: number
}): Promise<Array<{ day: string; reservations: number }>> {
  const supabase = (await createClient()) as SBAny
  const take = opts.limit ?? 14
  // Un `.limit()` por DÍAS no existe en PostgREST y uno por filas se lo comería
  // un solo día cargado, así que se leen las últimas N filas y se agrupan acá.
  const { data, error } = await supabase
    .from('salon_reservations')
    .select('reservation_date')
    .eq('tenant_id', opts.tenantId)
    .lte('reservation_date', opts.until)
    .not('status', 'in', '(cancelled,no_show)')
    .order('reservation_date', { ascending: false })
    .limit(RECENT_DAYS_WINDOW)
  if (error) throw error
  const rows = (data ?? []) as Array<{ reservation_date: string }>
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.reservation_date, (counts.get(row.reservation_date) ?? 0) + 1)
  }
  const days = Array.from(counts.entries())
    .map(([day, reservations]) => ({ day, reservations }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))
  // Si la ventana se llenó, el día MÁS VIEJO quedó cortado a la mitad y su
  // conteo mentiría. Se descarta en vez de mostrar un número parcial sin aviso.
  if (rows.length >= RECENT_DAYS_WINDOW && days.length > 1) days.pop()
  return days.slice(0, take)
}

/**
 * Los eventos que el selector ofrece, ordenados por la gente que YA se sentó.
 *
 * `guests` y `pastEditions` cuentan solo fechas concluidas (ni hoy ni futuras),
 * porque el combo es el atajo a "cuál anda": ordenar por lo anotado a futuro
 * ponía primero a un evento que nunca corrió. Lo que viene se muestra aparte.
 */
export type EventTemplateOption = {
  id: string
  name: string
  colorHex: string | null
  /** Fechas en el calendario, incluidas las que vienen. */
  editions: number
  /** Fechas que ya terminaron. */
  pastEditions: number
  /** Personas sentadas en las fechas que ya terminaron. */
  guests: number
  /** Fechas que todavía no pasaron (hoy incluido). */
  upcoming: number
}

export async function listEventTemplateOptions(opts: {
  tenantId: string
  /** Hoy en el calendario del bar: define qué edición ya terminó. */
  today: string
}): Promise<{ options: EventTemplateOption[]; truncated: boolean }> {
  const supabase = (await createClient()) as SBAny
  // `onlyActive: false` a propósito: un formato dado de baja se lleva su
  // historia, y el dueño va a querer mirar cómo le fue igual.
  const [tplRes, evRes, resRes] = await Promise.all([
    supabase
      .from('scheduled_event_templates')
      .select('id, name, color_hex')
      .eq('tenant_id', opts.tenantId)
      .order('name', { ascending: true }),
    supabase
      .from('scheduled_events')
      .select('id, template_id, event_date')
      .eq('tenant_id', opts.tenantId)
      .limit(EVENTS_REPORT_MAX_ROWS),
    supabase
      .from('salon_reservations')
      .select('scheduled_event_id, estimated_guests, status')
      .eq('tenant_id', opts.tenantId)
      .not('scheduled_event_id', 'is', null)
      .limit(EVENTS_REPORT_MAX_ROWS),
  ])
  if (tplRes.error) throw tplRes.error
  if (evRes.error) throw evRes.error
  if (resRes.error) throw resRes.error

  const eventTemplate = new Map<string, string>()
  /** Eventos ya concluidos: sus reservas son las únicas que cuentan como historia. */
  const concluded = new Set<string>()
  const editions = new Map<string, number>()
  const pastEditions = new Map<string, number>()
  const upcoming = new Map<string, number>()
  for (const e of (evRes.data ?? []) as Array<{
    id: string
    template_id: string
    event_date: string
  }>) {
    eventTemplate.set(e.id, e.template_id)
    editions.set(e.template_id, (editions.get(e.template_id) ?? 0) + 1)
    // Las fechas son `date` puro: se comparan como strings. Hoy NO es pasado —
    // una noche que arranca a las 21:00 todavía está vendiendo.
    if (e.event_date < opts.today) {
      concluded.add(e.id)
      pastEditions.set(e.template_id, (pastEditions.get(e.template_id) ?? 0) + 1)
    } else {
      upcoming.set(e.template_id, (upcoming.get(e.template_id) ?? 0) + 1)
    }
  }
  const guests = new Map<string, number>()
  for (const r of (resRes.data ?? []) as Array<{
    scheduled_event_id: string | null
    estimated_guests: number | string
    status: string
  }>) {
    if (r.status === 'cancelled' || r.status === 'no_show') continue
    if (!r.scheduled_event_id || !concluded.has(r.scheduled_event_id)) continue
    const tplId = eventTemplate.get(r.scheduled_event_id)
    if (!tplId) continue
    guests.set(tplId, (guests.get(tplId) ?? 0) + Number(r.estimated_guests ?? 0))
  }

  // Las dos lecturas crecen con la historia del bar y no tienen cota temporal:
  // el día que toquen el techo, el orden y el default del combo saldrían mal sin
  // ningún síntoma. Se avisa, igual que en el resto del reporte.
  const truncated =
    (evRes.data ?? []).length >= EVENTS_REPORT_MAX_ROWS ||
    (resRes.data ?? []).length >= EVENTS_REPORT_MAX_ROWS

  const options = (
    (tplRes.data ?? []) as Array<{ id: string; name: string; color_hex: string | null }>
  )
    .map((t) => ({
      id: t.id,
      name: t.name.replace(/\s+/g, ' ').trim(),
      colorHex: t.color_hex,
      editions: editions.get(t.id) ?? 0,
      pastEditions: pastEditions.get(t.id) ?? 0,
      guests: guests.get(t.id) ?? 0,
      upcoming: upcoming.get(t.id) ?? 0,
    }))
    // Por gente que ya se sentó, no alfabético: el dueño busca "el que anda".
    .sort((a, b) => b.guests - a.guests || a.name.localeCompare(b.name, 'es'))

  return { options, truncated }
}
