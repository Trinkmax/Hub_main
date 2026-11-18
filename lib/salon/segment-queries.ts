import 'server-only'
import { applyBranchFilter, type BranchFilter, WHOLE_BAR } from '@/lib/branches/filter'
import { createClient } from '@/lib/supabase/server'
import type { SegmentBranchScope } from './branch-scope'
import { instagramSearchTerm } from './instagram'
import {
  listScheduledEventsForDate,
  listTimelineForDate,
  type ScheduledEventWithTemplate,
} from './queries'
import {
  collectPages,
  isMissingTableError,
  mapSearchRow,
  type ReservationSearchResult,
  SEARCH_RES_SELECT,
  SEGMENT_RES_SELECT,
  searchTerms,
  toOverrideRows,
  toSegmentEventInput,
  toSegmentReservationInput,
  toSettingRows,
  toWeeklyCapRows,
  zoneCapsFromSettings,
} from './segment-rows'
import {
  computeMonthSegments,
  type DaySegmentCaps,
  type DaySegmentsSnapshot,
  type IsoDow,
  isoDowOf,
  type MonthSegments,
  NO_ZONE_CAPS,
  resolveDaySegmentCaps,
  resolveSegmentSettings,
  SEGMENT_KEYS,
  type SegmentConfig,
  type SegmentEventInput,
  type SegmentKey,
  type SegmentOverrideRow,
  type SegmentSettingRow,
  type SegmentSettingsResolved,
  type SegmentWeeklyCapRow,
  suggestedCapacityRaise,
  type ZoneCaps,
} from './segments'
import type { ReservationWithJoins } from './types'

/**
 * Capa server del cupo por servicio: junta filas y llama al cálculo puro de
 * `segments.ts`. NO calcula nada propio (y no hay RPC SQL, R8): si el número
 * saliera de dos lados, el mes y el día podrían no coincidir.
 *
 * Tolerancia a la migración pendiente: si las tablas de cupos todavía no
 * existen (el código llegó a producción antes que la migración), las lecturas
 * de config devuelven vacío y todo cae al cupo general PA + PB. El calendario
 * sigue andando con 130 por servicio en lugar de romperse.
 */

// Mismo patrón que el resto de lib/salon: el cliente tipado todavía no se usa
// en estas queries. Las filas se normalizan en `segment-rows.ts`.
// biome-ignore lint/suspicious/noExplicitAny: <generated types pending>
type SBAny = any

type PgError = { message: string; code?: string }
type TableResult = { data: Record<string, unknown>[] | null; error: PgError | null }

// ──────────────────────────────────────────────────────────
// Tipos de salida
// ──────────────────────────────────────────────────────────

export type DayOverview = {
  date: string
  isoDow: IsoDow
  reservations: ReservationWithJoins[] // incluye canceladas/no_show (se muestran atenuadas)
  events: ScheduledEventWithTemplate[]
  caps: DaySegmentCaps
  settings: SegmentSettingsResolved
  suggestedRaise: Record<SegmentKey, number | null>
  /** Cupo de cada planta, para el filtro de planta de la vista del día. */
  zoneCaps: ZoneCaps
}

export type SegmentEditorData = {
  weekly: SegmentWeeklyCapRow[]
  settings: SegmentSettingRow[]
  overrides: SegmentOverrideRow[] // desde today, orden asc
  fallbackTotal: number
}

// ──────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────

/** Tablas de las que ya se avisó que faltan (una vez por instancia, no por request). */
const warnedMissing = new Set<string>()

/**
 * Lee una tabla de config. Si la tabla no existe todavía, avisa una vez por
 * consola (solo el nombre de la tabla y el código: nada del bar ni de nadie) y
 * devuelve []. Cualquier otro error sube: un corte de red no es "sin config",
 * y usar el cupo general en silencio pintaría el semáforo con otro número.
 */
async function readConfigTable(
  table: string,
  query: PromiseLike<TableResult>,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await query
  if (error) {
    if (isMissingTableError(error)) {
      if (!warnedMissing.has(table)) {
        warnedMissing.add(table)
        console.warn('[salon.segments.config] tabla sin migrar, se usa el cupo general', {
          table,
          code: error.code,
        })
      }
      return []
    }
    throw Object.assign(new Error(error.message), { code: error.code })
  }
  return data ?? []
}

/**
 * El cupo de cada planta (`tenants.settings.salon_capacities`), del que sale
 * el cupo general PA + PB, con la misma política que `readConfigTable`: un
 * error SUBE con su código.
 *
 * No usa `getZoneCapacityDefaults` a propósito: ese helper devuelve 0 ante
 * cualquier error, y acá un 0 no es "cupo general" sino "sin tope". Un timeout
 * en esta lectura apagaba el semáforo de los días que caen al cupo general y
 * dejaba pasar sin confirmación una reserva con sobrecupo, sin ningún log.
 * Sin fila o sin `salon_capacities` sí es 0: el bar todavía no cargó el cupo.
 */
