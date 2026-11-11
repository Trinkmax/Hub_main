/**
 * El área Reservas, Calendario y Entradas de Tex. Lo que se fija: que lo que arma pase el zod de la
 * acción real, que los datos de contacto no salgan, que el cupo y el día de servicio digan lo mismo que
 * las pantallas, y lo que puede y no puede la anfitriona.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => undefined })),
  headers: vi.fn(async () => ({ get: () => 'bar.test' })),
}))
vi.mock('@/lib/salon/actions', () => ({
  cancelSalonReservation: vi.fn(),
  closeTable: vi.fn(),
  createSalonReservation: vi.fn(),
  deleteScheduledEvent: vi.fn(),
  moveScheduledEvent: vi.fn(),
  transitionStatus: vi.fn(),
  updateActualGuests: vi.fn(),
  updateReservationTableLabel: vi.fn(),
  updateSalonReservation: vi.fn(),
  upsertScheduledEvent: vi.fn(),
  upsertScheduledTemplate: vi.fn(),
}))
vi.mock('@/lib/salon/segment-actions', () => ({
  removeSegmentOverride: vi.fn(),
  saveSegmentConfig: vi.fn(),
  upsertSegmentOverride: vi.fn(),
}))
vi.mock('@/lib/salon/queries', () => ({
  getBonusRule: vi.fn(),
  getDepositsByDay: vi.fn(),
  getManagerForUser: vi.fn(),
  getRangeReservationTotals: vi.fn(),
  getSalonReservation: vi.fn(),
  getScheduledEvent: vi.fn(),
  listCakeOptions: vi.fn(),
  listCommissionBreakdown: vi.fn(),
  listCommissionSummary: vi.fn(),
  listManagers: vi.fn(),
  listMyCommissionEntries: vi.fn(),
  listRateTiers: vi.fn(),
  listSalonReservations: vi.fn(),
  listScheduledEventsForDate: vi.fn(),
  listScheduledEventsForDateRange: vi.fn(),
  listScheduledTemplates: vi.fn(),
  listTimelineForDate: vi.fn(),
}))
vi.mock('@/lib/salon/segment-queries', () => ({
  getDayOverview: vi.fn(),
  getDaySegmentsSnapshot: vi.fn(),
  getMonthSegments: vi.fn(),
  getSegmentEditorData: vi.fn(),
  searchReservationsByGuest: vi.fn(),
}))
vi.mock('@/lib/customers/queries', () => ({ getCustomerById: vi.fn() }))
vi.mock('@/lib/customers/search', () => ({ searchCustomers: vi.fn() }))
vi.mock('@/lib/flows/queries', () => ({ getFlow: vi.fn(), listFlows: vi.fn() }))
vi.mock('@/lib/ticketing/queries', () => ({
  getTicketingSettings: vi.fn(),
  listRecentOrders: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: vi.fn(async () => 'https://bar.test') }))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPreviewDocument: vi.fn(),
  runPostDocument: vi.fn(),
}))

import { resolveCommissionPeriod } from '@/lib/commissions/period'
import { searchCustomers } from '@/lib/customers/search'
import { getFlow, listFlows } from '@/lib/flows/queries'
import {
  cancelSalonReservation,
  closeTable,
  createSalonReservation,
  deleteScheduledEvent,
  moveScheduledEvent,
  transitionStatus,
  updateActualGuests,
  updateReservationTableLabel,
  updateSalonReservation,
  upsertScheduledEvent,
  upsertScheduledTemplate,
} from '@/lib/salon/actions'
import { aggregateDepositsByDay } from '@/lib/salon/deposits'
import { serviceDayInCordoba } from '@/lib/salon/operativo'
import {
  getManagerForUser,
  getSalonReservation,
  listCakeOptions,
  listManagers,
  listMyCommissionEntries,
  listSalonReservations,
  listScheduledEventsForDate,
  listScheduledEventsForDateRange,
  listScheduledTemplates,
  listTimelineForDate,
  type ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import {
  actualGuestsSchema,
  cancelReservationSchema,
  createSalonReservationSchema,
  reservationTableLabelSchema,
  scheduledEventSchema,
  scheduledTemplateSchema,
  transitionStatusSchema,
  updateSalonReservationSchema,
} from '@/lib/salon/schemas'
import { upsertSegmentOverride } from '@/lib/salon/segment-actions'
import {
  getDayOverview,
  getDaySegmentsSnapshot,
  getMonthSegments,
  searchReservationsByGuest,
} from '@/lib/salon/segment-queries'
import type { ReservationSearchResult } from '@/lib/salon/segment-rows'
import {
  calendarParamsSchema,
  newReservationParamsSchema,
  segmentConfigSaveSchema,
  segmentOverrideKeySchema,
  segmentOverrideSchema,
} from '@/lib/salon/segment-schemas'
import {
  computeDaySegments,
  computeMonthSegments,
  type DaySegments,
  type DaySegmentsSnapshot,
  eventLoadsById,
  projectReservation,
  resolveDaySegmentCaps,
  resolveSegmentSettings,
  type SegmentEventInput,
} from '@/lib/salon/segments'
import { overCapacityConfirmCopy } from '@/lib/salon/segments-copy'
import type {
  CakeOptionRow,
  ReservationManagerRow,
  ReservationWithJoins,
  ScheduledEventTemplateRow,
} from '@/lib/salon/types'
import { fullUpdatePayload } from '@/lib/salon/update-payload'
import type { TenantRole } from '@/lib/tenant/types'
import { agendaScreens } from '@/lib/tex/area-screens/agenda'
import { agendaArea } from '@/lib/tex/areas/agenda'
import { texScreenAllowed, texScreenHref, texScreensFor } from '@/lib/tex/screens'
import { texActionTools } from '@/lib/tex/tools/actions'
import {
  cancelEventDraft,
  cancelReservationDraft,
  capacityCheck,
  changeReservationDraft,
  changeReservationInput,
  eventDraft,
  eventInput,
  type NewReservationFacts,
  newReservationDraft,
  newReservationInput,
  specialCapacityDraft,
  statusChangeDraft,
  templateDraft,
  weeklyCapacityDraft,
} from '@/lib/tex/tools/agenda/_drafts'
import {
  agendaRange,
  boardData,
  commissionEntriesData,
  dawnNote,
  dayCapacityData,
  dayReservationsData,
  depositsData,
  entradasData,
  eventCard,
  filterDayRows,
  HEALTH_ALERT_NOTE,
  managerRow,
  monthsOfRange,
  ordersData,
  rangeDayRow,
  reservationCard,
  reservationRow,
  searchRow,
  seatCounts,
} from '@/lib/tex/tools/agenda/_read-data'
import { guestMatches, pickEvent, pickReservation } from '@/lib/tex/tools/agenda/_resolve'
import { maskPhone, redactContacts, toSimpleState } from '@/lib/tex/tools/agenda/_words'
import { agendaActionTools, agendaExecutors } from '@/lib/tex/tools/agenda/actions'
import { agendaManual } from '@/lib/tex/tools/agenda/manual'
import { agendaReadTools } from '@/lib/tex/tools/agenda/read'
import { texReadTools } from '@/lib/tex/tools/read'
import {
  type TexExecution,
  type TexPrepared,
  type TexTool,
  type TexToolContext,
  type TexToolResult,
  toInputSchema,
} from '@/lib/tex/tools/types'
import type { AdminOrder } from '@/lib/ticketing/queries'
import { getTicketingSettings, listRecentOrders } from '@/lib/ticketing/queries'

const TENANT = '00000000-0000-4000-8000-0000000000aa'
const USER = '00000000-0000-4000-8000-0000000000cc'
const RES = '00000000-0000-4000-8000-000000000001'
const RES2 = '00000000-0000-4000-8000-000000000002'
const MANAGER = '00000000-0000-4000-8000-000000000011'
const MANAGER2 = '00000000-0000-4000-8000-000000000012'
const EVENT = '00000000-0000-4000-8000-000000000021'
const TEMPLATE = '00000000-0000-4000-8000-000000000031'
const CAKE = '00000000-0000-4000-8000-000000000041'
const CUSTOMER = '00000000-0000-4000-8000-000000000051'

const PHONE = '+5493511234567'
const PHONE_LOCAL = '3511234567'
const DAY = '2026-11-07' // sábado

const CTX: TexToolContext = {
  slug: 'bar',
  tenantId: TENANT,
  tenantName: 'Un bar',
  userId: USER,
  role: 'owner',
  features: {} as never,
  isAccountant: false,
  access: { read: false, write: false, admin: false },
  today: '2026-11-05',
}
const HOST: TexToolContext = { ...CTX, role: 'host' }

function reservation(patch: Partial<ReservationWithJoins> = {}): ReservationWithJoins {
  return {
    id: RES,
    tenant_id: TENANT,
    customer_id: null,
    guest_name: 'Ana García',
    guest_phone: PHONE,
    guest_email: 'ana@example.com',
    guest_instagram: 'ana.garcia',
    kind: 'normal',
    meal_type: 'dinner',
    reservation_date: DAY,
    reservation_time_local: '21:00:00',
    reservation_end_time_local: null,
    zone: 'planta_alta',
    scheduled_event_id: null,
    estimated_guests: 4,
    actual_guests: null,
    cake_count: 0,
    cake_option_id: null,
    champagne_count: 0,
    deposit_cents: 0,
    origin: 'whatsapp',
    primary_manager_id: MANAGER,
    assistant_manager_id: null,
    comments: null,
    service_alerts: [],
    highlight_comment: false,
    table_label: null,
    status: 'pending',
    arrived_at: null,
    seated_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    arrived_by: null,
    seated_by: null,
    closed_by: null,
    created_by: null,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    primary_manager: { id: MANAGER, display_name: 'Marta' },
    assistant_manager: null,
    scheduled_event: null,
    customer: null,
    cake_option: null,
    ...patch,
  }
}

function event(patch: Partial<ScheduledEventWithTemplate> = {}): ScheduledEventWithTemplate {
  return {
    id: EVENT,
    tenant_id: TENANT,
    template_id: TEMPLATE,
    name_override: null,
    event_date: DAY,
    starts_at_local: '21:00:00',
    ends_at_local: '23:30:00',
    capacity: 40,
    meal_type: 'hub_event',
    full_bonus_active: true,
    attendance_points: 0,
    notes: null,
    private_group: false,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    template: {
      id: TEMPLATE,
      name: 'Noche temática',
      slug: 'noche-tematica',
      color_hex: '#7c3aed',
      default_capacity: 40,
      consume_special_reservations: true,
    },
    ...patch,
  }
}

function template(patch: Partial<ScheduledEventTemplateRow> = {}): ScheduledEventTemplateRow {
  return {
    id: TEMPLATE,
    tenant_id: TENANT,
    name: 'Noche temática',
    slug: 'noche-tematica',
    consume_special_reservations: true,
    default_capacity: 40,
    default_meal_type: 'dinner',
    color_hex: '#7c3aed',
    active: true,
    default_private_group: false,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    ...patch,
  }
}

function manager(patch: Partial<ReservationManagerRow> = {}): ReservationManagerRow {
  return {
    id: MANAGER,
    tenant_id: TENANT,
    user_id: USER,
    display_name: 'Marta',
    phone: '+5493519999999',
    email: 'marta@example.com',
    commission_eligible: true,
    active: true,
    notes: null,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    ...patch,
  }
}

const CAKE_ROW: CakeOptionRow = {
  id: CAKE,
  tenant_id: TENANT,
  name: 'Opción 1',
  base: 'Vainilla',
  fillings: ['Dulce de leche'],
  position: 0,
  active: true,
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-01T12:00:00Z',
}

function segmentEvent(e: ScheduledEventWithTemplate): SegmentEventInput {
  return {
    id: e.id,
    event_date: e.event_date,
    starts_at_local: e.starts_at_local,
    capacity: e.capacity,
    name_override: e.name_override,
    template: e.template ? { name: e.template.name, color_hex: e.template.color_hex } : null,
  }
}

function snapshot(
  rows: readonly ReservationWithJoins[] = [],
  events: readonly ScheduledEventWithTemplate[] = [],
  date = DAY,
  fallbackTotal = 120,
): DaySegmentsSnapshot {
  return {
    date,
    caps: resolveDaySegmentCaps(date, { weekly: [], overrides: [], settings: [], fallbackTotal }),
    settings: resolveSegmentSettings([]),
    reservations: rows.map((r) => ({ ...r })),
    events: events.map(segmentEvent),
  }
}

const dayOf = (s: DaySegmentsSnapshot): DaySegments => computeDaySegments(s)

function newFacts(patch: Partial<NewReservationFacts> = {}): NewReservationFacts {
  return {
    today: CTX.today,
    date: DAY,
    snapshot: snapshot(),
    settings: resolveSegmentSettings([]),
    event: null,
    dayEvents: [],
    template: null,
    manager: { id: MANAGER, name: 'Marta', eligible: true, assumed: false },
    assistant: null,
    cake: null,
    customer: null,
    eventFlow: null,
    ...patch,
  }
}

const changeFacts = (patch = {}) => ({
  snapshot: snapshot(),
  settings: resolveSegmentSettings([]),
  targetEvent: null,
  manager: null,
  cake: null,
  occupied: new Map<string, string>(),
  ...patch,
})

/** Lo que no puede aparecer en nada que lea el modelo. */
function expectNoContact(value: unknown) {
  const text = JSON.stringify(value)
  expect(text).not.toContain(PHONE_LOCAL)
  expect(text).not.toContain(PHONE)
  expect(text).not.toContain('ana@example.com')
  expect(text).not.toContain('marta@example.com')
  expect(text).not.toContain('5493519999999')
  expect(text).not.toContain('ana.garcia')
}

function toolNamed(tools: readonly TexTool[], name: string): TexTool {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`No está ${name}`)
  return tool
}

async function run(name: string, input: unknown, ctx = CTX): Promise<TexToolResult> {
  const tool = toolNamed(agendaArea.tools, name)
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) throw new Error(`Entrada inválida: ${parsed.error.message}`)
  return tool.run(parsed.data, ctx)
}

function asData(result: TexToolResult): Record<string, unknown> {
  if (result.kind !== 'data') throw new Error(`Se esperaba data: ${JSON.stringify(result)}`)
  return result.data as Record<string, unknown>
}

function asPrepared(result: TexToolResult): TexPrepared {
  if (result.kind !== 'prepared') throw new Error(`Se esperaba tique: ${JSON.stringify(result)}`)
  return result.prepared
}

function asError(result: TexToolResult): string {
  if (result.kind !== 'error') throw new Error(`Se esperaba error: ${JSON.stringify(result)}`)
  return result.message
}

function okDraft<T extends { ok: boolean }>(draft: T): Extract<T, { ok: true }> {
  if (!draft.ok) throw new Error(`El tique no se armó: ${JSON.stringify(draft)}`)
  return draft as Extract<T, { ok: true }>
}

function failDraft(draft: { ok: boolean; message?: string }): string {
  if (draft.ok) throw new Error('Se esperaba que no se arme')
  return draft.message ?? ''
}

function executor(name: string) {
  const found = agendaExecutors[name]
  if (!found) throw new Error(`No está el ejecutor ${name}`)
  return found
}

const execOk = (execution: TexExecution) => {
  if (!execution.ok) throw new Error(`Falló: ${JSON.stringify(execution)}`)
  return execution
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listFlows).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Las pantallas ───────────────────────────────────────────────────────────

const MANAGER_ROOT = resolve(__dirname, '../../app/(manager)/[tenantSlug]')

/** Una ruta con `:id` existe si hay una carpeta dinámica ahí, se llame como se llame. */
function pageOfRoot(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  let dir = MANAGER_ROOT
  for (const part of parts) {
    if (part === ':id') {
      const dynamic = readdirSync(dir).find((name) => /^\[[^\]]+\]$/.test(name))
      if (!dynamic) return null
      dir = join(dir, dynamic)
    } else {
      dir = join(dir, part)
    }
  }
  const page = join(dir, 'page.tsx')
  return existsSync(page) ? page : null
}

/** Dónde lee cada pantalla lo que declara. Si deja de leerlo, o se declara uno sin mirar, esto falla. */
const READS: Readonly<Record<string, Readonly<Record<string, readonly [string, RegExp]>>>> = {
  'reservas.lista': {
    q: ['reservas/page.tsx', /const q = typeof sp\.q === 'string'/],
    fecha: ['reservas/page.tsx', /isoDayOrUndefined\(sp\.day\)/],
    desde: ['reservas/page.tsx', /isoDayOrUndefined\(sp\.from\)/],
    hasta: ['reservas/page.tsx', /isoDayOrUndefined\(sp\.to\)/],
  },
  'reservas.nueva': { fecha: ['reservas/nuevo/page.tsx', /newReservationParamsSchema\.safeParse/] },
  'operativo.tablero': { fecha: ['operativo/page.tsx', /typeof sp\.date === 'string'/] },
  'eventos.calendario': {
    tab: ['eventos/programados/page.tsx', /sp\.tab === 'eventos'/],
    mes: ['eventos/programados/page.tsx', /sp\.month/],
    fecha: ['eventos/programados/page.tsx', /sp\.day/],
  },
  'eventos.nuevo': {
    fecha: ['eventos/programados/nuevo/page.tsx', /typeof sp\.date === 'string'/],
  },
  'comisiones.mis_numeros': {
    mes: ['mis-numeros/page.tsx', /typeof sp\.month === 'string'/],
    desde: ['mis-numeros/page.tsx', /typeof sp\.from === 'string'/],
    hasta: ['mis-numeros/page.tsx', /typeof sp\.to === 'string'/],
  },
  'ventas.lista': { hasta: ['ventas-online/page.tsx', /salesPage\(hasta, now\)/] },
  'comisiones.liquidacion': {
    mes: ['estadisticas/comisiones/page.tsx', /typeof sp\.month === 'string'/],
    desde: ['estadisticas/comisiones/page.tsx', /typeof sp\.from === 'string'/],
    hasta: ['estadisticas/comisiones/page.tsx', /typeof sp\.to === 'string'/],
  },
  'comisiones.gestor': {
    mes: ['estadisticas/comisiones/[managerId]/page.tsx', /typeof sp\.month === 'string'/],
    desde: ['estadisticas/comisiones/[managerId]/page.tsx', /typeof sp\.from === 'string'/],
    hasta: ['estadisticas/comisiones/[managerId]/page.tsx', /typeof sp\.to === 'string'/],
  },
  'senas.reporte': { mes: ['estadisticas/senas/page.tsx', /typeof sp\.month === 'string'/] },
  'comisiones.config': {
    tab: ['configuracion/comisiones/page.tsx', /typeof sp\.tab === 'string'/],
  },
}

