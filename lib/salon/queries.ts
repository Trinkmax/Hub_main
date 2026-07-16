import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { aggregateMonthCapacity, type MonthCapacity } from './month-capacity'
import { computePeakWindow, type PeakWindow } from './peak'
import type {
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
  customer:customers(id, first_name, last_name, phone)
`

function normalizeJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

type ScheduledEventJoin = NonNullable<ReservationWithJoins['scheduled_event']>
type TemplateJoin = ScheduledEventJoin['template']

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
  base.customer = normalizeJoin(row.customer as ReservationWithJoins['customer'])
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
  status?: SalonReservationStatus | SalonReservationStatus[]
  managerId?: string
  q?: string // busca en guest_name
  page?: number
  pageSize?: number
}

export async function listSalonReservations(
  opts: ReservationFilters,
): Promise<{ rows: ReservationWithJoins[]; total: number }> {
  const supabase = (await createClient()) as SBAny
  const pageSize = opts.pageSize ?? 25
  const page = Math.max(1, opts.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let q = supabase
    .from('salon_reservations')
    .select(RESERVATION_JOIN_SELECT, { count: 'exact' })
    .eq('tenant_id', opts.tenantId)
    .order('reservation_date', { ascending: false })
    .order('reservation_time_local', { ascending: true })
    .range(from, to)

  if (opts.dateFrom) q = q.gte('reservation_date', opts.dateFrom)
  if (opts.dateTo) q = q.lte('reservation_date', opts.dateTo)
  if (opts.zone) q = q.eq('zone', opts.zone)
  if (opts.status) {
    if (Array.isArray(opts.status)) q = q.in('status', opts.status)
    else q = q.eq('status', opts.status)
  }
  if (opts.managerId) {
    q = q.or(`primary_manager_id.eq.${opts.managerId},assistant_manager_id.eq.${opts.managerId}`)
  }
  if (opts.q && opts.q.trim().length >= 2) {
    const safe = opts.q.trim().replace(/[%,]/g, '')
    q = q.ilike('guest_name', `%${safe}%`)
  }

  const { data, error, count } = await q
  if (error) throw error
  const rows = (data ?? []).map((r: Record<string, unknown>) => flattenReservation(r))
  return { rows, total: count ?? 0 }
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

/**
 * Capacidad agregada por día para un mes (YYYY-MM). Pensado para el badge
 * del calendario de salón. Resuelve con 3 lecturas (reservas del mes,
 * overrides, defaults) y delega el cómputo a `aggregateMonthCapacity`.
 */
export async function getMonthCapacity(opts: {
  tenantId: string
  ym: string // YYYY-MM
}): Promise<MonthCapacity> {
  const supabase = (await createClient()) as SBAny
  const [yStr, mStr] = opts.ym.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const from = `${opts.ym}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${opts.ym}-${String(lastDay).padStart(2, '0')}`

  const [resResult, overrides, defaults] = await Promise.all([
    supabase
      .from('salon_reservations')
      .select('reservation_date, zone, estimated_guests, actual_guests, status')
      .eq('tenant_id', opts.tenantId)
      .gte('reservation_date', from)
      .lte('reservation_date', to)
      .not('status', 'in', '(cancelled,no_show)'),
    listZoneOverrides({ tenantId: opts.tenantId, from, to }),
    getZoneCapacityDefaults({ tenantId: opts.tenantId }),
  ])
  if (resResult.error) throw resResult.error

  const reservations = (resResult.data ?? []) as Array<{
    reservation_date: string
    zone: SalonZone
    estimated_guests: number
    actual_guests: number | null
    status: SalonReservationStatus
  }>

  const physicalOverrides = overrides
    .filter((o) => o.zone === 'planta_alta' || o.zone === 'planta_baja')
    .map((o) => ({
      override_date: o.override_date,
      zone: o.zone as 'planta_alta' | 'planta_baja',
      capacity: o.capacity,
    }))

  return aggregateMonthCapacity({ reservations, overrides: physicalOverrides, defaults })
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
  guests_total: number
  base_cents: number
  bonus_cents: number
  payable_cents: number
  paid_cents: number
  pending_cents: number
}

export async function listCommissionSummary(opts: {
  tenantId: string
  from: string
  to: string
}): Promise<CommissionSummaryRow[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('commission_ledger')
    .select(
      `manager_id, guests_billed, base_total_cents, bonus_total_cents, payable_cents, paid_at,
       manager:reservation_managers(id, display_name),
       reservation:salon_reservations!inner(reservation_date)`,
    )
    .eq('tenant_id', opts.tenantId)
    .gte('reservation.reservation_date', opts.from)
    .lte('reservation.reservation_date', opts.to)

  if (error) throw error

  const grouped = new Map<string, CommissionSummaryRow>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
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
        base_cents: 0,
        bonus_cents: 0,
        payable_cents: 0,
        paid_cents: 0,
        pending_cents: 0,
      } as CommissionSummaryRow)
    cur.reservations_count += 1
    cur.guests_total += Number(row.guests_billed ?? 0)
    cur.base_cents += Number(row.base_total_cents ?? 0)
    cur.bonus_cents += Number(row.bonus_total_cents ?? 0)
    cur.payable_cents += Number(row.payable_cents ?? 0)
    if (row.paid_at) cur.paid_cents += Number(row.payable_cents ?? 0)
    else cur.pending_cents += Number(row.payable_cents ?? 0)
    grouped.set(mgr.id, cur)
  }
  return Array.from(grouped.values()).sort((a, b) => b.payable_cents - a.payable_cents)
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
}): Promise<CommissionBreakdownEntry[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('commission_ledger')
    .select(
      `*,
       reservation:salon_reservations!inner(
         id, guest_name, reservation_date, reservation_time_local,
         estimated_guests, actual_guests
       )`,
    )
    .eq('tenant_id', opts.tenantId)
    .eq('manager_id', opts.managerId)
    .gte('reservation.reservation_date', opts.from)
    .lte('reservation.reservation_date', opts.to)
    .order('calculated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => {
    const resRaw = r.reservation
    const reservation = Array.isArray(resRaw) ? resRaw[0] : resRaw
    return { ...(r as object), reservation } as CommissionBreakdownEntry
  })
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
 * Entradas del ledger de UN gestor para "Mis números" (mes calendario).
 * Client anon + RLS: el owner ve todo (`cl_owner_select`) y el gestor
 * vinculado ve solo lo suyo (`cl_manager_self_select`). Nunca service role.
 */
export async function listMyCommissionEntries(opts: {
  tenantId: string
  managerId: string
  monthStart: string // yyyy-MM-dd (inclusive)
  monthEnd: string // yyyy-MM-dd (inclusive)
}): Promise<CommissionBreakdownEntry[]> {
  const entries = await listCommissionBreakdown({
    tenantId: opts.tenantId,
    managerId: opts.managerId,
    from: opts.monthStart,
    to: opts.monthEnd,
  })
  // El breakdown ordena por calculated_at; acá queremos fecha de reserva desc.
  return entries.sort((a, b) => {
    if (a.reservation.reservation_date !== b.reservation.reservation_date) {
      return a.reservation.reservation_date < b.reservation.reservation_date ? 1 : -1
    }
    return a.calculated_at < b.calculated_at ? 1 : -1
  })
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

  const tiers = await listRateTiers({ tenantId: opts.tenantId })
  const bonus = await getBonusRule({ tenantId: opts.tenantId })

  let scheduledEvent: CommissionInputForEngine['scheduledEvent'] = null
  if (r.scheduled_event_id) {
    const { data: ev } = await supabase
      .from('scheduled_events')
      .select('capacity, full_bonus_active')
      .eq('id', r.scheduled_event_id as string)
      .maybeSingle()
    if (ev) {
      const { data: usage } = await supabase
        .from('salon_reservations')
        .select('estimated_guests, actual_guests')
        .eq('scheduled_event_id', r.scheduled_event_id as string)
        .not('status', 'in', '(cancelled,no_show)')
      const total = (usage ?? []).reduce(
        (acc: number, x: Record<string, unknown>) =>
          acc + Number((x.actual_guests as number) ?? (x.estimated_guests as number) ?? 0),
        0,
      )
      const e = ev as Record<string, unknown>
      scheduledEvent = {
        capacity: Number(e.capacity ?? 0),
        total_used: total,
        full_bonus_active: Boolean(e.full_bonus_active),
      }
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