async function readZoneCaps(supabase: SBAny, tenantId: string): Promise<ZoneCaps> {
  const { data, error } = (await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle()) as { data: { settings?: unknown } | null; error: PgError | null }
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return zoneCapsFromSettings(data?.settings)
}

/**
 * Las 3 tablas de config + el cupo general en UN Promise.all.
 * `overridesFrom`/`overridesTo` acotan los especiales por fecha: el mes pide
 * su rango, el día una sola fecha y el editor "desde hoy" sin tope.
 *
 * La sucursal (docs/features/sucursales.md › el cupo nunca se suma):
 * - `scope.capacity` = una sucursal: su grilla, sus especiales y sus ajustes. Su
 *   cupo general es PA + PB si tiene plantas (la principal) o sus sillas
 *   (`branches.seat_capacity`) si no.
 * - `scope.capacity` = null («Todas»): sin cupo (cada servicio sin tope); viajan
 *   igual los ajustes y el cupo de cada planta de la sucursal con plantas, para
 *   las horas sugeridas y el filtro de planta.
 * - sin `scope`: el de siempre, todo el bar con PA + PB (Tex y las tareas). Hasta
 *   que haya una segunda sucursal con cupo propio da lo mismo que la principal.
 */
async function readSegmentConfig(opts: {
  tenantId: string
  scope?: SegmentBranchScope
  overridesFrom: string
  overridesTo?: string
}): Promise<SegmentConfig> {
  const supabase = (await createClient()) as SBAny
  const scope = opts.scope
  // La sucursal de la que se leen las filas de config; null = ninguna (sin cupo y sin ajustes).
  const configBranch = scope === undefined ? undefined : (scope.capacity ?? scope.floors)
  if (configBranch === null) {
    return {
      weekly: [],
      overrides: [],
      settings: [],
      fallbackTotal: 0,
      zoneCaps: { ...NO_ZONE_CAPS },
    }
  }
  const byBranch = <Q>(query: Q): Q =>
    configBranch ? ((query as SBAny).eq('branch_id', configBranch.id) as Q) : query
  // PA + PB son de la sucursal con plantas: sin plantas no hace falta leerlas.
  const readsZones = configBranch === undefined || configBranch.isDefault
  // En «Todas» no hay cupo: la grilla y los especiales ni se piden.
  const readsCaps = scope === undefined || scope.capacity !== null

  let overridesQuery = byBranch(
    supabase
      .from('salon_segment_capacity_overrides')
      .select('segment, override_date, capacity, warn_at, reason')
      .eq('tenant_id', opts.tenantId)
      .gte('override_date', opts.overridesFrom),
  )
  if (opts.overridesTo) overridesQuery = overridesQuery.lte('override_date', opts.overridesTo)
  overridesQuery = overridesQuery
    .order('override_date', { ascending: true })
    .order('segment', { ascending: true })

  const [weeklyRows, settingRows, overrideRows, zoneCaps] = await Promise.all([
    readsCaps
      ? readConfigTable(
          'salon_segment_capacities',
          byBranch(
            supabase
              .from('salon_segment_capacities')
              .select('segment, iso_dow, capacity, warn_at')
              .eq('tenant_id', opts.tenantId),
          ),
        )
      : Promise.resolve([]),
    readConfigTable(
      'salon_segment_settings',
      byBranch(
        supabase
          .from('salon_segment_settings')
          .select('segment, default_time, warn_note')
          .eq('tenant_id', opts.tenantId),
      ),
    ),
    readsCaps
      ? readConfigTable('salon_segment_capacity_overrides', overridesQuery)
      : Promise.resolve([]),
    readsZones ? readZoneCaps(supabase, opts.tenantId) : Promise.resolve({ ...NO_ZONE_CAPS }),
  ])

  // «Todas»: los ajustes y las plantas de la sucursal con plantas, sin ningún cupo.
  if (!readsCaps) {
    return {
      weekly: [],
      overrides: [],
      settings: toSettingRows(settingRows),
      fallbackTotal: 0,
      zoneCaps,
    }
  }

  // El cupo general: PA + PB con plantas; las sillas de la sucursal sin plantas (0 = sin cargar: sin tope).
  const fallbackTotal = readsZones
    ? zoneCaps.planta_alta + zoneCaps.planta_baja
    : Math.max(0, configBranch?.seatCapacity ?? 0)

  return {
    weekly: toWeeklyCapRows(weeklyRows),
    overrides: toOverrideRows(overrideRows),
    settings: toSettingRows(settingRows),
    // El cupo general por planta SIN los overrides por zona: esos quedaron sin
    // UI y los reemplaza el cupo especial por servicio. Las dos plantas por
    // separado viajan para el filtro de planta del calendario (misma lectura).
    fallbackTotal,
    zoneCaps,
  }
}