describe('las pantallas', () => {
  const ROUTES = [
    '/reservas',
    '/reservas/:id',
    '/reservas/nuevo',
    '/operativo',
    '/eventos',
    '/eventos/programados',
    '/eventos/programados/:id',
    '/eventos/programados/importar',
    '/eventos/programados/nuevo',
    '/eventos/templates',
    '/mis-numeros',
    '/entradas',
    '/entradas/:id',
    '/ventas-online',
    '/ventas-online/funciones',
    '/estadisticas/comisiones',
    '/estadisticas/comisiones/:id',
    '/estadisticas/senas',
    '/configuracion/comisiones',
    '/configuracion/tortas',
  ]

  it('están todas las del área', () => {
    expect(agendaScreens.map((s) => s.path).sort()).toEqual([...ROUTES].sort())
  })

  it.each(agendaScreens.map((s) => [s.id, s.path] as const))('%s existe: %s', (_id, path) => {
    expect(pageOfRoot(path), path).not.toBeNull()
  })

  it('los ids son `area.cosa`, sin repetir, y todas son de afuera de Administración', () => {
    const ids = agendaScreens.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const screen of agendaScreens) {
      expect(screen.id).toMatch(/^[a-z]+\.[a-z_]+$/)
      expect(screen.root).toBe(true)
      expect(screen.what.length).toBeGreaterThan(10)
    }
  })

  it('el :id de la ruta va declarado, y al revés', () => {
    for (const screen of agendaScreens) {
      expect(screen.path.includes(':id'), screen.id).toBe(screen.params?.includes('id') ?? false)
    }
  })

  const declared = agendaScreens.flatMap((screen) =>
    (screen.params ?? []).filter((p) => p !== 'id').map((param) => [screen.id, param] as const),
  )

  it.each(declared)('%s lee %s', (id, param) => {
    const evidence = READS[id]?.[param]
    expect(evidence, `Falta mirar dónde lee ${param} ${id}`).toBeDefined()
    if (!evidence) return
    const [file, pattern] = evidence
    expect(readFileSync(join(MANAGER_ROOT, file), 'utf8')).toMatch(pattern)
  })

  it('la tabla no tiene nada que ya no se declare', () => {
    for (const [id, params] of Object.entries(READS)) {
      for (const param of Object.keys(params)) {
        expect(declared.some(([screen, p]) => screen === id && p === param)).toBe(true)
      }
    }
  })

  it('las solapas son las que la pantalla acepta', () => {
    const calendar = agendaScreens.find((s) => s.id === 'eventos.calendario')
    for (const tab of calendar?.tabs ?? []) {
      expect(calendarParamsSchema.safeParse({ tab }).data?.tab).toBe(tab)
    }
    const config = agendaScreens.find((s) => s.id === 'comisiones.config')
    const page = readFileSync(join(MANAGER_ROOT, 'configuracion/comisiones/page.tsx'), 'utf8')
    expect(page).toContain(`const TABS = ['tarifas', 'bonus', 'gestores'] as const`)
    expect(config?.tabs).toEqual(['tarifas', 'bonus', 'gestores'])
  })

  it('cada período va con el nombre que lee la pantalla', () => {
    // `/reservas?day=`, `/operativo?date=`, `/eventos/programados?month=`, comisiones `?from=&to=`.
    // Mandarle `?mes=` o `?fecha=` abriría otro período creyendo que es el pedido.
    for (const screen of agendaScreens) {
      for (const name of ['mes', 'desde', 'hasta', 'fecha'] as const) {
        if (screen.params?.includes(name)) expect(screen.urlNames?.[name], screen.id).toBeDefined()
      }
      expect(screen.params?.includes('semana') ?? false, screen.id).toBe(false)
      expect(screen.params?.includes('cuenta') ?? false, screen.id).toBe(false)
    }
    expect(newReservationParamsSchema.safeParse({ date: DAY }).data?.date).toBe(DAY)
    expect(calendarParamsSchema.safeParse({ month: '2026-11', day: DAY }).data).toMatchObject({
      month: '2026-11',
      day: DAY,
    })
  })

  it('arma los links debajo del bar, sin pasar por Administración', () => {
    expect(texScreenHref('bar', 'reservas.lista', { q: 'Ana' })).toMatchObject({
      href: '/bar/reservas?q=Ana',
    })
    expect(texScreenHref('bar', 'reservas.ficha', { id: RES })).toMatchObject({
      href: `/bar/reservas/${RES}`,
    })
    expect(texScreenHref('bar', 'entradas.pelicula', { id: RES })).toMatchObject({
      href: `/bar/entradas/${RES}`,
    })
    expect(texScreenHref('bar', 'eventos.calendario', { tab: 'eventos' })).toMatchObject({
      href: '/bar/eventos/programados?tab=eventos',
    })
    expect(texScreenHref('bar', 'comisiones.config', { tab: 'gestores' })).toMatchObject({
      href: '/bar/configuracion/comisiones?tab=gestores',
    })
    // Lo que la pantalla no lee no llega a la URL.
    expect(texScreenHref('bar', 'operativo.tablero', { fecha: DAY, mes: '2026-11' })).toMatchObject(
      {
        href: `/bar/operativo?date=${DAY}`,
      },
    )
    expect(texScreenHref('bar', 'eventos.calendario', { tab: 'cualquiera' })).toMatchObject({
      href: '/bar/eventos/programados',
    })
  })

  it.each([
    '../../../login',
    '//evil.test',
    'javascript:alert(1)',
    `${RES}/../../..`,
    '?x=1#y',
  ])('un dato raro no saca a nadie del bar: %j', (value) => {
    for (const screen of agendaScreens) {
      const needsId = screen.path.includes(':id')
      const link = texScreenHref('bar', screen.id, {
        id: needsId ? RES : value,
        tab: value,
      })
      if (!link.ok) throw new Error(link.error)
      const url = new URL(link.href, 'https://bar.test')
      expect(url.origin).toBe('https://bar.test')
      expect(url.pathname.startsWith('/bar/')).toBe(true)
      expect(link.href).not.toContain('..')
      expect(link.href).not.toContain('evil')
    }
  })
})

// ─── Quién ve qué ────────────────────────────────────────────────────────────

const allowedTools = (role: TenantRole) =>
  agendaArea.tools
    .filter((tool) => typeof tool.need === 'object' && tool.need.roles.includes(role))
    .map((tool) => tool.name)

const viewer = (role: TenantRole) => ({ role, features: {}, accounting: false })

describe('la anfitriona', () => {
  it('ve el área; Contenido y la contadora, no', () => {
    expect(agendaArea.visible(HOST)).toBe(true)
    expect(agendaArea.visible(CTX)).toBe(true)
    expect(agendaArea.visible({ ...CTX, role: 'editor' })).toBe(false)
    expect(agendaArea.visible({ ...CTX, role: 'accountant', isAccountant: true })).toBe(false)
  })

  it('llega solo a reservas, eventos, operativo, mis números y ventas online', () => {
    const screens = texScreensFor(viewer('host')).filter((s) => agendaScreens.includes(s))
    expect(screens.map((s) => s.path.split('/')[1])).toEqual([
      'reservas',
      'reservas',
      'reservas',
      'operativo',
      'eventos',
      'eventos',
      'eventos',
      'eventos',
      'eventos',
      'eventos',
      'mis-numeros',
      'ventas-online',
      'ventas-online',
    ])
  })

  it('marcado de punta a punta: lo del dueño dice `roles` aunque el proxy ya lo frene', () => {
    for (const id of [
      'entradas.lista',
      'entradas.pelicula',
      'comisiones.liquidacion',
      'comisiones.gestor',
      'senas.reporte',
      'comisiones.config',
      'tortas.config',
    ]) {
      const screen = agendaScreens.find((s) => s.id === id)
      if (!screen) throw new Error(id)
      expect(screen.roles, id).toEqual(['owner'])
      expect(texScreenAllowed(screen, viewer('host')), id).toBe(false)
      expect(texScreenAllowed(screen, viewer('owner')), id).toBe(true)
    }
  })

  it('no mira la plata de otros ni las ventas de entradas', () => {
    const host = allowedTools('host')
    for (const name of [
      'ver_comisiones',
      'ver_tarifas_comision',
      'ver_senas',
      'ver_entradas',
      'ver_ventas_entradas',
      'preparar_cupo_especial',
      'preparar_cupo_semanal',
    ]) {
      expect(host, name).not.toContain(name)
    }
  })

  it('maneja las reservas y los eventos, y ve sus propios números', () => {
    const host = allowedTools('host')
    for (const name of [
      'ver_reservas',
      'buscar_reserva',
      'ver_reserva',
      'ver_cupo',
      'ver_tablero',
      'ver_eventos',
      'ver_evento',
      'ver_formatos',
      'ver_tortas',
      'ver_gestores',
      'ver_mis_numeros',
      'preparar_reserva',
      'preparar_cambio_reserva',
      'preparar_estado_reserva',
      'preparar_cancelar_reserva',
      'preparar_evento',
      'preparar_cancelar_evento',
      'preparar_formato',
    ]) {
      expect(host, name).toContain(name)
    }
  })

  it('el dueño usa todas; Contenido y la contadora, ninguna', () => {
    expect(allowedTools('owner')).toHaveLength(agendaArea.tools.length)
    expect(allowedTools('editor')).toEqual([])
    expect(allowedTools('accountant')).toEqual([])
  })
})

// ─── Las herramientas ────────────────────────────────────────────────────────

describe('las herramientas', () => {
  it('no chocan entre sí ni con las de Administración', () => {
    const names = agendaArea.tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    const others = new Set([...texReadTools, ...texActionTools].map((t) => t.name))
    for (const name of names) expect(others.has(name), name).toBe(false)
  })

  it.each(agendaReadTools.map((t) => [t.name, t] as const))('%s se puede describir', (_n, tool) => {
    expect(tool.name).toMatch(/^(ver|buscar)_[a-z_]+$/)
    expect(tool.mood).toBeUndefined()
    expect(tool.description.length).toBeLessThan(300)
    const schema = toInputSchema(tool.input)
    expect(schema.type).toBe('object')
    expect(JSON.stringify(schema).length).toBeLessThan(1400)
  })

  it.each(agendaActionTools.map((t) => [t.name, t] as const))('%s no guarda nada', (_n, tool) => {
    expect(tool.name).toMatch(/^preparar_[a-z_]+$/)
    expect(tool.description).toContain('No guarda nada')
    expect(tool.mood).toBe('working')
    const schema = toInputSchema(tool.input)
    expect(schema.type).toBe('object')
    expect(JSON.stringify(schema).length).toBeLessThan(3000)
  })

  it('los ejecutores se llaman `agenda.cosa`', () => {
    for (const name of Object.keys(agendaArea.executors)) {
      expect(name).toMatch(/^agenda\.[a-z_]+$/)
    }
  })

  it('las descripciones y el manual no nombran a un bar', () => {
    const text = [agendaManual, ...agendaArea.tools.map((t) => t.description)].join('\n')
    expect(text).not.toMatch(/\bHUB\b|\bHub\b|Luz|Nacho|Sushi|Pizza libre|Shrek|Ratatou/)
  })

  it('nada del área usa el cliente de servicio', () => {
    const dir = resolve(__dirname, '../../lib/tex/tools/agenda')
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/from '@\/lib\/supabase\/service'/)
      expect(source, file).not.toMatch(/createServiceClient\(/)
      // Las dos consultas de la pantalla de Entradas que por adentro usan el cliente de servicio.
      expect(source, file).not.toMatch(/getAdminOverview\(|getAdminExperience\(/)
      expect(source, file).not.toMatch(/\.rpc\('ticketing_event_seats'/)
    }
  })

  it('las lecturas sueltas filtran por el bar', () => {
    const source = readFileSync(
      resolve(__dirname, '../../lib/tex/tools/agenda/_entradas.ts'),
      'utf8',
    )
    const from = source.match(/\.from\('/g)?.length ?? 0
    const tenant = source.match(/\.eq\('tenant_id', ctx\.tenantId\)/g)?.length ?? 0
    expect(from).toBe(3)
    expect(tenant).toBe(from)
  })
})

describe('el manual', () => {
  it('entra en lo pedido y cuenta lo que hay que saber', () => {
    expect(agendaManual.length).toBeLessThan(6500)
    for (const word of [
      'cupo',
      'Sin ubicar',
      'No vino',
      'las 5',
      'comisión',
      'Señas',
      'Grupo privado',
      'WhatsApp',
      'Mercado Pago',
    ]) {
      expect(agendaManual).toContain(word)
    }
  })

  it('no trae precios', () => {
    expect(agendaManual).not.toMatch(/\$\s?\d/)
  })

  it('dice lo que Tex no hace', () => {
    for (const word of [
      'Devolver plata',
      'confirmar transferencias',
      'anular entradas',
      'conectar Mercado Pago',
      'Excel',
    ]) {
      expect(agendaManual).toContain(word)
    }
  })
})

// ─── Los datos de contacto ───────────────────────────────────────────────────

describe('los datos de contacto no viajan', () => {
  it('maskPhone deja los últimos 4', () => {
    expect(maskPhone(PHONE)).toBe('…4567')
    expect(maskPhone('12')).toBeNull()
    expect(maskPhone(null)).toBeNull()
  })

  it.each([
    ['llamar al +54 9 351 123-4567 antes', 'llamar al …4567 antes'],
    ['mail: ana@example.com', 'mail: [mail]'],
    ['Resta cobrar $25.000 el día del evento', 'Resta cobrar $25.000 el día del evento'],
    ['Pagó 20000 de seña', 'Pagó 20000 de seña'],
    ['Mesa 12+13', 'Mesa 12+13'],
  ])('redactContacts: %s', (text, expected) => {
    expect(redactContacts(text)).toBe(expected)
  })

  const full = reservation({
    customer_id: CUSTOMER,
    comments: `Llamar al ${PHONE} o a ana@example.com`,
    cancelled_reason: `Avisó desde ${PHONE}`,
    customer: {
      id: CUSTOMER,
      first_name: 'Ana',
      last_name: 'García',
      phone: PHONE,
      service_alerts: ['celiac'],
      points_balance: 120,
      tier: { name: 'Gold', color: null },
    },
  })

  it('una fila y la ficha de una reserva', () => {
    expectNoContact(reservationRow(full))
    expectNoContact(reservationCard(full))
    expect(reservationCard(full)).toMatchObject({
      telefono_termina_en: '…4567',
      tiene_mail: true,
      tiene_instagram: true,
    })
    // Lo de salud no viaja a la API: Tex sabe que hay un aviso y lleva a verlo.
    expect(reservationRow(full)).toMatchObject({ avisos: [HEALTH_ALERT_NOTE] })
    expect(JSON.stringify(reservationRow(full))).not.toContain('TACC')
  })

  it('el día, el tablero y el evento', () => {
    const twin = reservation({ id: RES2, guest_phone: '+5493517654321' })
    const rows = [full, twin]
    const day = dayOf(snapshot(rows))
    expectNoContact(dayReservationsData({ date: DAY, rows, filtered: rows, day, note: null }))
    const board = boardData({
      date: DAY,
      serviceDay: DAY,
      rows,
      day,
      clock: 20 * 60,
      nowText: '20:00',
      afterMidnight: false,
      ver: 'todas',
    })
    expectNoContact(board)
    // Dos con el mismo nombre: se distinguen por los últimos 4, como el tablero.
    expect(JSON.stringify(board)).toContain('…4567')
    expect(JSON.stringify(board)).toContain('…4321')
    expectNoContact(eventCard(event(), rows))
  })

  it('un resultado de búsqueda', () => {
    const row: ReservationSearchResult = {
      id: RES,
      guest_name: `Ana ${PHONE}`,
      reservation_date: DAY,
      reservation_time_local: '21:00',
      guests: 4,
      status: 'pending',
      segment: 'dinner',
      eventName: null,
    }
    expectNoContact(searchRow(row))
  })

  it('los gestores', () => {
    const row = managerRow(manager(), MANAGER)
    expectNoContact(row)
    expect(row).toMatchObject({ nombre: 'Marta', vos: true, cobra_comision: true })
  })

  it('las ventas online', () => {
    const order = (patch: Partial<AdminOrder>): AdminOrder => ({
      id: RES,
      title: 'Una película',
      event_date: DAY,
      event_time: '21:00:00',
      party_size: 2,
      payment_option: 'deposit',
      total_cents: 4_000_000,
      paid_cents: 4_000_000,
      guest_name: 'Ana García',
      guest_phone: PHONE,
      status: 'approved',
      hold_expires_at: '2026-11-05T12:00:00Z',
      reservation_id: RES2,
      attention: null,
      mp_status_detail: 'accredited',
      mp_payment_type: 'credit_card',
      created_at: '2026-11-04T12:00:00Z',
      paid_at: '2026-11-04T12:00:00Z',
      reservation: null,
      undo: null,
      ...patch,
    })
    const data = ordersData({
      orders: [order({}), order({ id: RES2, guest_phone: '+5493517654321' })],
      now: new Date('2026-11-05T15:00:00Z'),
      read: 60,
    })
    expectNoContact(data)
    expect(JSON.stringify(data)).toContain('…4321')
    expect(data).toMatchObject({ cobrado: '$ 80.000', personas_pagas: 4, cuantas: 2 })
  })

  it('el tique de una reserva nueva lo muestra entero: lo ve solo quien lo pidió, y lo tiene que revisar', () => {
    const draft = okDraft(
      newReservationDraft(
        newReservationInput.parse({ nombre: 'Ana García', personas: 4, telefono: PHONE_LOCAL }),
        newFacts(),
      ),
    )
    expect(JSON.stringify(draft.ticket)).toContain('+54 9 351 123-4567')
    // Lo que recibe la acción, y como lo guarda el formulario.
    expect(draft.payload.values.guest_phone).toBe(PHONE)
  })

  it.each([
    PHONE_LOCAL,
    '351 123-4567',
    '+54 9 351 123 4567',
    PHONE,
  ])('un teléfono se guarda igual que en el formulario: %s', (telefono) => {
    const draft = okDraft(
      newReservationDraft(
        newReservationInput.parse({ nombre: 'Ana García', personas: 4, telefono }),
        newFacts(),
      ),
    )
    expect(createSalonReservationSchema.parse(draft.payload.values).guest_phone).toBe(PHONE)
  })

  it('el tique de un cambio también', () => {
    const draft = okDraft(
      changeReservationDraft(
        reservation({ guest_phone: null }),
        changeReservationInput.parse({ reserva: RES, telefono: PHONE }),
        changeFacts(),
      ),
    )
    expect(JSON.stringify(draft.ticket)).toContain('+54 9 351 123-4567')
    expect(draft.payload.patch.guest_phone).toBe(PHONE)
  })

  it('lo que devuelve un ejecutor a Tex tampoco: transitionStatus trae la fila entera', async () => {
    vi.mocked(transitionStatus).mockResolvedValue({
      ok: true,
      data: { row: { id: RES, guest_phone: PHONE, guest_email: 'ana@example.com' } },
    })
    const execution = execOk(
      await executor('agenda.estado_reserva').run(
        { id: RES, to: 'arrived', actual_guests: 4, date: DAY, name: 'Ana García' },
        CTX,
      ),
    )
    expectNoContact(execution.data)
    expect(execution.data).toEqual({ id: RES })
  })

  it('tampoco el error de una opción ambigua', () => {
    const rows: ReservationSearchResult[] = [
      {
        id: RES,
        guest_name: `Ana ${PHONE}`,
        reservation_date: DAY,
        reservation_time_local: '21:00',
        guests: 4,
        status: 'pending',
        segment: 'dinner',
        eventName: null,
      },
      {
        id: RES2,
        guest_name: `Ana ${PHONE}`,
        reservation_date: DAY,
        reservation_time_local: '13:00',
        guests: 2,
        status: 'pending',
        segment: 'lunch',
        eventName: null,
      },
    ]
    const picked = pickReservation(rows, { wanted: 'Ana', from: CTX.today })
    expect(picked).toMatchObject({ ok: false })
    expectNoContact(picked)
  })
})

// ─── Una reserva nueva ───────────────────────────────────────────────────────

describe('preparar una reserva', () => {
  const draftOf = (input: Record<string, unknown>, facts: Partial<NewReservationFacts> = {}) =>
    newReservationDraft(
      newReservationInput.parse({ nombre: 'Ana García', personas: 4, ...input }),
      newFacts(facts),
    )

  it('pasa el zod de la acción real', () => {
    const { payload, ticket } = okDraft(
      draftOf(
        {
          telefono: PHONE_LOCAL,
          instagram: '@Ana.Garcia',
          hora: '21:30',
          planta: 'baja',
          tipo: 'cumpleanos',
          tortas: 1,
          champagne: 1,
          sena: 10_000,
          origen: 'instagram',
          nota: 'Mesa larga',
          destacar: true,
          avisos: ['celiaco'],
        },
        { cake: CAKE_ROW },
      ),
    )
    const parsed = createSalonReservationSchema.parse(payload.values)
    expect(parsed).toMatchObject({
      guest_name: 'Ana García',
      guest_phone: PHONE,
      guest_instagram: 'ana.garcia',
      kind: 'birthday',
      meal_type: 'dinner',
      reservation_date: DAY,
      reservation_time_local: '21:30:00',
      zone: 'planta_baja',
      estimated_guests: 4,
      cake_count: 1,
      cake_option_id: CAKE,
      champagne_count: 1,
      deposit_cents: 1_000_000,
      origin: 'instagram',
      primary_manager_id: MANAGER,
      comments: 'Mesa larga',
      service_alerts: ['celiac'],
      highlight_comment: true,
    })
    expect(ticket).toMatchObject({
      kind: 'reserva',
      title: 'Nueva reserva',
      subtitle: 'Ana García',
      total: { label: 'Personas', value: '4' },
      entry: [],
      confirmLabel: 'Reservar para 4',
    })
    expect(ticket.rows.find((r) => r.label === 'Seña')?.value).toBe('$ 10.000')
    expect(ticket.rows.find((r) => r.label === 'Dónde')?.value).toBe('Planta Baja')
  })

  it('sin nada, como el formulario: la cena a su hora, en Planta Alta, por WhatsApp', () => {
    const { payload } = okDraft(draftOf({}))
    expect(createSalonReservationSchema.parse(payload.values)).toMatchObject({
      meal_type: 'dinner',
      reservation_time_local: '21:00:00',
      zone: 'planta_alta',
      origin: 'whatsapp',
      kind: 'normal',
    })
  })

  it('la hora decide el servicio, y sin hora va la sugerida del servicio', () => {
    expect(okDraft(draftOf({ hora: '13:30' })).payload.values.meal_type).toBe('lunch')
    const merienda = okDraft(draftOf({ servicio: 'merienda' })).payload.values
    expect(merienda).toMatchObject({ meal_type: 'tea_time', reservation_time_local: '15:30' })
    const dawn = okDraft(draftOf({ hora: '00:30' })).payload.values
    expect(dawn.meal_type).toBe('dinner')
  })

  it('si dice una hora de otro servicio, manda la hora y el tique lo aclara', () => {
    const draft = okDraft(draftOf({ hora: '21:00', servicio: 'almuerzo' }))
    expect(draft.payload.values.meal_type).toBe('dinner')
    expect(draft.ticket.warnings.map((w) => w.key)).toContain('time_service')
  })

  it('adentro de un evento: su servicio por la hora, sin planta y a su hora', () => {
    const e = event({ meal_type: 'hub_event', starts_at_local: '20:30:00' })
    const { payload, ticket } = okDraft(
      draftOf(
        { evento: 'Noche temática' },
        { event: e, dayEvents: [e], snapshot: snapshot([], [e]) },
      ),
    )
    expect(createSalonReservationSchema.parse(payload.values)).toMatchObject({
      meal_type: 'dinner',
      zone: 'event_floating',
      scheduled_event_id: EVENT,
      reservation_time_local: '20:30:00',
      reservation_end_time_local: '23:30:00',
    })
    expect(ticket.rows.find((r) => r.label === 'Dónde')?.value).toBe('Noche temática')
    expect(ticket.warnings).toEqual([])
  })

  it('con planta adentro de un evento sigue siendo del evento', () => {
    const e = event()
    const { payload, ticket } = okDraft(draftOf({ planta: 'alta' }, { event: e, dayEvents: [e] }))
    expect(payload.values).toMatchObject({ zone: 'planta_alta', scheduled_event_id: EVENT })
    expect(ticket.rows.find((r) => r.label === 'Dónde')?.value).toBe('Noche temática · Planta Alta')
  })

  it('avisa si ese servicio tiene un evento y la reserva queda afuera', () => {
    const e = event()
    const draft = okDraft(draftOf({}, { dayEvents: [e], snapshot: snapshot([], [e]) }))
    expect(draft.ticket.warnings.map((w) => w.key)).toContain('outside_event')
    const lunch = okDraft(
      draftOf({ hora: '13:00' }, { dayEvents: [e], snapshot: snapshot([], [e]) }),
    )
    expect(lunch.ticket.warnings.map((w) => w.key)).not.toContain('outside_event')
  })

  it('un formato que ese día no está se programa como grupo privado, y el tique lo dice', () => {
    const t = template({ default_capacity: null })
    const { payload, ticket } = okDraft(
      draftOf({ formato: 'Noche temática', hora: '21:00' }, { template: t }),
    )
    expect(createSalonReservationSchema.parse(payload.values)).toMatchObject({
      kind: 'special',
      requested_template_id: TEMPLATE,
      zone: 'event_floating',
    })
    const warning = ticket.warnings.find((w) => w.key === 'new_private_date')
    expect(warning?.title).toContain('grupo privado')
    expect(warning?.body).toContain('cupo 30')
    expect(payload.candidate.virtualEvent).toMatchObject({ capacity: 30 })
  })

  it('un formato en una reserva normal no se puede', () => {
    expect(
      failDraft(draftOf({ formato: 'Noche temática', tipo: 'normal' }, { template: template() })),
    ).toContain('cumple')
  })

  it('pide lo que falta en vez de inventarlo', () => {
    expect(
      failDraft(newReservationDraft(newReservationInput.parse({ personas: 4 }), newFacts())),
    ).toContain('a nombre de quién')
    expect(failDraft(draftOf({}, { date: '2026-02-31' }))).toContain('no existe')
    expect(failDraft(draftOf({ telefono: '123456' }))).toContain('Teléfono inválido')
    expect(failDraft(draftOf({ instagram: 'no vale con espacios' }))).toContain('Instagram')
  })

  it('una fecha que ya pasó avisa', () => {
    const draft = okDraft(
      draftOf({}, { date: '2026-11-01', snapshot: snapshot([], [], '2026-11-01') }),
    )
    expect(draft.ticket.warnings.map((w) => w.key)).toContain('past')
  })

  it('un gestor que nadie dijo se aclara, porque de eso sale la comisión', () => {
    const assumed = { id: MANAGER2, name: 'Pedro', eligible: true, assumed: true }
    const draft = okDraft(draftOf({}, { manager: assumed }))
    const warning = draft.ticket.warnings.find((w) => w.key === 'manager_assumed')
    expect(warning?.title).toBe('Queda a nombre de Pedro')
    expect(draft.ticket.rows.find((r) => r.label === 'Gestor')?.value).toBe(
      'Pedro (cobra comisión)',
    )
    const noCommission = okDraft(draftOf({}, { manager: { ...assumed, eligible: false } }))
    expect(noCommission.ticket.warnings.map((w) => w.key)).not.toContain('manager_assumed')
    const self = okDraft(draftOf({}, { manager: { ...assumed, assumed: false } }))
    expect(self.ticket.warnings.map((w) => w.key)).not.toContain('manager_assumed')
  })

  it('con asistente, los dos gestores no pueden ser el mismo', () => {
    const same = { id: MANAGER, name: 'Marta', eligible: true, assumed: false }
    expect(failDraft(draftOf({}, { assistant: same }))).toContain('asistente')
  })

  it('una ficha de cliente trae sus avisos y su teléfono', () => {
    const customer = { id: CUSTOMER, name: 'Ana García', phone: PHONE, alerts: ['celiac'] as const }
    const { payload, ticket } = okDraft(draftOf({ nombre: undefined }, { customer }))
    expect(createSalonReservationSchema.parse(payload.values)).toMatchObject({
      customer_id: CUSTOMER,
      guest_name: 'Ana García',
      guest_phone: PHONE,
      service_alerts: ['celiac'],
    })
    expect(ticket.rows.find((r) => r.label === 'Cliente')?.value).toBe('Ya es cliente (…4567)')
  })

  it('con teléfono nuevo, el tique dice que crea la ficha', () => {
    const { ticket } = okDraft(draftOf({ telefono: PHONE_LOCAL }))
    expect(ticket.rows.find((r) => r.label === 'Cliente')?.value).toBe(
      '+54 9 351 123-4567 · se le crea la ficha',
    )
  })

  describe('el WhatsApp al cliente', () => {
    const flow = { name: 'Recordatorio', hoursBefore: 24 }
    const e = event()

    it('el tique lo dice si la reserva entra al flow', () => {
      const draft = okDraft(
        draftOf({ telefono: PHONE_LOCAL }, { event: e, dayEvents: [e], eventFlow: flow }),
      )
      const warning = draft.ticket.warnings.find((w) => w.key === 'event_flow')
      expect(warning?.title).toContain('WhatsApp')
      expect(warning?.body).toContain('24 h antes')
    })

    it('sin evento, sin contacto o sin flow, no', () => {
      const keys = (draft: ReturnType<typeof draftOf>) =>
        okDraft(draft).ticket.warnings.map((w) => w.key)
      expect(keys(draftOf({ telefono: PHONE_LOCAL }, { eventFlow: flow }))).not.toContain(
        'event_flow',
      )
      expect(keys(draftOf({}, { event: e, dayEvents: [e], eventFlow: flow }))).not.toContain(
        'event_flow',
      )
      expect(keys(draftOf({ telefono: PHONE_LOCAL }, { event: e, dayEvents: [e] }))).not.toContain(
        'event_flow',
      )
    })
  })
})

// ─── El cupo ─────────────────────────────────────────────────────────────────

describe('el cupo', () => {
  const crowd = (guests: number, patch: Partial<ReservationWithJoins> = {}) =>
    reservation({ id: RES2, estimated_guests: guests, ...patch })

  const candidate = (patch = {}) => ({
    reservation_date: DAY,
    meal_type: 'dinner' as const,
    reservation_time_local: '21:00',
    scheduled_event_id: null,
    zone: 'planta_alta' as const,
    guests: 4,
    kind: 'normal' as const,
    cake_count: 0,
    ...patch,
  })

  it('el aviso dice lo mismo que el formulario', () => {
    const snap = snapshot([crowd(118)])
    const projection = projectReservation(snap, candidate())
    if (!projection) throw new Error('sin proyección')
    const copy = overCapacityConfirmCopy(projection)
    const check = capacityCheck(snap, candidate())
    expect(check.over).toBe(true)
    expect(check.warnings[0]).toMatchObject({
      key: 'over_capacity',
      title: copy.title,
      body: copy.body,
    })
    expect(check.warnings[0]?.title).toBe('Te pasás del cupo de la cena')
    expect(check.warnings[0]?.body).toBe('Quedarían 122 de 120 (2 de más).')
    expect(check.rows[0]).toEqual({ label: 'Cómo queda', value: 'Cena · 122 de 120' })
  })

  it('el tique se pasa de cupo: avisa y no bloquea', () => {
    const { payload, ticket } = okDraft(
      newReservationDraft(
        newReservationInput.parse({ nombre: 'Ana', personas: 6 }),
        newFacts({ snapshot: snapshot([crowd(118)]) }),
      ),
    )
    expect(ticket.warnings[0]?.key).toBe('over_capacity')
    expect(ticket.confirmLabel).toBe('Cargar igual para 6')
    expect(payload.capacityAck).toBe(true)
  })

  it('con lugar, no molesta', () => {
    const check = capacityCheck(snapshot([crowd(100)]), candidate())
    expect(check).toMatchObject({ over: false, warnings: [] })
    expect(check.rows[0]?.value).toBe('Cena · 104 de 120')
  })

  it('adentro de un evento que tiene lugar apartado no pregunta', () => {
    const e = event({ capacity: 40 })
    const snap = snapshot([crowd(78)], [e])
    expect(capacityCheck(snap, candidate({ scheduled_event_id: EVENT })).over).toBe(false)
    // La misma reserva, afuera del evento, pisa lo apartado: 78 + 40 + 4 = 122 de 120.
    const outside = capacityCheck(snap, candidate())
    expect(outside.over).toBe(true)
    expect(outside.warnings[0]?.body).toContain('apartados 40 lugares')
  })

  it('un evento que se pasa de su cupo se avisa aunque el servicio aguante', () => {
    const e = event({ capacity: 5 })
    const inEvent = crowd(4, { scheduled_event_id: EVENT })
    const check = capacityCheck(snapshot([inEvent], [e]), candidate({ scheduled_event_id: EVENT }))
    expect(check.over).toBe(false)
    expect(check.warnings[0]).toMatchObject({
      key: 'event_over',
      title: 'Noche temática quedaría 8/5',
    })
  })

  it('un servicio cerrado pregunta', () => {
    const snap = snapshot()
    snap.caps.dinner = { ...snap.caps.dinner, capacity: 0, source: 'override' }
    expect(capacityCheck(snap, candidate()).over).toBe(true)
  })

  it('si no se pudo leer, se dice y se puede guardar igual', () => {
    const check = capacityCheck(null, candidate())
    expect(check.over).toBe(false)
    expect(check.warnings[0]?.key).toBe('no_capacity')
  })

  it('ver_cupo: por servicio, con los libres que quedan para reservas normales', () => {
    const e = event({ capacity: 40 })
    const data = dayCapacityData(dayOf(snapshot([crowd(30)], [e]))) as {
      dia: string
      dia_semana: string
      servicios: Array<Record<string, unknown>>
    }
    expect(data.dia).toBe('07/11/2026')
    expect(data.dia_semana).toBe('sábado')
    expect(data.servicios.map((s) => s.servicio)).toEqual(['Almuerzo', 'Merienda', 'Cena'])
    expect(data.servicios[2]).toMatchObject({
      personas: 30,
      cupo: 120,
      libres: 50,
      reservas: 1,
      normales: '30 de 80',
    })
    expect(data.servicios[2]?.eventos).toEqual([
      expect.objectContaining({
        id: EVENT,
        nombre: 'Noche temática',
        cupo: 40,
        personas: 0,
        libres: 40,
      }),
    ])
  })

  it('el desayuno aparece solo el día que tiene algo', () => {
    const breakfast = crowd(5, { meal_type: 'breakfast', reservation_time_local: '09:30:00' })
    const data = dayCapacityData(dayOf(snapshot([breakfast]))) as {
      servicios: Array<{ servicio: string }>
    }
    expect(data.servicios.map((s) => s.servicio)).toEqual([
      'Desayuno',
      'Almuerzo',
      'Merienda',
      'Cena',
    ])
  })

  it('sin tope lo dice, y cupo 0 es cerrado', () => {
    const open = dayCapacityData(dayOf(snapshot([], [], DAY, 0))) as {
      servicios: Array<Record<string, unknown>>
    }
    expect(open.servicios[2]).toMatchObject({ cupo: 'sin tope', estado: 'Sin tope' })
    expect(open.servicios[2]).not.toHaveProperty('libres')
    const snap = snapshot()
    snap.caps.lunch = { ...snap.caps.lunch, capacity: 0, source: 'override' }
    const closed = dayCapacityData(dayOf(snap)) as { servicios: Array<Record<string, unknown>> }
    expect(closed.servicios[0]).toMatchObject({ cupo: 0, estado: 'Cerrado', libres: 0 })
  })
})

// ─── Mirar reservas ──────────────────────────────────────────────────────────

describe('las reservas de un día', () => {
  const rows = [
    reservation({ id: RES, estimated_guests: 4 }),
    reservation({
      id: RES2,
      guest_name: 'Pedro',
      guest_phone: null,
      guest_instagram: null,
      meal_type: 'lunch',
      reservation_time_local: '13:00:00',
      estimated_guests: 2,
    }),
    reservation({
      id: '00000000-0000-4000-8000-000000000003',
      guest_name: 'Cancelada',
      guest_instagram: null,
      status: 'cancelled',
      estimated_guests: 10,
    }),
    reservation({
      id: '00000000-0000-4000-8000-000000000004',
      guest_name: 'No vino',
      guest_instagram: null,
      status: 'no_show',
      estimated_guests: 8,
    }),
  ]
  const day = dayOf(snapshot(rows))

  it('da las personas por servicio, sin canceladas ni no vino', () => {
    const data = dayReservationsData({
      date: DAY,
      rows,
      filtered: filterDayRows(rows, {}),
      day,
      note: null,
    }) as Record<string, unknown> & {
      servicios: Array<Record<string, unknown>>
      filas: Array<Record<string, unknown>>
    }
    expect(data).toMatchObject({
      dia: '07/11/2026',
      reservas: 2,
      personas: 6,
      canceladas: 1,
      no_vinieron: 1,
    })
    expect(data.servicios.map((s) => [s.servicio, s.personas])).toEqual([
      ['Almuerzo', 2],
      ['Cena', 4],
    ])
    // Como la pantalla: la lista saca las canceladas y deja las que no vinieron.
    expect(data.filas.map((f) => f.nombre)).toEqual(['Pedro', 'Ana García', 'No vino'])
  })

  it('filtra como la lista', () => {
    const names = (filters: Parameters<typeof filterDayRows>[1]) =>
      filterDayRows(rows, filters).map((r) => r.guest_name)
    expect(names({ servicio: 'almuerzo' })).toEqual(['Pedro'])
    expect(names({ estado: 'cancelada' })).toEqual(['Cancelada'])
    expect(names({ buscar: 'garcia' })).toEqual(['Ana García'])
    expect(names({ planta: 'baja' })).toEqual([])
    expect(names({ tipo: 'cumpleanos' })).toEqual([])
    expect(names({ gestorId: MANAGER2 })).toEqual([])
  })

  it('la reserva en un evento cuenta en el servicio del evento', () => {
    const inEvent = reservation({
      meal_type: 'lunch',
      scheduled_event_id: EVENT,
      scheduled_event: {
        id: EVENT,
        capacity: 40,
        starts_at_local: '21:00:00',
        meal_type: 'lunch',
        template: {
          id: TEMPLATE,
          name: 'Noche temática',
          slug: 'x',
          color_hex: '#000000',
          consume_special_reservations: true,
        },
      },
    })
    expect(reservationRow(inEvent)).toMatchObject({
      servicio: 'Cena',
      lugar: 'Noche temática · Planta Alta',
    })
    expect(filterDayRows([inEvent], { servicio: 'cena' })).toHaveLength(1)
  })

  it('cuando ya contaron, muestra los que vinieron y lo reservado', () => {
    expect(reservationRow(reservation({ actual_guests: 6, status: 'arrived' }))).toMatchObject({
      personas: 6,
      reservadas: 4,
      estado: 'Llegó',
    })
  })

  it('un día de un rango se lee como el calendario', () => {
    expect(rangeDayRow(day)).toEqual({
      fecha: '07/11/2026',
      dia: 'sábado',
      servicios: 'Alm 2/120 · Cena 4/120',
    })
  })

  it('el mes de los eventos sale de la misma cuenta que el calendario', () => {
    const e = event()
    const month = computeMonthSegments({
      ym: '2026-11',
      reservations: [reservation({ scheduled_event_id: EVENT, estimated_guests: 12 })],
      events: [segmentEvent(e)],
      config: { weekly: [], overrides: [], settings: [], fallbackTotal: 120 },
    })
    expect(eventLoadsById(month.days)[EVENT]).toMatchObject({ used: 12, reservations: 1 })
  })
})

describe('los períodos', () => {
  it('sin nada, para adelante; con una punta, hasta fin de mes', () => {
    expect(agendaRange({}, CTX.today)).toMatchObject({
      ok: true,
      from: '2026-11-05',
      to: '2027-01-04',
    })
    expect(agendaRange({ desde: '2026-11-10' }, CTX.today)).toMatchObject({
      from: '2026-11-10',
      to: '2026-11-30',
    })
    expect(agendaRange({ hasta: '2026-11-20' }, CTX.today)).toMatchObject({
      from: '2026-11-05',
      to: '2026-11-20',
    })
    expect(agendaRange({ mes: '2026-12' }, CTX.today)).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })

  it('lo que no existe vuelve con su mensaje', () => {
    expect(agendaRange({ mes: '2026-13' }, CTX.today)).toMatchObject({ ok: false })
    expect(agendaRange({ desde: '2026-02-31' }, CTX.today)).toMatchObject({ ok: false })
  })

  it('los meses de un rango', () => {
    expect(monthsOfRange('2026-10-28', '2026-11-02')).toEqual(['2026-10', '2026-11'])
    expect(monthsOfRange('2026-12-01', '2027-02-01')).toEqual(['2026-12', '2027-01', '2027-02'])
    // Los 60 días que se miran por defecto pueden tocar cuatro: ver_eventos no puede rebotar eso.
    expect(agendaRange({}, '2027-01-31')).toMatchObject({ from: '2027-01-31', to: '2027-04-01' })
    expect(monthsOfRange('2027-01-31', '2027-04-01')).toHaveLength(4)
  })
})

// ─── El día de servicio ──────────────────────────────────────────────────────

describe('el día de servicio', () => {
  const late = reservation({ id: RES2, guest_name: 'Tarde', reservation_time_local: '20:00:00' })
  const onTime = reservation({ reservation_time_local: '00:30:00' })
  const inside = reservation({
    id: '00000000-0000-4000-8000-000000000003',
    guest_name: 'Adentro',
    status: 'arrived',
    table_label: '12',
  })

  /** Sábado 07/11 01:30 en Córdoba es 04:30 UTC del mismo día. La noche anterior es la del viernes. */
  const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) })

  it('hasta las 5 AM sigue siendo la noche anterior', () => {
    at('2026-11-08T04:30:00Z') // domingo 01:30 en Córdoba
    expect(serviceDayInCordoba()).toBe('2026-11-07')
    at('2026-11-08T08:00:00Z') // domingo 05:00 en Córdoba
    expect(serviceDayInCordoba()).toBe('2026-11-08')
  })

  it('ver_tablero abre la noche del sábado a la 1:30 del domingo, con el reloj corrido', async () => {
    at('2026-11-08T04:30:00Z')
    const rows = [late, onTime, inside]
    vi.mocked(getDayOverview).mockResolvedValue({
      date: DAY,
      isoDow: 6,
      reservations: rows,
      events: [],
      caps: snapshot().caps,
      settings: resolveSegmentSettings([]),
      suggestedRaise: { breakfast: null, lunch: null, tea_time: null, dinner: null },
      zoneCaps: { planta_alta: 60, planta_baja: 60 },
    })
    const data = asData(await run('ver_tablero', {}, HOST)) as Record<string, unknown> & {
      filas: Array<Record<string, unknown>>
    }
    expect(getDayOverview).toHaveBeenCalledWith({ tenantId: TENANT, date: DAY })
    expect(data).toMatchObject({
      dia: '07/11/2026',
      hora: '01:30',
      por_llegar: { reservas: 2, personas: 8, atrasadas: 2 },
      adentro: { reservas: 1, personas: 4 },
      total: { reservas: 3, personas: 12 },
    })
    expect(String(data.nota)).toContain('Pasó la medianoche')
    expect(data.filas.map((f) => [f.nombre, f.cuando, f.atrasada])).toEqual([
      ['Tarde', 'hace 5 h 30', true],
      ['Ana García', 'hace 1 h', true],
    ])
  })

  it('a la noche, lo que llega pronto no está atrasado', () => {
    const data = boardData({
      date: DAY,
      serviceDay: DAY,
      rows: [late, onTime, inside],
      day: dayOf(snapshot([late, onTime, inside])),
      clock: 20 * 60 + 5,
      nowText: '20:05',
      afterMidnight: false,
      ver: 'adentro',
    }) as { filas: Array<Record<string, unknown>>; por_llegar: unknown; nota?: string }
    expect(data.filas.map((f) => [f.nombre, f.mesa])).toEqual([['Adentro', '12']])
    expect(data.por_llegar).toEqual({ reservas: 2, personas: 8, atrasadas: 0 })
    expect(data.nota).toBeUndefined()
  })

  it('otro día no tiene reloj: nadie está atrasado', () => {
    const data = boardData({
      date: '2026-11-20',
      serviceDay: DAY,
      rows: [late],
      day: dayOf(snapshot([late])),
      clock: null,
      nowText: '20:05',
      afterMidnight: false,
      ver: 'por_llegar',
    }) as { filas: Array<Record<string, unknown>>; nota?: string; hora?: string }
    expect(data.filas[0]).not.toHaveProperty('cuando')
    expect(data.filas[0]).not.toHaveProperty('atrasada')
    expect(data.hora).toBeUndefined()
    expect(data.nota).toContain('todavía no llegó')
  })

  it('con una búsqueda se ignora el filtro, como en el tablero', () => {
    const data = boardData({
      date: DAY,
      serviceDay: DAY,
      rows: [late, onTime, inside],
      day: dayOf(snapshot([late, onTime, inside])),
      clock: null,
      nowText: '',
      afterMidnight: false,
      ver: 'por_llegar',
      buscar: 'adentro',
    }) as { filas: Array<Record<string, unknown>>; mostrando: string }
    expect(data.filas.map((f) => f.nombre)).toEqual(['Adentro'])
    expect(data.mostrando).toContain('adentro')
  })

  it('ver_reservas usa el día calendario, como la pantalla, y avisa a la madrugada', async () => {
    at('2026-11-08T04:30:00Z')
    vi.mocked(getDayOverview).mockResolvedValue({
      date: '2026-11-08',
      isoDow: 7,
      reservations: [],
      events: [],
      caps: snapshot([], [], '2026-11-08').caps,
      settings: resolveSegmentSettings([]),
      suggestedRaise: { breakfast: null, lunch: null, tea_time: null, dinner: null },
      zoneCaps: { planta_alta: 60, planta_baja: 60 },
    })
    const data = asData(await run('ver_reservas', {}, { ...HOST, today: '2026-11-08' }))
    expect(getDayOverview).toHaveBeenCalledWith({ tenantId: TENANT, date: '2026-11-08' })
    expect(String(data.nota)).toContain('sigue en la noche del 07/11/2026')
  })

  it('la nota de la madrugada no aparece si pidieron un día, ni de día', () => {
    expect(dawnNote(DAY, '2026-11-08', true)).toBeNull()
    expect(dawnNote(DAY, DAY, false)).toBeNull()
    expect(dawnNote(DAY, '2026-11-08', false)).toContain('07/11/2026')
  })

  it('un nombre se busca desde el día de servicio: a la 1:30 la cena de anoche cuenta', () => {
    const rows: ReservationSearchResult[] = [
      {
        id: RES,
        guest_name: 'Ana García',
        reservation_date: DAY,
        reservation_time_local: '21:00',
        guests: 4,
        status: 'pending',
        segment: 'dinner',
        eventName: null,
      },
      {
        id: RES2,
        guest_name: 'Ana García',
        reservation_date: '2026-10-01',
        reservation_time_local: '21:00',
        guests: 4,
        status: 'closed',
        segment: 'dinner',
        eventName: null,
      },
    ]
    expect(pickReservation(rows, { wanted: 'Ana', from: DAY })).toEqual({ ok: true, id: RES })
  })
})

// ─── Encontrar por nombre ────────────────────────────────────────────────────

describe('encontrar por nombre', () => {
  const row = (id: string, name: string, date = DAY, patch = {}): ReservationSearchResult => ({
    id,
    guest_name: name,
    reservation_date: date,
    reservation_time_local: '21:00',
    guests: 4,
    status: 'pending',
    segment: 'dinner',
    eventName: null,
    ...patch,
  })

  it('un nombre exacto le gana a uno parecido', () => {
    const rows = [row(RES, 'Ana García'), row(RES2, 'Ana García Pérez')]
    expect(pickReservation(rows, { wanted: 'ana garcia', from: CTX.today })).toEqual({
      ok: true,
      id: RES,
    })
  })

  it('si hay varias, vuelve con las opciones y el id', () => {
    const rows = [row(RES, 'Ana García'), row(RES2, 'Ana López', '2026-11-08')]
    const picked = pickReservation(rows, { wanted: 'Ana', from: CTX.today })
    expect(picked).toMatchObject({ ok: false })
    if (picked?.ok !== false) throw new Error('debería fallar')
    expect(picked.message).toContain(RES)
    expect(picked.message).toContain(RES2)
    expect(picked.message).toContain('07/11/2026')
    expect(picked.message).toContain('Preguntale cuál')
  })

  it('una fecha las separa', () => {
    const rows = [row(RES, 'Ana García'), row(RES2, 'Ana García', '2026-11-08')]
    expect(pickReservation(rows, { wanted: 'Ana', onDate: '2026-11-08', from: CTX.today })).toEqual(
      {
        ok: true,
        id: RES2,
      },
    )
    expect(
      pickReservation(rows, { wanted: 'Ana', onDate: '2026-11-09', from: CTX.today }),
    ).toBeNull()
  })

  it('las canceladas no se eligen', () => {
    const rows = [row(RES, 'Ana', DAY, { status: 'cancelled' }), row(RES2, 'Ana')]
    expect(pickReservation(rows, { wanted: 'Ana', from: CTX.today })).toEqual({
      ok: true,
      id: RES2,
    })
    expect(
      pickReservation([rows[0] as ReservationSearchResult], { wanted: 'Ana', from: CTX.today }),
    ).toBeNull()
  })

  it('para mirar, una cancelada vale si no hay otra', () => {
    const cancelled = row(RES, 'Ana', DAY, { status: 'cancelled' })
    expect(
      pickReservation([cancelled], { wanted: 'Ana', from: CTX.today, orCancelled: true }),
    ).toEqual({ ok: true, id: RES })
    expect(
      pickReservation([cancelled, row(RES2, 'Ana')], {
        wanted: 'Ana',
        from: CTX.today,
        orCancelled: true,
      }),
    ).toEqual({ ok: true, id: RES2 })
  })

  it('sin reservas para adelante, se queda con la que haya', () => {
    const rows = [row(RES, 'Ana', '2026-10-01', { status: 'closed' })]
    expect(pickReservation(rows, { wanted: 'Ana', from: CTX.today })).toEqual({ ok: true, id: RES })
  })

  it('«garcia» encuentra «García» en lo que se mira a mano', () => {
    expect(guestMatches(reservation(), 'garcia')).toBe(true)
    expect(guestMatches(reservation(), 'ana garcia')).toBe(true)
    expect(guestMatches(reservation(), 'Marta')).toBe(false)
  })

  it('buscar_reserva vuelve a mirar sin tildes si el nombre exacto no dio nada', async () => {
    vi.mocked(searchReservationsByGuest).mockResolvedValue([])
    vi.mocked(listSalonReservations).mockResolvedValue({ rows: [reservation()], total: 1 })
    const data = asData(await run('buscar_reserva', { buscar: 'garcia' }, HOST)) as {
      filas: Array<Record<string, unknown>>
    }
    expect(data.filas).toEqual([
      expect.objectContaining({
        id: RES,
        nombre: 'Ana García',
        fecha: '07/11/2026',
        hora: '21:00',
      }),
    ])
    expectNoContact(data)
  })

  it('un evento por nombre, con sus fechas si hay más de uno', () => {
    const a = event()
    const b = event({ id: RES2, event_date: '2026-11-14' })
    expect(pickEvent([a], 'noche tematica')).toMatchObject({ ok: true })
    const many = pickEvent([a, b], 'noche')
    if (many.ok) throw new Error('debería fallar')
    expect(many.message).toContain('07/11/2026')
    expect(many.message).toContain('14/11/2026')
    const none = pickEvent([a], 'otra cosa')
    if (none.ok) throw new Error('debería fallar')
    expect(none.message).toContain('Noche temática')
    const empty = pickEvent([], 'otra cosa')
    if (empty.ok) throw new Error('debería fallar')
    expect(empty.message).toContain('no hay eventos')
  })
})

// ─── Cambiar, marcar y cancelar ──────────────────────────────────────────────

describe('cambiar una reserva', () => {
  const draftOf = (r: ReservationWithJoins, input: Record<string, unknown>, facts = {}) =>
    changeReservationDraft(
      r,
      changeReservationInput.parse({ reserva: r.id, ...input }),
      changeFacts(facts),
    )

  it('lo que arma pasa el zod de la acción y no pisa nada más', () => {
    const r = reservation({
      comments: 'Es celíaca',
      service_alerts: ['celiac'],
      cake_count: 1,
      cake_option_id: CAKE,
      table_label: '12',
      deposit_cents: 500_000,
    })
    const { payload } = okDraft(draftOf(r, { personas: 6 }))
    expect(payload.save).toBe('completa')
    expect(payload.patch).toEqual({ estimated_guests: 6 })
    const parsed = updateSalonReservationSchema.parse(fullUpdatePayload(r, payload.patch))
    expect(parsed).toMatchObject({
      id: RES,
      estimated_guests: 6,
      comments: 'Es celíaca',
      service_alerts: ['celiac'],
      cake_count: 1,
      cake_option_id: CAKE,
      table_label: '12',
      deposit_cents: 500_000,
      guest_phone: PHONE,
    })
  })

  it('mover la hora a otro servicio mueve el servicio, como la vista rápida', () => {
    const { payload, ticket } = okDraft(draftOf(reservation(), { hora: '13:00' }))
    expect(payload.patch).toEqual({ reservation_time_local: '13:00', meal_type: 'lunch' })
    expect(ticket.rows).toEqual(
      expect.arrayContaining([
        { label: 'Hora', value: '21:00 → 13:00' },
        { label: 'Servicio', value: 'Cena → Almuerzo' },
      ]),
    )
    expect(ticket.confirmLabel).toBe('Guardar los cambios')
  })

  it('una hora del mismo servicio no toca el servicio', () => {
    expect(okDraft(draftOf(reservation(), { hora: '22:00' })).payload.patch).toEqual({
      reservation_time_local: '22:00',
    })
  })

  it('pasar de servicio sin decir la hora pone la sugerida', () => {
    expect(okDraft(draftOf(reservation(), { servicio: 'almuerzo' })).payload.patch).toEqual({
      reservation_time_local: '13:00',
      meal_type: 'lunch',
    })
  })

  it('la mesa sola va por su acción chica', () => {
    const { payload, ticket } = okDraft(draftOf(reservation(), { mesa: ' 12 + 13 ' }))
    expect(payload).toMatchObject({
      save: 'mesa',
      patch: { table_label: '12 + 13' },
      candidate: null,
    })
    expect(reservationTableLabelSchema.safeParse({ id: RES, table_label: '12 + 13' }).success).toBe(
      true,
    )
    expect(ticket.rows).toEqual([{ label: 'Mesa', value: 'Sin mesa → 12 + 13' }])
  })

  it('vacía saca la mesa', () => {
    const { payload } = okDraft(draftOf(reservation({ table_label: '12' }), { mesa: '' }))
    expect(payload.patch).toEqual({ table_label: null })
  })

  it('avisa si esa mesa ya la tiene otra reserva, sin bloquear', () => {
    const { ticket } = okDraft(
      draftOf(reservation(), { mesa: '12+13' }, { occupied: new Map([['13', 'Pedro']]) }),
    )
    expect(ticket.warnings).toEqual([
      expect.objectContaining({ key: 'table_13', title: 'La mesa 13 ya la tiene Pedro' }),
    ])
  })

  it('con la gente adentro, las personas son las que vinieron', () => {
    const r = reservation({ status: 'arrived', actual_guests: 4 })
    const { payload, ticket } = okDraft(draftOf(r, { personas: 3 }))
    expect(payload).toMatchObject({ save: 'asistencia', patch: { actual_guests: 3 } })
    expect(actualGuestsSchema.safeParse({ id: RES, actual_guests: 3 }).success).toBe(true)
    expect(ticket.rows).toContainEqual({ label: 'Vinieron', value: '4 → 3' })
  })

  it('la nota se suma; reemplazarla hay que pedirlo', () => {
    const r = reservation({ comments: 'Trae torta' })
    expect(okDraft(draftOf(r, { nota: 'Silla de bebé' })).payload.patch.comments).toBe(
      'Trae torta\nSilla de bebé',
    )
    expect(
      okDraft(draftOf(r, { nota: 'Otra', reemplazar_nota: true })).payload.patch.comments,
    ).toBe('Otra')
  })

  it('reemplazar la nota de una compra online avisa: dice cuánto resta cobrar', () => {
    const r = reservation({ origin: 'web', comments: 'Resta cobrar $50.000.' })
    const { ticket } = okDraft(draftOf(r, { nota: 'Otra', reemplazar_nota: true }))
    expect(ticket.warnings.map((w) => w.key)).toContain('web_note')
  })

  describe('adentro de un evento', () => {
    const inEvent = reservation({
      scheduled_event_id: EVENT,
      zone: 'event_floating',
      scheduled_event: {
        id: EVENT,
        capacity: 40,
        starts_at_local: '21:00:00',
        meal_type: 'dinner',
        template: {
          id: TEMPLATE,
          name: 'Noche temática',
          slug: 'x',
          color_hex: '#000000',
          consume_special_reservations: true,
        },
      },
    })

    it('no se mueve de día sola: la fecha tiene que coincidir con la del evento', () => {
      const message = failDraft(draftOf(inEvent, { fecha: '2026-11-08' }))
      expect(message).toContain('Noche temática')
      expect(message).toContain('07/11/2026')
    })

    it('sacarla pide planta si no tenía', () => {
      expect(failDraft(draftOf(inEvent, { sacar_del_evento: true }))).toContain('planta')
      const { payload } = okDraft(draftOf(inEvent, { sacar_del_evento: true, planta: 'baja' }))
      expect(payload.patch).toEqual({ zone: 'planta_baja', scheduled_event_id: null })
      expect(
        updateSalonReservationSchema.safeParse(fullUpdatePayload(inEvent, payload.patch)).success,
      ).toBe(true)
    })

    it('el servicio lo define el evento', () => {
      expect(failDraft(draftOf(inEvent, { servicio: 'almuerzo' }))).toContain('lo define el evento')
    })

    it('elegir la planta no la saca del evento', () => {
      const { payload, ticket } = okDraft(draftOf(inEvent, { planta: 'alta' }))
      expect(payload.patch).toEqual({ zone: 'planta_alta', scheduled_event_id: EVENT })
      expect(ticket.rows).toContainEqual({
        label: 'Dónde',
        value: 'Noche temática → Noche temática · Planta Alta',
      })
    })

    it('moverla a un evento de otro día, con ese evento', () => {
      const other = event({ id: RES2, event_date: '2026-11-14', starts_at_local: '21:00:00' })
      const { payload } = okDraft(
        draftOf(
          inEvent,
          { fecha: '2026-11-14', evento: 'x' },
          {
            targetEvent: other,
            snapshot: snapshot([], [other], '2026-11-14'),
          },
        ),
      )
      expect(payload.patch).toMatchObject({
        reservation_date: '2026-11-14',
        scheduled_event_id: RES2,
      })
    })
  })

  it('pasarla a un evento le pone el servicio y la hora del evento', () => {
    const e = event({ starts_at_local: '13:00:00', meal_type: 'hub_event' })
    const { payload } = okDraft(
      draftOf(reservation(), { evento: 'x' }, { targetEvent: e, snapshot: snapshot([], [e]) }),
    )
    expect(payload.patch).toEqual({
      reservation_time_local: '13:00',
      meal_type: 'lunch',
      zone: 'event_floating',
      scheduled_event_id: EVENT,
    })
  })

  it('un evento de otra fecha no', () => {
    const e = event({ event_date: '2026-11-14' })
    expect(failDraft(draftOf(reservation(), { evento: 'x' }, { targetEvent: e }))).toContain(
      'tienen que coincidir',
    )
  })

  it('el cupo se mide en el día nuevo y reemplaza a la misma reserva', () => {
    const r = reservation({ estimated_guests: 80 })
    const crowded = reservation({ id: RES2, estimated_guests: 30 })
    // Es la misma reserva: 30 + 95, y no 30 + 80 + 95.
    const { payload, ticket } = okDraft(
      draftOf(r, { personas: 95 }, { snapshot: snapshot([r, crowded]) }),
    )
    expect(payload.capacityAck).toBe(true)
    expect(ticket.warnings[0]?.body).toBe('Quedarían 125 de 120 (5 de más).')
    expect(ticket.confirmLabel).toBe('Guardar igual')
  })

  it('cambiar la nota no mira el cupo', () => {
    const { payload } = okDraft(draftOf(reservation(), { nota: 'Hola' }, { snapshot: null }))
    expect(payload.candidate).toBeNull()
  })

  it('el gestor nuevo avisa de la comisión', () => {
    const { payload, ticket } = okDraft(
      draftOf(
        reservation(),
        { gestor: 'x' },
        {
          manager: { id: MANAGER2, name: 'Pedro', eligible: true, assumed: false },
        },
      ),
    )
    expect(payload.patch).toEqual({ primary_manager_id: MANAGER2 })
    expect(ticket.warnings[0]?.title).toBe('La comisión pasa a Pedro')
  })

  it('una compra online avisa que lo pagado no cambia', () => {
    const { ticket } = okDraft(draftOf(reservation({ origin: 'web' }), { personas: 6 }))
    expect(ticket.warnings.map((w) => w.key)).toContain('web_change')
  })

  it('sin cambios o cancelada, no hay tique', () => {
    expect(failDraft(draftOf(reservation(), {}))).toContain('nada para cambiar')
    expect(failDraft(draftOf(reservation(), { personas: 4 }))).toContain('nada para cambiar')
    expect(failDraft(draftOf(reservation({ status: 'cancelled' }), { personas: 6 }))).toContain(
      'cancelada',
    )
  })

  it('un teléfono malo no pasa', () => {
    expect(failDraft(draftOf(reservation(), { telefono: '123456' }))).toContain('Teléfono inválido')
  })
})

describe('marcar el estado', () => {
  const draftOf = (r: ReservationWithJoins, estado: string, input = {}, facts = {}) =>
    statusChangeDraft(
      r,
      { reserva: r.id, estado, ...input } as Parameters<typeof statusChangeDraft>[1],
      { serviceDay: DAY, occupied: new Map(), ...facts },
    )

  it('llegó, con cuántos y en qué mesa, en el mismo gesto', () => {
    const { payload, ticket } = okDraft(
      draftOf(reservation(), 'llego', { personas: 5, mesa: '12' }),
    )
    expect(payload).toMatchObject({ to: 'arrived', actual_guests: 5, table_label: '12' })
    expect(
      transitionStatusSchema.safeParse({
        id: payload.id,
        to: payload.to,
        actual_guests: payload.actual_guests,
        table_label: payload.table_label,
      }).success,
    ).toBe(true)
    expect(ticket.confirmLabel).toBe('Marcar que llegó')
    expect(ticket.rows).toContainEqual({ label: 'Estado', value: 'Pendiente → Llegó' })
  })

  it('llegó sin contar deja «nadie contó»', () => {
    expect(okDraft(draftOf(reservation(), 'llego')).payload.actual_guests).toBeNull()
  })

  it('no vino libera el lugar y dice qué pasa con la seña', () => {
    const { ticket, payload } = okDraft(
      draftOf(reservation({ deposit_cents: 1_000_000 }), 'no_vino', { personas: 3 }),
    )
    expect(payload).toMatchObject({ to: 'no_show', actual_guests: null })
    expect(ticket.warnings[0]?.body).toContain('$ 10.000')
    expect(ticket.warnings[0]?.body).toContain('Señas')
    expect(ticket.confirmLabel).toBe('Marcar que no vino')
  })

  it('cerrar arranca en lo contado, como el botón del tablero', () => {
    const r = reservation({ status: 'arrived', actual_guests: 6 })
    expect(okDraft(draftOf(r, 'cerrada')).payload.actual_guests).toBe(6)
    const s = reservation({ status: 'seated' })
    expect(okDraft(draftOf(s, 'cerrada')).payload.actual_guests).toBe(4)
    expect(okDraft(draftOf(s, 'cerrada', { personas: 7 })).ticket.confirmLabel).toBe(
      'Cerrar la mesa',
    )
  })

  it('volver atrás avisa con las mismas palabras de la pantalla', () => {
    const undo = okDraft(draftOf(reservation({ status: 'arrived' }), 'por_llegar'))
    expect(undo.ticket.confirmLabel).toBe('Volver a «por llegar»')
    expect(undo.ticket.warnings[0]?.key).toBe('revert')
    const reopen = okDraft(draftOf(reservation({ status: 'closed' }), 'sentada'))
    expect(reopen.ticket.confirmLabel).toBe('Reabrir la mesa')
    const appeared = okDraft(draftOf(reservation({ status: 'no_show' }), 'llego'))
    expect(appeared.ticket.rows).toContainEqual({ label: 'Estado', value: 'No vino → Llegó' })
  })

  it.each([
    ['pending', 'cerrada'],
    ['pending', 'sentada'],
    ['closed', 'llego'],
    ['no_show', 'cerrada'],
  ] as const)('de %s no pasa directo a %s', (from, to) => {
    expect(failDraft(draftOf(reservation({ status: from }), to))).toContain('no pasa directo')
  })

  it('el mismo estado no arma tique; una cancelada no vuelve', () => {
    expect(failDraft(draftOf(reservation({ status: 'arrived' }), 'llego'))).toContain('ya figura')
    expect(failDraft(draftOf(reservation({ status: 'cancelled' }), 'llego'))).toContain('cancelada')
  })

  it('un día que todavía no llegó no se marca, como en el tablero', () => {
    const r = reservation({ reservation_date: '2026-11-20' })
    expect(failDraft(draftOf(r, 'llego'))).toContain('todavía no llegó')
    expect(failDraft(draftOf(r, 'no_vino'))).toContain('todavía no llegó')
  })

  it('a la 1:30 del domingo, la cena del sábado se marca; ayer también', () => {
    expect(okDraft(draftOf(reservation(), 'llego', {}, { serviceDay: DAY })).ok).toBe(true)
    const past = reservation({ reservation_date: '2026-11-01' })
    expect(okDraft(draftOf(past, 'llego')).ok).toBe(true)
  })

  it('la mesa va con «llegó»', () => {
    expect(failDraft(draftOf(reservation(), 'no_vino', { mesa: '12' }))).toContain('La mesa')
    const { ticket } = okDraft(
      draftOf(reservation(), 'llego', { mesa: '12' }, { occupied: new Map([['12', 'Pedro']]) }),
    )
    expect(ticket.warnings[0]?.title).toBe('La mesa 12 ya la tiene Pedro')
  })
})

describe('cancelar una reserva', () => {
  const draftOf = (r: ReservationWithJoins, motivo?: string) =>
    cancelReservationDraft(r, { reserva: r.id, motivo })

  it('pasa el zod de la acción', () => {
    const { payload, ticket } = okDraft(draftOf(reservation(), 'Avisó que no viene'))
    expect(cancelReservationSchema.safeParse(payload).success).toBe(true)
    expect(payload).toEqual({ id: RES, reason: 'Avisó que no viene' })
    expect(ticket).toMatchObject({
      title: 'Cancelar la reserva',
      confirmLabel: 'Cancelar la reserva',
      warnings: [],
    })
  })

  it('con seña, dice que no se devuelve sola', () => {
    const { ticket } = okDraft(draftOf(reservation({ deposit_cents: 1_000_000 })))
    expect(ticket.warnings[0]?.title).toBe('Tiene una seña de $ 10.000')
    expect(ticket.warnings[0]?.body).toContain('no la devuelve')
  })

  it('una compra online: la entrada deja de valer y la plata la devuelve un dueño', () => {
    const { ticket } = okDraft(draftOf(reservation({ origin: 'web', deposit_cents: 4_000_000 })))
    expect(ticket.warnings[0]?.key).toBe('web_cancel')
    expect(ticket.warnings[0]?.title).toContain('deja de valer')
    expect(ticket.warnings[0]?.body).toContain('Ventas online')
  })

  it('si ya llegó, avisa', () => {
    const { ticket } = okDraft(draftOf(reservation({ status: 'arrived' })))
    expect(ticket.warnings.map((w) => w.key)).toContain('already_here')
  })

  it('ya cancelada, no', () => {
    expect(failDraft(draftOf(reservation({ status: 'cancelled' })))).toContain('ya está cancelada')
  })
})

// ─── Eventos, formatos, cupos ────────────────────────────────────────────────

describe('un evento', () => {
  const facts = (patch = {}) => ({
    existing: null,
    template: template(),
    date: DAY,
    snapshot: snapshot(),
    dayEvents: [],
    active: { reservations: 0, people: 0 },
    ...patch,
  })
  const draftOf = (input: Record<string, unknown>, patch = {}) =>
    eventDraft(eventInput.parse(input), facts(patch))

  it('uno nuevo pasa el zod, con el cupo del formato y la hora de su servicio', () => {
    const { payload, ticket } = okDraft(draftOf({ formato: 'x', fecha: DAY }))
    expect(scheduledEventSchema.parse(payload.values)).toMatchObject({
      template_id: TEMPLATE,
      event_date: DAY,
      starts_at_local: '21:00:00',
      capacity: 40,
      meal_type: 'dinner',
      full_bonus_active: true,
      attendance_points: 0,
    })
    // Sin el tilde, manda el default del formato (lo decide la acción).
    expect(payload.values).not.toHaveProperty('private_group')
    expect(ticket).toMatchObject({ title: 'Nuevo evento', confirmLabel: 'Programar el evento' })
    expect(payload).toMatchObject({ moved: false, onlyMove: false })
  })

  it('el servicio sale de la hora, no de lo que diga el formato', () => {
    const { payload } = okDraft(draftOf({ formato: 'x', fecha: DAY, hora: '13:00' }))
    expect(payload.values.meal_type).toBe('lunch')
  })

  it('sin cupo en el formato, lo pregunta', () => {
    expect(
      failDraft(draftOf({ formato: 'x' }, { template: template({ default_capacity: null }) })),
    ).toContain('preguntale el cupo')
    expect(
      okDraft(
        draftOf({ formato: 'x', cupo: 50 }, { template: template({ default_capacity: null }) }),
      ).ok,
    ).toBe(true)
  })

  it('un formato va una vez por día', () => {
    expect(failDraft(draftOf({ formato: 'x' }, { dayEvents: [event()] }))).toContain(
      'una vez por día',
    )
  })

  it('avisa si no entra en el servicio, y si se lleva todo el servicio', () => {
    const big = okDraft(draftOf({ formato: 'x', cupo: 140 }))
    expect(big.ticket.warnings.map((w) => w.key)).toContain('event_takes_service')
    const full = okDraft(
      draftOf(
        { formato: 'x', cupo: 30 },
        { snapshot: snapshot([reservation({ estimated_guests: 100 })]) },
      ),
    )
    expect(full.ticket.warnings[0]).toMatchObject({
      key: 'event_over_service',
      title: 'Con este evento te pasás del cupo de la cena',
    })
  })

  describe('cambiar uno', () => {
    const edit = (input: Record<string, unknown>, patch = {}) =>
      draftOf({ evento: EVENT, ...input }, { existing: event(), template: null, ...patch })

    it('conserva lo que no se tocó', () => {
      const e = event({
        notes: 'Con DJ',
        attendance_points: 10,
        full_bonus_active: false,
        private_group: true,
      })
      const { payload, ticket } = okDraft(edit({ cupo: 80 }, { existing: e }))
      expect(scheduledEventSchema.parse(payload.values)).toMatchObject({
        id: EVENT,
        capacity: 80,
        notes: 'Con DJ',
        attendance_points: 10,
        full_bonus_active: false,
        meal_type: 'hub_event',
        ends_at_local: '23:30:00',
      })
      // Sin el campo, la acción no toca el tilde de grupo privado.
      expect(payload.values).not.toHaveProperty('private_group')
      expect(ticket.rows).toEqual([{ label: 'Cupo', value: '40 → 80' }])
      expect(ticket.title).toBe('Cambiar el evento')
    })

    it('no se mueve de día con reservas activas', () => {
      const message = failDraft(
        edit(
          { fecha: '2026-11-14' },
          { active: { reservations: 3, people: 10 }, date: '2026-11-14' },
        ),
      )
      expect(message).toContain('No se puede mover')
      expect(message).toContain('3 reservas activas')
    })

    it('sin reservas se mueve por la acción que lo controla', () => {
      const { payload } = okDraft(
        edit(
          { fecha: '2026-11-14' },
          { date: '2026-11-14', snapshot: snapshot([], [], '2026-11-14') },
        ),
      )
      expect(payload).toMatchObject({ moved: true, onlyMove: true })
      const both = okDraft(
        edit(
          { fecha: '2026-11-14', cupo: 80 },
          { date: '2026-11-14', snapshot: snapshot([], [], '2026-11-14') },
        ),
      )
      expect(both.payload).toMatchObject({ moved: true, onlyMove: false })
    })

    it('cambiar la hora no mueve sus reservas, y lo avisa', () => {
      const { ticket, payload } = okDraft(
        edit({ hora: '20:00' }, { active: { reservations: 3, people: 10 } }),
      )
      expect(payload.values.meal_type).toBe('dinner')
      expect(ticket.warnings.map((w) => w.key)).toContain('event_time_reservations')
    })

    it('bajar el cupo por debajo de la gente avisa', () => {
      const { ticket } = okDraft(edit({ cupo: 5 }, { active: { reservations: 3, people: 10 } }))
      expect(ticket.warnings.find((w) => w.key === 'event_capacity_people')?.title).toBe(
        'Ya hay 10 personas: queda pasado por 5',
      )
    })

    it('el tilde de grupo privado viaja solo si lo pidieron', () => {
      const { payload, ticket } = okDraft(edit({ grupo_privado: true }))
      expect(scheduledEventSchema.parse(payload.values).private_group).toBe(true)
      expect(ticket.rows).toEqual([{ label: 'Grupo privado', value: 'Sí' }])
    })

    it('sin cambios, no hay tique', () => {
      expect(failDraft(edit({}))).toContain('nada para cambiar')
    })
  })
})

describe('cancelar un evento', () => {
  it('con reservas activas no se puede', () => {
    expect(failDraft(cancelEventDraft(event(), { active: 2, fallenUnplaced: 0 }))).toContain(
      '2 reservas activas',
    )
  })

  it('con reservas caídas sin planta la base no deja borrarlo: se dice antes', () => {
    expect(failDraft(cancelEventDraft(event(), { active: 0, fallenUnplaced: 1 }))).toContain(
      'poniéndoles planta',
    )
  })

  it('sin reservas, el tique dice que se borra', () => {
    const { payload, ticket } = okDraft(cancelEventDraft(event(), { active: 0, fallenUnplaced: 0 }))
    expect(payload).toEqual({ id: EVENT })
    expect(ticket.confirmLabel).toBe('Cancelar el evento')
    expect(ticket.warnings[0]?.title).toContain('no se puede deshacer')
    expect(ticket.warnings[0]?.body).toContain('cartelera')
  })
})

describe('un formato', () => {
  it('uno nuevo pasa el zod, con un slug libre', () => {
    const { payload, ticket } = okDraft(
      templateDraft(
        { nombre: 'Noche de jazz', cupo: 50, servicio: 'merienda' },
        { existing: null, takenSlugs: ['otra'] },
      ),
    )
    expect(scheduledTemplateSchema.parse(payload.values)).toMatchObject({
      name: 'Noche de jazz',
      slug: 'noche-de-jazz',
      default_capacity: 50,
      default_meal_type: 'tea_time',
      color_hex: '#7c3aed',
      active: true,
      consume_special_reservations: true,
      default_private_group: false,
    })
    expect(ticket).toMatchObject({ title: 'Nuevo formato', confirmLabel: 'Crear el formato' })
  })

  it('sin nombre lo pregunta; uno que ya existe lo dice', () => {
    expect(failDraft(templateDraft({}, { existing: null, takenSlugs: [] }))).toContain(
      'cómo se llama',
    )
    expect(
      failDraft(
        templateDraft(
          { nombre: 'Noche de Jazz' },
          { existing: null, takenSlugs: ['noche-de-jazz'] },
        ),
      ),
    ).toContain('Ya hay un formato')
  })

  it('editarlo conserva el slug y lo que no se tocó', () => {
    const existing = template({ consume_special_reservations: false, default_capacity: 40 })
    const { payload, ticket } = okDraft(
      templateDraft({ formato: 'x', cupo: 60 }, { existing, takenSlugs: [existing.slug] }),
    )
    expect(scheduledTemplateSchema.parse(payload.values)).toMatchObject({
      id: TEMPLATE,
      slug: 'noche-tematica',
      default_capacity: 60,
      consume_special_reservations: false,
    })
    expect(ticket.rows).toEqual([{ label: 'Cupo', value: '40 → 60' }])
    expect(ticket.warnings.map((w) => w.key)).toEqual(['template_new_dates'])
  })

  it('apagarlo avisa que lo programado sigue', () => {
    const { ticket } = okDraft(
      templateDraft({ formato: 'x', activo: false }, { existing: template(), takenSlugs: [] }),
    )
    expect(ticket.warnings[0]?.key).toBe('template_off')
  })

  it('sin cambios, no hay tique', () => {
    expect(
      failDraft(
        templateDraft({ formato: 'x', cupo: 40 }, { existing: template(), takenSlugs: [] }),
      ),
    ).toContain('nada para cambiar')
  })
})

describe('los cupos', () => {
  const dinner = (rows: ReservationWithJoins[] = []) => dayOf(snapshot(rows)).segments.dinner

  it('un cupo especial pasa el zod de la acción', () => {
    const draft = okDraft(
      specialCapacityDraft(
        { fecha: DAY, servicio: 'cena', cupo: 150, motivo: 'Abre la terraza' },
        { segment: dinner(), isoDow: 6 },
      ),
    )
    expect(draft.remove).toBe(false)
    expect(segmentOverrideSchema.parse(draft.payload)).toMatchObject({
      override_date: DAY,
      segment: 'dinner',
      capacity: 150,
      reason: 'Abre la terraza',
    })
    expect(draft.ticket.rows[0]).toEqual({ label: 'Cupo', value: '120 → 150' })
    expect(draft.ticket.confirmLabel).toBe('Guardar el cupo')
  })

  it('cerrar con gente lo avisa, y no toca las reservas', () => {
    const draft = okDraft(
      specialCapacityDraft(
        { fecha: DAY, servicio: 'cena', cupo: 0 },
        { segment: dinner([reservation()]), isoDow: 6 },
      ),
    )
    expect(draft.ticket.title).toBe('Cerrar el servicio ese día')
    expect(draft.ticket.warnings[0]?.title).toBe('Lo cierra con 4 personas reservadas')
  })

  it('un aviso más alto que el cupo no pasa', () => {
    expect(
      failDraft(
        specialCapacityDraft(
          { fecha: DAY, servicio: 'cena', cupo: 50, aviso: 60 },
          { segment: dinner(), isoDow: 6 },
        ),
      ),
    ).toContain('aviso')
  })

  it('quitarlo solo si hay uno', () => {
    const snap = snapshot()
    snap.caps.dinner = { ...snap.caps.dinner, capacity: 150, source: 'override' }
    const draft = okDraft(
      specialCapacityDraft(
        { fecha: DAY, servicio: 'cena', quitar: true },
        { segment: dayOf(snap).segments.dinner, isoDow: 6 },
      ),
    )
    expect(draft.remove).toBe(true)
    expect(segmentOverrideKeySchema.safeParse(draft.payload).success).toBe(true)
    expect(
      failDraft(
        specialCapacityDraft(
          { fecha: DAY, servicio: 'cena', quitar: true },
          { segment: dinner(), isoDow: 6 },
        ),
      ),
    ).toContain('no tiene cupo especial')
  })

  it('sin número lo pregunta', () => {
    expect(
      failDraft(
        specialCapacityDraft({ fecha: DAY, servicio: 'cena' }, { segment: dinner(), isoDow: 6 }),
      ),
    ).toContain('de cuánto')
  })

  it('el cupo de la semana pasa el zod y toca una sola celda', () => {
    const draft = okDraft(
      weeklyCapacityDraft(
        { dia: 'jueves', servicio: 'almuerzo', cupo: 80 },
        {
          current: { segment: 'lunch', iso_dow: 4, capacity: 70, warn_at: 50 },
          fallbackTotal: 120,
        },
      ),
    )
    expect(segmentConfigSaveSchema.parse(draft.payload)).toEqual({
      weekly: [{ segment: 'lunch', iso_dow: 4, capacity: 80, warn_at: 50 }],
      settings: [],
    })
    expect(draft.ticket.subtitle).toBe('Almuerzo · todos los jueves')
    expect(draft.ticket.rows[0]).toEqual({ label: 'Cupo', value: '70 → 80' })
  })

  it('un aviso que queda arriba del cupo nuevo se saca', () => {
    const draft = okDraft(
      weeklyCapacityDraft(
        { dia: 'sabado', servicio: 'cena', cupo: 40 },
        {
          current: { segment: 'dinner', iso_dow: 6, capacity: 120, warn_at: 100 },
          fallbackTotal: 120,
        },
      ),
    )
    expect(draft.payload.weekly[0]?.warn_at).toBeNull()
    expect(draft.ticket.rows).toContainEqual({ label: 'Aviso desde', value: '100 → Sin aviso' })
    expect(draft.ticket.subtitle).toBe('Cena · todos los sábados')
  })

  it('volver al general borra la celda', () => {
    const draft = okDraft(
      weeklyCapacityDraft(
        { dia: 'lunes', servicio: 'cena', volver_al_general: true },
        {
          current: { segment: 'dinner', iso_dow: 1, capacity: 80, warn_at: null },
          fallbackTotal: 120,
        },
      ),
    )
    expect(draft.payload.weekly[0]).toMatchObject({ capacity: null, warn_at: null })
    expect(draft.ticket.rows[0]).toEqual({ label: 'Cupo', value: '80 → El general (120)' })
  })

  it('si ya está así, no hay tique', () => {
    expect(
      failDraft(
        weeklyCapacityDraft(
          { dia: 'lunes', servicio: 'cena', cupo: 80 },
          {
            current: { segment: 'dinner', iso_dow: 1, capacity: 80, warn_at: null },
            fallbackTotal: 120,
          },
        ),
      ),
    ).toContain('Ya está así')
    expect(
      failDraft(
        weeklyCapacityDraft(
          { dia: 'lunes', servicio: 'cena' },
          { current: null, fallbackTotal: 120 },
        ),
      ),
    ).toContain('de cuánto')
  })
})

// ─── Comisiones, señas y entradas ────────────────────────────────────────────

describe('comisiones', () => {
  const entry = (patch: Record<string, unknown> = {}, reservationPatch = {}) =>
    ({
      id: RES,
      tenant_id: TENANT,
      reservation_id: RES,
      manager_id: MANAGER,
      meal_type: 'dinner',
      guests_billed: 4,
      base_rate_per_guest_cents: 10_000,
      base_total_cents: 40_000,
      bonus_per_guest_cents: 0,
      bonus_total_cents: 0,
      split_factor_numerator: 1,
      split_factor_denominator: 1,
      payable_cents: 40_000,
      calculation_version: 1,
      calculated_at: '2026-11-01T12:00:00Z',
      paid_at: null,
      paid_payout_id: null,
      reservation: {
        id: RES,
        guest_name: 'Ana García',
        reservation_date: '2026-11-01',
        reservation_time_local: '21:00:00',
        estimated_guests: 4,
        actual_guests: null,
        ...reservationPatch,
      },
      ...patch,
    }) as never

  it('lo que todavía no pasó no se puede liquidar', () => {
    const data = commissionEntriesData({
      period: resolveCommissionPeriod({ month: '2026-11' }, CTX.today),
      manager: 'Marta',
      entries: [
        entry(),
        entry({ id: RES2, paid_at: '2026-11-02T12:00:00Z', payable_cents: 20_000 }),
        entry({ payable_cents: 70_000 }, { reservation_date: '2026-11-20' }),
      ],
      truncated: false,
      today: CTX.today,
    }) as Record<string, unknown> & { filas: Array<Record<string, unknown>> }
    expect(data).toMatchObject({
      gestor: 'Marta',
      periodo: '1 al 30 de noviembre de 2026',
      a_cobrar: '$ 1.100',
      cobrado: '$ 200',
      se_puede_liquidar_hoy: '$ 400',
      reservas: 3,
    })
    expect(data.filas.map((f) => f.estado)).toEqual([
      'Pendiente',
      'Pagado',
      'Pendiente, todavía no pasó',
    ])
    // Una reserva sin contar se propone sobre el estimado: hay que poder decirlo.
    expect(data.filas[0]).toMatchObject({ sin_contar: true })
  })

  it('ver_mis_numeros: sin vínculo lo dice; con vínculo, lo suyo', async () => {
    vi.mocked(getManagerForUser).mockResolvedValue(null)
    expect(asData(await run('ver_mis_numeros', {}, HOST))).toMatchObject({ vinculada: false })

    vi.mocked(getManagerForUser).mockResolvedValue(manager())
    vi.mocked(listMyCommissionEntries).mockResolvedValue({ entries: [entry()], truncated: false })
    const data = asData(await run('ver_mis_numeros', { mes: '2026-11' }, HOST))
    expect(listMyCommissionEntries).toHaveBeenCalledWith({
      tenantId: TENANT,
      managerId: MANAGER,
      from: '2026-11-01',
      to: '2026-11-30',
    })
    expect(data).toMatchObject({ gestor: 'Marta', a_cobrar: '$ 400' })
    expectNoContact(data)
  })
})

describe('señas', () => {
  it('las caídas suman y van aparte', () => {
    const report = aggregateDepositsByDay({
      basis: 'reservation',
      from: '2026-11-01',
      to: '2026-11-30',
      rows: [
        {
          reservation_date: DAY,
          created_at: '2026-11-01T12:00:00Z',
          deposit_cents: 1_000_000,
          status: 'pending',
        },
        {
          reservation_date: DAY,
          created_at: '2026-11-01T12:00:00Z',
          deposit_cents: 500_000,
          status: 'cancelled',
        },
        {
          reservation_date: '2026-11-08',
          created_at: '2026-11-01T12:00:00Z',
          deposit_cents: 300_000,
          status: 'no_show',
        },
        {
          reservation_date: '2026-11-09',
          created_at: '2026-11-01T12:00:00Z',
          deposit_cents: 0,
          status: 'pending',
        },
      ],
    })
    const data = depositsData(report, 'Noviembre 2026', 'reservation') as Record<
      string,
      unknown
    > & {
      filas: Array<Record<string, unknown>>
    }
    expect(data).toMatchObject({
      periodo: 'Noviembre 2026',
      criterio: 'Día de la reserva',
      total: '$ 18.000',
      vigente: '$ 10.000',
      canceladas: '$ 5.000',
      no_vino: '$ 3.000',
      reservas: 4,
      con_sena: 3,
      dia_mas_alto: { fecha: '07/11/2026', total: '$ 15.000' },
    })
    expect(data.filas).toHaveLength(2)
    expect(data.filas[0]).toMatchObject({
      fecha: '07/11/2026',
      total: '$ 15.000',
      canceladas_o_no_vino: '$ 5.000',
    })
  })

  it('un reporte cortado lo avisa', () => {
    const report = aggregateDepositsByDay({
      basis: 'created',
      from: '2026-11-01',
      to: '2026-11-02',
      rows: [],
      truncated: true,
    })
    expect(depositsData(report, 'x', 'created')).toMatchObject({
      criterio: 'Día de carga',
      aviso: expect.stringContaining('incompleto'),
    })
  })
})

describe('entradas', () => {
  const NOW = new Date('2026-11-05T15:00:00Z')

  it('la misma cuenta que ticketing_event_seats, con lo que lee el dueño', () => {
    const counts = seatCounts(
      [
        { scheduled_event_id: EVENT, estimated_guests: 4, actual_guests: null },
        { scheduled_event_id: EVENT, estimated_guests: 4, actual_guests: 2 },
        { scheduled_event_id: null, estimated_guests: 50, actual_guests: null },
      ],
      [
        {
          scheduled_event_id: EVENT,
          party_size: 2,
          status: 'approved',
          hold_expires_at: '2026-01-01T00:00:00Z',
        },
        {
          scheduled_event_id: EVENT,
          party_size: 3,
          status: 'pending',
          hold_expires_at: '2026-11-05T15:10:00Z',
        },
        {
          scheduled_event_id: EVENT,
          party_size: 1,
          status: 'rejected',
          hold_expires_at: '2026-11-05T15:10:00Z',
        },
        {
          scheduled_event_id: EVENT,
          party_size: 9,
          status: 'pending',
          hold_expires_at: '2026-11-05T14:00:00Z',
        },
        {
          scheduled_event_id: EVENT,
          party_size: 9,
          status: 'refunded',
          hold_expires_at: '2026-11-05T16:00:00Z',
        },
      ],
      NOW,
    )
    expect(counts.get(EVENT)).toEqual({ taken: 6, held: 4, sold: 2 })
  })

  const film = {
    id: RES,
    template_id: TEMPLATE,
    slug: 'una-pelicula',
    published: true,
    title: 'Una película',
    price_cents: 4_500_000,
    deposit_cents: 2_000_000,
    cash_price_cents: null,
    allow_full_payment: false,
    min_party_size: 2,
    max_party_size: 10,
  }

  const data = (
    events: ScheduledEventWithTemplate[],
    counts: Parameters<typeof entradasData>[0]['counts'],
    wanted?: string,
  ) =>
    entradasData({
      experiences: [film],
      events,
      counts,
      nowLocal: '2026-11-05 12:00',
      canSell: true,
      publicUrl: 'https://bar.test/entradas/bar',
      wanted,
    }) as Record<string, unknown> & {
      filas: Array<Record<string, unknown> & { funciones: Array<Record<string, unknown>> }>
    }

  it('da lo que queda, lo vendido y cómo se dice', () => {
    const result = data(
      [
        event({ id: EVENT, capacity: 40 }),
        event({ id: RES2, event_date: '2026-11-14', capacity: 40 }),
      ],
      new Map([
        [EVENT, { taken: 39, held: 0, sold: 30 }],
        [RES2, { taken: 8, held: 2, sold: 8 }],
      ]),
    )
    expect(result).toMatchObject({
      se_puede_vender: true,
      cartelera: 'https://bar.test/entradas/bar',
      publicadas: 1,
      funciones_a_la_venta: 1,
      funciones_agotadas: 1,
    })
    expect(result.filas[0]).toMatchObject({
      pelicula: 'Una película',
      precio: '$ 45.000',
      sena: '$ 20.000',
      solo_sena: true,
      personas: '2 a 10',
    })
    // Queda 1 y la película se vende de a 2: para la venta, agotada.
    expect(result.filas[0]?.funciones[0]).toMatchObject({
      fecha: '07/11/2026',
      cupo: 40,
      ocupados: 39,
      quedan: 1,
      vendidas_online: 30,
      estado: 'Agotado',
    })
    expect(result.filas[0]?.funciones[1]).toMatchObject({
      quedan: 30,
      guardados: 2,
      vendidas_online: 8,
    })
    expect(result.filas[0]?.funciones[1]).not.toHaveProperty('estado')
  })

  it('sin grupos privados ni lo que ya arrancó', () => {
    const result = data(
      [
        event({ id: EVENT, private_group: true }),
        event({ id: RES2, event_date: '2026-11-05', starts_at_local: '11:00:00' }),
      ],
      new Map(),
    )
    expect(result.filas[0]?.funciones).toEqual([])
  })

  it('filtra por película', () => {
    expect(data([], new Map(), 'pelicula').filas).toHaveLength(1)
    expect(data([], new Map(), 'otra cosa').filas).toHaveLength(0)
  })

  it('ver_ventas_entradas filtra por estado', async () => {
    vi.mocked(listRecentOrders).mockResolvedValue([
      {
        id: RES,
        title: 'Una película',
        event_date: DAY,
        event_time: '21:00:00',
        party_size: 2,
        payment_option: 'deposit',
        total_cents: 4_000_000,
        paid_cents: 4_000_000,
        guest_name: 'Ana García',
        guest_phone: PHONE,
        status: 'approved',
        hold_expires_at: '2026-11-05T12:00:00Z',
        reservation_id: RES2,
        attention: 'overbooked',
        mp_status_detail: 'accredited',
        mp_payment_type: 'credit_card',
        created_at: '2026-11-04T12:00:00Z',
        paid_at: '2026-11-04T12:00:00Z',
        reservation: null,
        undo: null,
      },
    ])
    const paid = asData(await run('ver_ventas_entradas', { estado: 'pagadas' })) as {
      filas: Array<Record<string, unknown>>
    }
    expect(paid.filas[0]).toMatchObject({
      a_nombre_de: 'Ana García',
      forma: 'Seña',
      monto: '$ 40.000',
      estado: 'Pagado',
      a_revisar: 'Sobrecupo',
    })
    expectNoContact(paid)
    const refunded = asData(await run('ver_ventas_entradas', { estado: 'devueltas' }))
    expect(refunded).toMatchObject({ cuantas: 0 })
    const review = asData(await run('ver_ventas_entradas', { estado: 'a_revisar' }))
    expect(review).toMatchObject({ cuantas: 1 })
    expect(listRecentOrders).toHaveBeenCalledWith(TENANT, 60)
  })

  it('ver_entradas va con la sesión y dice si se puede vender', async () => {
    const chain = (rows: unknown[]) => {
      const builder = Object.assign(
        Promise.resolve({ data: rows, error: null }),
      ) as unknown as Record<string, unknown>
      for (const method of ['select', 'eq', 'in', 'not', 'order', 'range']) {
        builder[method] = vi.fn(() => builder)
      }
      return builder
    }
    const eq = vi.fn()
    const tables: Record<string, unknown[]> = {
      event_experiences: [film],
      salon_reservations: [{ scheduled_event_id: EVENT, estimated_guests: 4, actual_guests: null }],
      ticket_orders: [],
    }
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue({
      from: (table: string) => {
        const builder = chain(tables[table] ?? [])
        const original = builder.eq as (...args: unknown[]) => unknown
        builder.eq = (...args: unknown[]) => {
          eq(table, ...args)
          return original(...args)
        }
        return builder
      },
    } as never)
    vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([
      event({ id: EVENT, event_date: '2030-01-05' }),
    ])
    vi.mocked(getTicketingSettings).mockResolvedValue({ mp_connected_at: null } as never)

    const result = asData(await run('ver_entradas', {})) as {
      se_puede_vender: boolean
      cartelera: string
      filas: Array<{ funciones: Array<Record<string, unknown>> }>
    }
    expect(result.se_puede_vender).toBe(false)
    expect(result.cartelera).toBe('https://bar.test/entradas/bar')
    expect(result.filas[0]?.funciones[0]).toMatchObject({
      evento_id: EVENT,
      ocupados: 4,
      quedan: 36,
    })
    for (const table of Object.keys(tables)) {
      expect(eq).toHaveBeenCalledWith(table, 'tenant_id', TENANT)
    }
  })
})

// ─── De punta a punta ────────────────────────────────────────────────────────

describe('de punta a punta', () => {
  function stubNewReservation() {
    vi.mocked(listManagers).mockResolvedValue([
      manager(),
      manager({ id: MANAGER2, display_name: 'Pedro', user_id: null, commission_eligible: false }),
    ])
    vi.mocked(getManagerForUser).mockResolvedValue(manager())
    vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(snapshot())
    vi.mocked(listScheduledEventsForDate).mockResolvedValue([])
    vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([event()])
    vi.mocked(listCakeOptions).mockResolvedValue([CAKE_ROW])
    vi.mocked(searchCustomers).mockResolvedValue([])
    vi.mocked(listScheduledTemplates).mockResolvedValue([template()])
  }

  it('preparar_reserva arma el tique y no escribe nada', async () => {
    stubNewReservation()
    const prepared = asPrepared(
      await run(
        'preparar_reserva',
        { nombre: 'Ana García', personas: 6, fecha: DAY, hora: '21:30', telefono: PHONE_LOCAL },
        HOST,
      ),
    )
    expect(prepared.executor).toBe('agenda.reserva')
    expect(prepared.ticket.confirmLabel).toBe('Reservar para 6')
    expect(createSalonReservation).not.toHaveBeenCalled()
    expect(agendaArea.executors[prepared.executor]).toBeDefined()
    expectNoContact(prepared.ticket)
  })

  it('un gestor que no existe vuelve con los que hay; uno por nombre, ese', async () => {
    stubNewReservation()
    const message = asError(
      await run('preparar_reserva', { nombre: 'Ana', personas: 2, gestor: 'Nadie' }, HOST),
    )
    expect(message).toContain('Marta')
    expect(message).toContain('Pedro')
    expectNoContact(message)
    const prepared = asPrepared(
      await run('preparar_reserva', { nombre: 'Ana', personas: 2, gestor: 'pedro' }, HOST),
    )
    expect(
      (prepared.payload as { values: Record<string, unknown> }).values.primary_manager_id,
    ).toBe(MANAGER2)
  })

  it('el gestor por defecto es quien carga, si no hay otro recordado', async () => {
    stubNewReservation()
    const prepared = asPrepared(await run('preparar_reserva', { nombre: 'Ana', personas: 2 }, HOST))
    expect(
      (prepared.payload as { values: Record<string, unknown> }).values.primary_manager_id,
    ).toBe(MANAGER)
    expect(prepared.ticket.warnings.map((w) => w.key)).not.toContain('manager_assumed')
  })

  it('sin gestores activos lo dice', async () => {
    stubNewReservation()
    vi.mocked(listManagers).mockResolvedValue([])
    expect(asError(await run('preparar_reserva', { nombre: 'Ana', personas: 2 }, HOST))).toContain(
      'No hay gestores activos',
    )
  })

  it('reservar adentro de un evento por nombre toma la fecha del evento', async () => {
    stubNewReservation()
    const prepared = asPrepared(
      await run('preparar_reserva', { nombre: 'Ana', personas: 2, evento: 'noche tematica' }, HOST),
    )
    expect((prepared.payload as { values: Record<string, unknown> }).values).toMatchObject({
      scheduled_event_id: EVENT,
      reservation_date: DAY,
    })
    expect(getDaySegmentsSnapshot).toHaveBeenCalledWith({ tenantId: TENANT, date: DAY })
  })

  it('un evento de otra fecha vuelve a preguntar', async () => {
    stubNewReservation()
    vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([])
    const message = asError(
      await run(
        'preparar_reserva',
        { nombre: 'Ana', personas: 2, evento: 'noche tematica', fecha: '2026-11-08' },
        HOST,
      ),
    )
    expect(message).toContain('No encontré el evento')
  })

  it('el flow «Se acerca un evento» prendido llega al tique', async () => {
    stubNewReservation()
    vi.mocked(listFlows).mockResolvedValue([
      {
        id: RES,
        name: 'Recordatorio',
        trigger_type: 'event_starting',
        active: true,
        updated_at: '2026-11-01T12:00:00Z',
        step_count: 1,
      },
    ])
    vi.mocked(getFlow).mockResolvedValue({
      id: RES,
      name: 'Recordatorio',
      trigger_type: 'event_starting',
      trigger_config: { hours_before: 12 },
      active: true,
      steps: [],
    })
    const prepared = asPrepared(
      await run(
        'preparar_reserva',
        { nombre: 'Ana', personas: 2, evento: 'noche tematica', telefono: PHONE_LOCAL },
        HOST,
      ),
    )
    const warning = prepared.ticket.warnings.find((w) => w.key === 'event_flow')
    expect(warning?.body).toContain('12 h antes')
  })

  it('un flow apagado o de otra cosa no', async () => {
    stubNewReservation()
    vi.mocked(listFlows).mockResolvedValue([
      {
        id: RES,
        name: 'Apagado',
        trigger_type: 'event_starting',
        active: false,
        updated_at: '2026-11-01T12:00:00Z',
        step_count: 1,
      },
      {
        id: RES2,
        name: 'Cumple',
        trigger_type: 'birthday',
        active: true,
        updated_at: '2026-11-01T12:00:00Z',
        step_count: 1,
      },
    ])
    const prepared = asPrepared(
      await run(
        'preparar_reserva',
        { nombre: 'Ana', personas: 2, evento: 'noche tematica', telefono: PHONE_LOCAL },
        HOST,
      ),
    )
    expect(prepared.ticket.warnings.map((w) => w.key)).not.toContain('event_flow')
  })

  it('un teléfono que ya es de un cliente se vincula, y trae sus avisos', async () => {
    stubNewReservation()
    vi.mocked(searchCustomers).mockResolvedValue([
      {
        id: CUSTOMER,
        first_name: 'Ana',
        last_name: 'García',
        phone: PHONE,
        points_balance: 0,
        service_alerts: ['celiac'],
      },
    ])
    const prepared = asPrepared(
      await run('preparar_reserva', { nombre: 'Ana', personas: 2, telefono: PHONE_LOCAL }, HOST),
    )
    expect(searchCustomers).toHaveBeenCalledWith('bar', '5493511234567')
    expect((prepared.payload as { values: Record<string, unknown> }).values).toMatchObject({
      customer_id: CUSTOMER,
      service_alerts: ['celiac'],
    })
    expectNoContact(prepared.ticket)
  })

  it('cuando se confirma corre la acción real y lleva a la ficha', async () => {
    stubNewReservation()
    const prepared = asPrepared(await run('preparar_reserva', { nombre: 'Ana', personas: 2 }, HOST))
    vi.mocked(createSalonReservation).mockResolvedValue({
      ok: true,
      message: 'Reserva creada.',
      data: { id: RES },
    })
    const execution = execOk(await executor('agenda.reserva').run(prepared.payload, HOST))
    expect(createSalonReservation).toHaveBeenCalledWith(
      'bar',
      (prepared.payload as { values: Record<string, unknown> }).values,
    )
    expect(execution).toMatchObject({
      message: 'Reserva creada.',
      href: `/bar/reservas/${RES}`,
      data: { id: RES },
    })
  })

  it('si la acción dice que no, el tique falla con su mensaje', async () => {
    stubNewReservation()
    const prepared = asPrepared(await run('preparar_reserva', { nombre: 'Ana', personas: 2 }, HOST))
    vi.mocked(createSalonReservation).mockResolvedValue({
      ok: false,
      message: 'No tenés permiso para esa acción.',
    })
    const execution = await executor('agenda.reserva').run(prepared.payload, HOST)
    expect(execution).toEqual({
      ok: false,
      kind: 'failed',
      message: 'No tenés permiso para esa acción.',
    })
  })

  describe('el cupo al confirmar', () => {
    const preparedOver = async () => {
      stubNewReservation()
      return asPrepared(await run('preparar_reserva', { nombre: 'Ana', personas: 6 }, HOST))
    }

    it('si se llenó mientras tanto, vuelve al tique con el aviso; a la segunda, se carga', async () => {
      const prepared = await preparedOver()
      expect((prepared.payload as { capacityAck: boolean }).capacityAck).toBe(false)
      vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(
        snapshot(
          [reservation({ reservation_date: CTX.today, estimated_guests: 118 })],
          [],
          CTX.today,
        ),
      )
      const first = await executor('agenda.reserva').run(prepared.payload, HOST)
      if (first.ok || first.kind !== 'review') throw new Error(JSON.stringify(first))
      expect(first.warnings[0]).toMatchObject({
        key: 'over_capacity',
        title: 'Te pasás del cupo de la cena',
      })
      expect(createSalonReservation).not.toHaveBeenCalled()
      expect((first.payload as { capacityAck: boolean }).capacityAck).toBe(true)

      vi.mocked(createSalonReservation).mockResolvedValue({ ok: true, data: { id: RES } })
      execOk(await executor('agenda.reserva').run(first.payload, HOST))
      expect(createSalonReservation).toHaveBeenCalledTimes(1)
    })

    it('si no se puede leer el cupo, no bloquea', async () => {
      const prepared = await preparedOver()
      vi.mocked(getDaySegmentsSnapshot).mockRejectedValue(new Error('caída'))
      vi.mocked(createSalonReservation).mockResolvedValue({ ok: true, data: { id: RES } })
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      execOk(await executor('agenda.reserva').run(prepared.payload, HOST))
      expect(createSalonReservation).toHaveBeenCalledTimes(1)
    })

    it('el tique que ya avisó no vuelve a preguntar', async () => {
      stubNewReservation()
      vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(
        snapshot(
          [reservation({ reservation_date: CTX.today, estimated_guests: 118 })],
          [],
          CTX.today,
        ),
      )
      const prepared = asPrepared(
        await run('preparar_reserva', { nombre: 'Ana', personas: 6 }, HOST),
      )
      expect((prepared.payload as { capacityAck: boolean }).capacityAck).toBe(true)
      vi.mocked(createSalonReservation).mockResolvedValue({ ok: true, data: { id: RES } })
      execOk(await executor('agenda.reserva').run(prepared.payload, HOST))
    })
  })

  it('un payload roto no llega a la acción', async () => {
    const execution = await executor('agenda.reserva').run({ values: 'roto' }, HOST)
    expect(execution).toMatchObject({ ok: false, kind: 'failed' })
    expect(createSalonReservation).not.toHaveBeenCalled()
  })

  describe('cambiar', () => {
    it('al confirmar vuelve a leer la fila: lo que cambió otro no se pisa', async () => {
      vi.mocked(getSalonReservation).mockResolvedValue(reservation())
      vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(snapshot())
      const prepared = asPrepared(
        await run('preparar_cambio_reserva', { reserva: RES, personas: 6 }, HOST),
      )
      expect(prepared.executor).toBe('agenda.cambio_reserva')
      expect(updateSalonReservation).not.toHaveBeenCalled()

      // Mientras el tique estaba abierto, alguien le cargó una nota.
      vi.mocked(getSalonReservation).mockResolvedValue(reservation({ comments: 'Nota de otro' }))
      vi.mocked(updateSalonReservation).mockResolvedValue({
        ok: true,
        message: 'Reserva actualizada.',
      })
      const execution = execOk(await executor('agenda.cambio_reserva').run(prepared.payload, HOST))
      expect(updateSalonReservation).toHaveBeenCalledWith(
        'bar',
        expect.objectContaining({ id: RES, estimated_guests: 6, comments: 'Nota de otro' }),
      )
      expect(execution).toMatchObject({ href: `/bar/reservas/${RES}`, data: { id: RES } })
      expectNoContact(execution.data)
    })

    it('la nota se suma a la que haya al confirmar, no a la de cuando se armó el tique', async () => {
      vi.mocked(getSalonReservation).mockResolvedValue(reservation({ comments: 'Trae torta' }))
      const prepared = asPrepared(
        await run('preparar_cambio_reserva', { reserva: RES, nota: 'Silla de bebé' }, HOST),
      )
      vi.mocked(getSalonReservation).mockResolvedValue(
        reservation({ comments: 'Trae torta\nLlegan tarde' }),
      )
      vi.mocked(updateSalonReservation).mockResolvedValue({ ok: true })
      execOk(await executor('agenda.cambio_reserva').run(prepared.payload, HOST))
      expect(updateSalonReservation).toHaveBeenCalledWith(
        'bar',
        expect.objectContaining({ comments: 'Trae torta\nLlegan tarde\nSilla de bebé' }),
      )
    })

    it('reemplazar la nota la deja como la dijo', async () => {
      vi.mocked(getSalonReservation).mockResolvedValue(reservation({ comments: 'Trae torta' }))
      const prepared = asPrepared(
        await run(
          'preparar_cambio_reserva',
          { reserva: RES, nota: 'Otra', reemplazar_nota: true },
          HOST,
        ),
      )
      vi.mocked(updateSalonReservation).mockResolvedValue({ ok: true })
      execOk(await executor('agenda.cambio_reserva').run(prepared.payload, HOST))
      expect(updateSalonReservation).toHaveBeenCalledWith(
        'bar',
        expect.objectContaining({ comments: 'Otra' }),
      )
    })

    it('pasarla a un evento con el flow prendido lo dice, si tiene ficha', async () => {
      const flows = [
        {
          id: RES,
          name: 'Recordatorio',
          trigger_type: 'event_starting' as const,
          active: true,
          updated_at: '2026-11-01T12:00:00Z',
          step_count: 1,
        },
      ]
      vi.mocked(listFlows).mockResolvedValue(flows)
      vi.mocked(getFlow).mockResolvedValue({
        id: RES,
        name: 'Recordatorio',
        trigger_type: 'event_starting',
        trigger_config: {},
        active: true,
        steps: [],
      })
      vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(snapshot([], [event()]))
      vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([event()])
      vi.mocked(getSalonReservation).mockResolvedValue(reservation({ customer_id: CUSTOMER }))
      const withFile = asPrepared(
        await run('preparar_cambio_reserva', { reserva: RES, evento: 'noche' }, HOST),
      )
      const warning = withFile.ticket.warnings.find((w) => w.key === 'event_flow')
      expect(warning?.body).toContain('24 h antes')

      vi.mocked(getSalonReservation).mockResolvedValue(reservation())
      const withoutFile = asPrepared(
        await run('preparar_cambio_reserva', { reserva: RES, evento: 'noche' }, HOST),
      )
      expect(withoutFile.ticket.warnings.map((w) => w.key)).not.toContain('event_flow')
    })

    it('si se borró mientras tanto, lo dice', async () => {
      vi.mocked(getSalonReservation).mockResolvedValue(null)
      const execution = await executor('agenda.cambio_reserva').run(
        {
          id: RES,
          save: 'completa',
          patch: { estimated_guests: 6 },
          candidate: null,
          capacityAck: true,
        },
        HOST,
      )
      expect(execution).toMatchObject({ ok: false, message: 'Esa reserva ya no está.' })
    })

    it('la mesa va por su acción, sin mandar la reserva entera', async () => {
      vi.mocked(getSalonReservation).mockResolvedValue(reservation())
      vi.mocked(listTimelineForDate).mockResolvedValue([
        reservation({ id: RES2, guest_name: 'Pedro', status: 'arrived', table_label: '12' }),
      ])
      const prepared = asPrepared(
        await run('preparar_cambio_reserva', { reserva: RES, mesa: '12' }, HOST),
      )
      expect(prepared.ticket.warnings[0]?.title).toBe('La mesa 12 ya la tiene Pedro')
      vi.mocked(updateReservationTableLabel).mockResolvedValue({
        ok: true,
        message: 'Mesa 12 asignada.',
        data: { row: { id: RES, guest_phone: PHONE } },
      })
      const execution = execOk(await executor('agenda.cambio_reserva').run(prepared.payload, HOST))
      expect(updateReservationTableLabel).toHaveBeenCalledWith('bar', {
        id: RES,
        table_label: '12',
      })
      expect(updateSalonReservation).not.toHaveBeenCalled()
      expect(execution.message).toBe('Mesa 12 asignada.')
      expectNoContact(execution.data)
    })

    it('los que vinieron van por su acción', async () => {
      vi.mocked(getSalonReservation).mockResolvedValue(reservation({ status: 'arrived' }))
      vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(snapshot())
      const prepared = asPrepared(
        await run('preparar_cambio_reserva', { reserva: RES, personas: 3 }, HOST),
      )
      vi.mocked(updateActualGuests).mockResolvedValue({ ok: true })
      execOk(await executor('agenda.cambio_reserva').run(prepared.payload, HOST))
      expect(updateActualGuests).toHaveBeenCalledWith('bar', { id: RES, actual_guests: 3 })
    })

    it('por nombre, si hay más de una, vuelve con las opciones', async () => {
      // Las dos tienen que ser de hoy en adelante: con el reloj de verdad, desde el 09/11 la del sábado 07
      // ya pasó y quedaba una sola.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-07T15:00:00Z') })
      vi.mocked(searchReservationsByGuest).mockResolvedValue([
        {
          id: RES,
          guest_name: 'Ana García',
          reservation_date: DAY,
          reservation_time_local: '21:00',
          guests: 4,
          status: 'pending',
          segment: 'dinner',
          eventName: null,
        },
        {
          id: RES2,
          guest_name: 'Ana García',
          reservation_date: '2026-11-14',
          reservation_time_local: '21:00',
          guests: 2,
          status: 'pending',
          segment: 'dinner',
          eventName: null,
        },
      ])
      const message = asError(
        await run('preparar_cambio_reserva', { reserva: 'Ana', personas: 6 }, HOST),
      )
      expect(message).toContain(RES)
      expect(message).toContain(RES2)
      expect(updateSalonReservation).not.toHaveBeenCalled()
    })

    it('una fecha que no existe no llega a la base', () => {
      const tool = toolNamed(agendaArea.tools, 'preparar_cambio_reserva')
      expect(tool.input.safeParse({ reserva: RES, fecha: '2026-02-31' }).success).toBe(false)
    })
  })

  describe('el estado', () => {
    it('la noche de hoy lleva al tablero y señala a la persona', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-08T04:30:00Z') })
      vi.mocked(transitionStatus).mockResolvedValue({ ok: true })
      const execution = execOk(
        await executor('agenda.estado_reserva').run(
          { id: RES, to: 'arrived', actual_guests: null, date: DAY, name: 'Ana García' },
          HOST,
        ),
      )
      expect(transitionStatus).toHaveBeenCalledWith('bar', { id: RES, to: 'arrived' })
      expect(execution).toMatchObject({
        href: '/bar/operativo',
        point: 'Ana García',
        message: 'Marqué que llegó.',
      })
    })

    it('otro día lleva a la ficha', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:00:00Z') })
      vi.mocked(transitionStatus).mockResolvedValue({ ok: true })
      const execution = execOk(
        await executor('agenda.estado_reserva').run(
          { id: RES, to: 'no_show', actual_guests: null, date: DAY, name: 'Ana García' },
          HOST,
        ),
      )
      expect(execution).toMatchObject({ href: `/bar/reservas/${RES}`, point: null })
    })

    it('la mesa viaja en el mismo gesto; un aviso de la acción llega tal cual', async () => {
      vi.mocked(transitionStatus).mockResolvedValue({
        ok: true,
        message: 'Se marcó la llegada, pero no pudimos guardar la mesa. Asignala de nuevo.',
      })
      const execution = execOk(
        await executor('agenda.estado_reserva').run(
          { id: RES, to: 'arrived', actual_guests: 5, table_label: '12', date: DAY, name: 'Ana' },
          HOST,
        ),
      )
      expect(transitionStatus).toHaveBeenCalledWith('bar', {
        id: RES,
        to: 'arrived',
        actual_guests: 5,
        table_label: '12',
      })
      expect(execution.message).toContain('no pudimos guardar la mesa')
    })

    it('cerrar va por closeTable, que encadena llegó → sentada → cerrada', async () => {
      vi.mocked(closeTable).mockResolvedValue({ ok: true, message: 'Mesa cerrada.' })
      execOk(
        await executor('agenda.estado_reserva').run(
          { id: RES, to: 'closed', actual_guests: 5, date: DAY, name: 'Ana' },
          HOST,
        ),
      )
      expect(closeTable).toHaveBeenCalledWith('bar', { id: RES, actual_guests: 5 })
      expect(transitionStatus).not.toHaveBeenCalled()
    })

    it('«llegó García» es la de esta noche, aunque tenga otra más adelante', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-08T00:00:00Z') }) // sábado 21:00
      const row = (id: string, date: string): ReservationSearchResult => ({
        id,
        guest_name: 'Ana García',
        reservation_date: date,
        reservation_time_local: '21:00',
        guests: 4,
        status: 'pending',
        segment: 'dinner',
        eventName: null,
      })
      vi.mocked(searchReservationsByGuest).mockResolvedValue([
        row(RES, DAY),
        row(RES2, '2026-12-05'),
      ])
      vi.mocked(getSalonReservation).mockResolvedValue(reservation())
      const prepared = asPrepared(
        await run('preparar_estado_reserva', { reserva: 'García', estado: 'llego' }, HOST),
      )
      expect(getSalonReservation).toHaveBeenCalledWith({ tenantId: TENANT, id: RES })
      expect((prepared.payload as { to: string }).to).toBe('arrived')

      // Si esta noche no tiene, se busca como siempre: con dos para adelante, se pregunta.
      vi.mocked(searchReservationsByGuest).mockResolvedValue([
        row(RES, '2026-12-01'),
        row(RES2, '2026-12-05'),
      ])
      expect(
        asError(await run('preparar_estado_reserva', { reserva: 'García', estado: 'llego' }, HOST)),
      ).toContain('Preguntale cuál')
    })

    it('un estado que no se puede cancelar por acá no pasa', async () => {
      const execution = await executor('agenda.estado_reserva').run(
        { id: RES, to: 'cancelled', actual_guests: null, date: DAY, name: 'Ana' },
        HOST,
      )
      expect(execution).toMatchObject({ ok: false, kind: 'failed' })
      expect(transitionStatus).not.toHaveBeenCalled()
    })
  })

  it('cancelar corre la acción con el motivo', async () => {
    vi.mocked(getSalonReservation).mockResolvedValue(reservation({ deposit_cents: 1_000_000 }))
    const prepared = asPrepared(
      await run('preparar_cancelar_reserva', { reserva: RES, motivo: 'Avisó' }, HOST),
    )
    expect(prepared.ticket.warnings[0]?.key).toBe('deposit')
    vi.mocked(cancelSalonReservation).mockResolvedValue({ ok: true, message: 'Reserva cancelada.' })
    const execution = execOk(await executor('agenda.cancelar_reserva').run(prepared.payload, HOST))
    expect(cancelSalonReservation).toHaveBeenCalledWith('bar', { id: RES, reason: 'Avisó' })
    expect(execution.href).toBe(`/bar/reservas/${RES}`)
  })

  describe('eventos', () => {
    beforeEach(() => {
      vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(snapshot())
      vi.mocked(listScheduledEventsForDate).mockResolvedValue([])
      vi.mocked(listScheduledTemplates).mockResolvedValue([template()])
      vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([event()])
      vi.mocked(listSalonReservations).mockResolvedValue({ rows: [], total: 0 })
    })

    it('uno nuevo pide formato y fecha', async () => {
      expect(asError(await run('preparar_evento', { fecha: DAY }, HOST))).toContain('qué formato')
      expect(asError(await run('preparar_evento', { formato: 'x' }, HOST))).toContain('qué fecha')
    })

    it('se programa con la acción real', async () => {
      const prepared = asPrepared(
        await run('preparar_evento', { formato: 'noche', fecha: DAY }, HOST),
      )
      vi.mocked(upsertScheduledEvent).mockResolvedValue({ ok: true, data: { id: EVENT } })
      const execution = execOk(await executor('agenda.evento').run(prepared.payload, HOST))
      expect(moveScheduledEvent).not.toHaveBeenCalled()
      expect(upsertScheduledEvent).toHaveBeenCalledWith(
        'bar',
        expect.objectContaining({ template_id: TEMPLATE, event_date: DAY, capacity: 40 }),
      )
      expect(execution).toMatchObject({
        message: 'Evento programado.',
        href: `/bar/eventos/programados/${EVENT}`,
      })
    })

    it('moverlo pasa por la acción que controla las reservas, y si no puede, corta', async () => {
      const prepared = asPrepared(
        await run('preparar_evento', { evento: 'noche', fecha: '2026-11-14', cupo: 80 }, HOST),
      )
      vi.mocked(moveScheduledEvent).mockResolvedValue({
        ok: false,
        message: 'No se puede mover: el evento tiene 1 reserva activa atadas.',
      })
      const blocked = await executor('agenda.evento').run(prepared.payload, HOST)
      expect(blocked).toMatchObject({ ok: false, kind: 'failed' })
      expect(upsertScheduledEvent).not.toHaveBeenCalled()

      vi.mocked(moveScheduledEvent).mockResolvedValue({ ok: true, message: 'Evento movido.' })
      vi.mocked(upsertScheduledEvent).mockResolvedValue({ ok: true, data: { id: EVENT } })
      const execution = execOk(await executor('agenda.evento').run(prepared.payload, HOST))
      expect(moveScheduledEvent).toHaveBeenCalledWith('bar', {
        id: EVENT,
        event_date: '2026-11-14',
      })
      expect(upsertScheduledEvent).toHaveBeenCalledWith(
        'bar',
        expect.objectContaining({ id: EVENT, capacity: 80 }),
      )
      expect(execution.message).toBe('Evento actualizado.')
    })

    it('si solo cambia de día, no hace falta nada más', async () => {
      const prepared = asPrepared(
        await run('preparar_evento', { evento: 'noche', fecha: '2026-11-14' }, HOST),
      )
      vi.mocked(moveScheduledEvent).mockResolvedValue({ ok: true, message: 'Evento movido.' })
      execOk(await executor('agenda.evento').run(prepared.payload, HOST))
      expect(upsertScheduledEvent).not.toHaveBeenCalled()
    })

    it('cancelarlo: con reservas no; sin reservas corre la acción', async () => {
      vi.mocked(listSalonReservations).mockResolvedValue({ rows: [reservation()], total: 1 })
      expect(asError(await run('preparar_cancelar_evento', { evento: 'noche' }, HOST))).toContain(
        '1 reserva activa',
      )
      vi.mocked(listSalonReservations).mockResolvedValue({
        rows: [reservation({ status: 'cancelled', zone: 'event_floating' })],
        total: 1,
      })
      expect(asError(await run('preparar_cancelar_evento', { evento: 'noche' }, HOST))).toContain(
        'sin planta',
      )
      vi.mocked(listSalonReservations).mockResolvedValue({ rows: [], total: 0 })
      const prepared = asPrepared(await run('preparar_cancelar_evento', { evento: 'noche' }, HOST))
      vi.mocked(deleteScheduledEvent).mockResolvedValue({ ok: true })
      const execution = execOk(await executor('agenda.cancelar_evento').run(prepared.payload, HOST))
      expect(deleteScheduledEvent).toHaveBeenCalledWith('bar', EVENT)
      expect(execution).toMatchObject({
        message: 'Evento cancelado.',
        href: '/bar/eventos/programados',
      })
    })

    it('un formato nuevo o editado corre la acción y lleva a su solapa', async () => {
      const prepared = asPrepared(
        await run('preparar_formato', { nombre: 'Noche de jazz', cupo: 50 }, HOST),
      )
      vi.mocked(upsertScheduledTemplate).mockResolvedValue({ ok: true, data: { id: TEMPLATE } })
      const execution = execOk(await executor('agenda.formato').run(prepared.payload, HOST))
      expect(upsertScheduledTemplate).toHaveBeenCalledWith(
        'bar',
        expect.objectContaining({ name: 'Noche de jazz', slug: 'noche-de-jazz' }),
      )
      expect(execution).toMatchObject({
        message: 'Formato creado.',
        href: '/bar/eventos/programados?tab=eventos',
        point: 'Noche de jazz',
      })
    })
  })

  it('el cupo especial corre la acción con lo que pasó el zod', async () => {
    vi.mocked(getDaySegmentsSnapshot).mockResolvedValue(snapshot())
    const prepared = asPrepared(
      await run('preparar_cupo_especial', { fecha: DAY, servicio: 'cena', cupo: 150 }),
    )
    expect(prepared.executor).toBe('agenda.cupo_especial')
    vi.mocked(upsertSegmentOverride).mockResolvedValue({
      ok: true,
      data: { previous: null },
      message: 'Cupo especial guardado.',
    })
    const execution = execOk(await executor('agenda.cupo_especial').run(prepared.payload, CTX))
    expect(upsertSegmentOverride).toHaveBeenCalledWith(
      'bar',
      expect.objectContaining({ override_date: DAY, segment: 'dinner', capacity: 150 }),
    )
    expect(execution.href).toBe('/bar/eventos/programados')
  })

  it('ver_eventos sin período mira los próximos 60 días, aunque toquen cuatro meses', async () => {
    vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([])
    vi.mocked(getMonthSegments).mockResolvedValue(
      computeMonthSegments({
        ym: '2027-01',
        reservations: [],
        events: [],
        config: { weekly: [], overrides: [], settings: [], fallbackTotal: 120 },
      }),
    )
    const data = asData(await run('ver_eventos', {}, { ...HOST, today: '2027-01-31' }))
    expect(data).toMatchObject({ cuantos: 0, filas: [], hay_mas: false })
    expect(getMonthSegments).toHaveBeenCalledTimes(4)
  })

  it('ver_eventos cuenta con el mes y filtra por formato', async () => {
    const e = event()
    vi.mocked(listScheduledEventsForDateRange).mockResolvedValue([
      e,
      event({ id: RES2, name_override: 'Otra noche', event_date: '2026-11-14', template: null }),
    ])
    vi.mocked(getMonthSegments).mockResolvedValue(
      computeMonthSegments({
        ym: '2026-11',
        reservations: [reservation({ scheduled_event_id: EVENT, estimated_guests: 12 })],
        events: [segmentEvent(e)],
        config: { weekly: [], overrides: [], settings: [], fallbackTotal: 120 },
      }),
    )
    const data = asData(
      await run('ver_eventos', { mes: '2026-11', formato: 'noche tematica' }, HOST),
    ) as { cuantos: number; filas: Array<Record<string, unknown>> }
    expect(data.cuantos).toBe(1)
    expect(data.filas[0]).toMatchObject({
      id: EVENT,
      fecha: '07/11/2026',
      dia: 'sábado',
      nombre: 'Noche temática',
      servicio: 'Cena',
      cupo: 40,
      personas: 12,
      libres: 28,
      reservas: 1,
    })
    expect(
      asError(await run('ver_eventos', { desde: '2026-01-01', hasta: '2026-12-31' }, HOST)),
    ).toContain('hasta 4 meses')
  })

  it('el resultado de un tique pasa a Tex sin datos de más', () => {
    expect(toSimpleState({ ok: true, message: '' }, { id: RES }, 'Listo.')).toEqual({
      ok: true,
      data: { id: RES },
      message: 'Listo.',
    })
    expect(toSimpleState({ ok: false, message: 'No', field: 'x' }, null, 'Listo.')).toMatchObject({
      ok: false,
      code: 'invalid',
      message: 'No',
    })
    expect(toSimpleState({ ok: false, message: 'No' }, null, 'Listo.')).toMatchObject({
      code: 'error',
    })
  })
})