export async function getSegmentConfig(opts: {
  tenantId: string
  from: string
  to: string
  /** De qué sucursal es el cupo (ver `readSegmentConfig`). Sin decir, todo el bar (Tex). */
  scope?: SegmentBranchScope
}): Promise<SegmentConfig> {
  return readSegmentConfig({
    tenantId: opts.tenantId,
    scope: opts.scope,
    overridesFrom: opts.from,
    overridesTo: opts.to,
  })
}

/** Cupos resueltos de un día. Lo usan el operativo y el salón (el cálculo corre en el cliente). */
export async function getDaySegmentCaps(opts: {
  tenantId: string
  date: string
  /** Sin decir, todo el bar (Tex). En «Todas» cada servicio queda sin tope. */
  scope?: SegmentBranchScope
}): Promise<DaySegmentCaps> {
  const config = await getSegmentConfig({
    tenantId: opts.tenantId,
    from: opts.date,
    to: opts.date,
    scope: opts.scope,
  })
  return resolveDaySegmentCaps(opts.date, config)
}

// ──────────────────────────────────────────────────────────
// Día
// ──────────────────────────────────────────────────────────

/**
 * Lo mínimo para proyectar una reserva (form, vista rápida, confirmación D3):
 * las reservas ACTIVAS del día sin datos personales, los eventos reducidos y
 * los cupos resueltos. Todo en paralelo: es lo que se pide fresco al apretar
 * Guardar y no puede demorar el guardado.
 */
export async function getDaySegmentsSnapshot(opts: {
  tenantId: string
  date: string
  /** Las reservas, los eventos y el cupo de qué sucursal. Sin decir, todo el bar (Tex). */
  scope?: SegmentBranchScope
}): Promise<DaySegmentsSnapshot> {
  const supabase = (await createClient()) as SBAny
  const branch: BranchFilter = opts.scope?.filter ?? WHOLE_BAR
  const [rows, events, config] = await Promise.all([
    collectPages<Record<string, unknown>>((from, to) =>
      applyBranchFilter(
        supabase
          .from('salon_reservations')
          .select(SEGMENT_RES_SELECT)
          .eq('tenant_id', opts.tenantId)
          .eq('reservation_date', opts.date)
          .not('status', 'in', '(cancelled,no_show)'),
        branch,
      )
        .order('reservation_time_local', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    listScheduledEventsForDate({ tenantId: opts.tenantId, date: opts.date, branch }),
    getSegmentConfig({
      tenantId: opts.tenantId,
      from: opts.date,
      to: opts.date,
      scope: opts.scope,
    }),
  ])

  return {
    date: opts.date,
    caps: resolveDaySegmentCaps(opts.date, config),
    settings: resolveSegmentSettings(config.settings),
    reservations: rows.map(toSegmentReservationInput),
    events: events.map(toSegmentEventInput),
  }
}

/**
 * La vista del día en UNA lectura: reservas con joins (incluye canceladas y
 * "no vino", que se muestran atenuadas), eventos, cupos, ajustes y cuánto
 * conviene subir cada servicio. Antes eran 3 server actions que Next despacha
 * de a una: 3 viajes en el celular de la anfitriona.
 */
export async function getDayOverview(opts: {
  tenantId: string
  date: string
  /** Sin decir, todo el bar (Tex). En «Todas» el día se ve sin cupo. */
  scope?: SegmentBranchScope
}): Promise<DayOverview> {
  const branch: BranchFilter = opts.scope?.filter ?? WHOLE_BAR
  const [reservations, events, config] = await Promise.all([
    listTimelineForDate({ tenantId: opts.tenantId, date: opts.date, branch }),
    listScheduledEventsForDate({ tenantId: opts.tenantId, date: opts.date, branch }),
    getSegmentConfig({
      tenantId: opts.tenantId,
      from: opts.date,
      to: opts.date,
      scope: opts.scope,
    }),
  ])
  const caps = resolveDaySegmentCaps(opts.date, config)

  const suggestedRaise = {} as Record<SegmentKey, number | null>
  for (const key of SEGMENT_KEYS) {
    suggestedRaise[key] = suggestedCapacityRaise(config, key, caps[key].capacity)
  }

  return {
    date: opts.date,
    isoDow: isoDowOf(opts.date),
    reservations,
    events,
    caps,
    settings: resolveSegmentSettings(config.settings),
    suggestedRaise,
    zoneCaps: { ...(config.zoneCaps ?? NO_ZONE_CAPS) },
  }
}

// ──────────────────────────────────────────────────────────
// Mes
// ──────────────────────────────────────────────────────────

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/**
 * El mes por servicio. Reutiliza los eventos que la página ya trajo (no los
 * vuelve a pedir) y pagina las reservas: PostgREST corta en 1000 filas y un
 * mes cargado las pasa.
 */
export async function getMonthSegments(opts: {
  tenantId: string
  ym: string
  /** Los de la página, ya filtrados por la misma sucursal. */
  events: ReadonlyArray<SegmentEventInput>
  /** Sin decir, todo el bar. En «Todas» el mes cuenta gente sin cupo. */
  scope?: SegmentBranchScope
}): Promise<MonthSegments> {
  const match = YM_RE.exec(opts.ym)
  if (!match) throw new Error('getMonthSegments: mes inválido (YYYY-MM)')
  const lastDay = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
  const from = `${opts.ym}-01`
  const to = `${opts.ym}-${String(lastDay).padStart(2, '0')}`

  const supabase = (await createClient()) as SBAny
  const branch: BranchFilter = opts.scope?.filter ?? WHOLE_BAR
  const [rows, config] = await Promise.all([
    collectPages<Record<string, unknown>>((rangeFrom, rangeTo) =>
      applyBranchFilter(
        supabase
          .from('salon_reservations')
          .select(SEGMENT_RES_SELECT)
          .eq('tenant_id', opts.tenantId)
          .gte('reservation_date', from)
          .lte('reservation_date', to)
          .not('status', 'in', '(cancelled,no_show)'),
        branch,
      )
        // Orden por una clave única: sin orden estable dos páginas podrían
        // repetir o saltearse reservas.
        .order('reservation_date', { ascending: true })
        .order('id', { ascending: true })
        .range(rangeFrom, rangeTo),
    ),
    getSegmentConfig({ tenantId: opts.tenantId, from, to, scope: opts.scope }),
  ])

  return computeMonthSegments({
    ym: opts.ym,
    reservations: rows.map(toSegmentReservationInput),
    events: opts.events,
    config,
  })
}

// ──────────────────────────────────────────────────────────
// Configuración → Capacidad
// ──────────────────────────────────────────────────────────

/**
 * Lo que muestra el editor: la grilla semanal, los ajustes y los especiales desde hoy, de UNA sucursal (el editor
 * nunca mira «Todas»). Sin decir, todo el bar (Tex).
 */
export async function getSegmentEditorData(opts: {
  tenantId: string
  today: string
  scope?: SegmentBranchScope
}): Promise<SegmentEditorData> {
  const config = await readSegmentConfig({
    tenantId: opts.tenantId,
    scope: opts.scope,
    overridesFrom: opts.today,
  })
  return {
    weekly: config.weekly,
    settings: config.settings,
    overrides: config.overrides,
    fallbackTotal: config.fallbackTotal,
  }
}

// ──────────────────────────────────────────────────────────
// Buscador del calendario
// ──────────────────────────────────────────────────────────

/**
 * Reservas por nombre (ilike); si el texto trae 4 o más dígitos, también por
 * teléfono, y si puede ser un usuario de Instagram ("@juan.perez"), también por
 * ese usuario. Incluye canceladas: el resultado muestra el estado y abre el día.
 * Más recientes primero; dentro del mismo día, por hora.
 */
export async function searchReservationsByGuest(opts: {
  tenantId: string
  q: string
  limit?: number
  /** Sin decir, todo el bar (Tex). */
  branch?: BranchFilter
}): Promise<ReservationSearchResult[]> {
  const { name, digits } = searchTerms(opts.q)
  if (!name && !digits) return []
  const handle = instagramSearchTerm(opts.q)
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20)))

  const supabase = (await createClient()) as SBAny
  let query = applyBranchFilter(
    supabase.from('salon_reservations').select(SEARCH_RES_SELECT).eq('tenant_id', opts.tenantId),
    opts.branch ?? WHOLE_BAR,
  )
  if (digits || handle) {
    // `searchTerms` ya sacó `,` `(` `)` y `"`, y el usuario de Instagram solo
    // trae letras, números, punto y guion bajo: no pueden romper la sintaxis del or().
    const filters = [
      name ? `guest_name.ilike.%${name}%` : null,
      digits ? `guest_phone.ilike.%${digits}%` : null,
      handle ? `guest_instagram.ilike.%${handle}%` : null,
    ].filter((f): f is string => f !== null)
    query = query.or(filters.join(','))
  } else {
    query = query.ilike('guest_name', `%${name}%`)
  }
  const { data, error } = await query
    .order('reservation_date', { ascending: false })
    .order('reservation_time_local', { ascending: true })
    .limit(limit)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return ((data ?? []) as Record<string, unknown>[]).map((row) => mapSearchRow(row))
}
