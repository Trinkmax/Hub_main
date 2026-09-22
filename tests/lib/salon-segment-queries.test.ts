import { revalidatePath } from 'next/cache'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logAudit } from '@/lib/audit'
import { createSalonReservation } from '@/lib/salon/actions'
import {
  fetchDayOverview,
  fetchDaySegments,
  removeSegmentOverride,
  saveSegmentConfig,
  searchReservations,
  upsertSegmentOverride,
} from '@/lib/salon/segment-actions'
import { getMonthSegments } from '@/lib/salon/segment-queries'
import {
  collectPages,
  fallbackTotalFromSettings,
  isMissingTableError,
  mapSearchRow,
  SEGMENT_RES_SELECT,
  searchTerms,
  toOverrideRows,
  toSegmentEventInput,
  toSegmentReservationInput,
  toSettingRows,
  toWeeklyCapRows,
  zoneCapsFromSettings,
} from '@/lib/salon/segment-rows'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'

// ──────────────────────────────────────────────────────────
// Mocks de la capa server (solo afectan a las actions; segment-rows es puro)
// ──────────────────────────────────────────────────────────

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/tenant', async () => {
  // Roles y errores reales: el test tiene que fallar si alguien cambia el set
  // de roles de una action. Solo se reemplaza la lectura de la membership.
  const roles = await vi.importActual<typeof import('@/lib/tenant/roles')>('@/lib/tenant/roles')
  const errors = await vi.importActual<typeof import('@/lib/tenant/errors')>('@/lib/tenant/errors')
  return {
    ...roles,
    ...errors,
    requireTenantAccess: vi.fn(),
    requireRole: (role: TenantRole, allowed: ReadonlyArray<TenantRole>) => {
      if (!allowed.includes(role)) throw new errors.RoleRequiredError()
    },
  }
})

const TENANT = 'tenant-a'
const USER = 'user-a'
const MANAGER = '11111111-2222-4333-8444-555555555555'

function asRole(role: TenantRole) {
  vi.mocked(requireTenantAccess).mockResolvedValue({
    tenant: { id: TENANT },
    role,
    user: { id: USER },
  } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
}

// ──────────────────────────────────────────────────────────
// Cliente de Supabase falso: registra cada query y la resuelve con un handler
// ──────────────────────────────────────────────────────────

type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete'
type Call = {
  table: string
  op: Op
  columns?: string
  payload?: unknown
  options?: unknown
  filters: Array<[string, ...unknown[]]>
}
type Result = { data: unknown; error: { code?: string; message: string } | null }
type Handler = (call: Call) => Result

class FakeQuery implements PromiseLike<Result> {
  constructor(
    private readonly call: Call,
    private readonly handler: Handler,
  ) {}
  select(columns?: string) {
    if (this.call.op === 'select') this.call.columns = columns
    return this
  }
  insert(payload: unknown) {
    this.call.op = 'insert'
    this.call.payload = payload
    return this
  }
  upsert(payload: unknown, options?: unknown) {
    this.call.op = 'upsert'
    this.call.payload = payload
    this.call.options = options
    return this
  }
  update(payload: unknown) {
    this.call.op = 'update'
    this.call.payload = payload
    return this
  }
  delete() {
    this.call.op = 'delete'
    return this
  }
  private filter(name: string, args: unknown[]) {
    this.call.filters.push([name, ...args])
    return this
  }
  eq(...args: unknown[]) {
    return this.filter('eq', args)
  }
  gte(...args: unknown[]) {
    return this.filter('gte', args)
  }
  lte(...args: unknown[]) {
    return this.filter('lte', args)
  }
  not(...args: unknown[]) {
    return this.filter('not', args)
  }
  in(...args: unknown[]) {
    return this.filter('in', args)
  }
  or(...args: unknown[]) {
    return this.filter('or', args)
  }
  ilike(...args: unknown[]) {
    return this.filter('ilike', args)
  }
  order(...args: unknown[]) {
    return this.filter('order', args)
  }
  range(...args: unknown[]) {
    return this.filter('range', args)
  }
  limit(...args: unknown[]) {
    return this.filter('limit', args)
  }
  maybeSingle() {
    return Promise.resolve(this.handler(this.call))
  }
  single() {
    return Promise.resolve(this.handler(this.call))
  }
  // biome-ignore lint/suspicious/noThenProperty: imita al builder thenable de supabase-js
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.handler(this.call)).then(onfulfilled, onrejected)
  }
}

function fakeSupabase(handler: Handler) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      calls.push(call)
      return new FakeQuery(call, handler)
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER } } })) },
  }
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  return calls
}

const OK_EMPTY: Result = { data: [], error: null }
const MISSING_TABLE: Result = {
  data: null,
  error: { code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" },
}
const TENANT_SETTINGS: Result = {
  data: { settings: { salon_capacities: { planta_alta: 60, planta_baja: 70 } } },
  error: null,
}

function filterOf(call: Call, name: string): unknown[] | undefined {
  return call.filters.find((f) => f[0] === name)?.slice(1)
}

// ──────────────────────────────────────────────────────────
// E) segment-rows (puro)
// ──────────────────────────────────────────────────────────

describe('collectPages', () => {
  it('junta 1000 + 1000 + 345 en 3 viajes (no corta en 1000)', async () => {
    const sizes = [1000, 1000, 345]
    const ranges: Array<[number, number]> = []
    const rows = await collectPages<number>(async (from, to) => {
      ranges.push([from, to])
      const size = sizes[ranges.length - 1] ?? 0
      return { data: Array.from({ length: size }, (_, i) => from + i), error: null }
    })
    expect(rows).toHaveLength(2345)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
    expect(rows[2344]).toBe(2344)
  })

  it('una página vacía corta', async () => {
    const fetchPage = vi.fn(async () => ({ data: [] as number[], error: null }))
    await expect(collectPages(fetchPage)).resolves.toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('data null cuenta como página vacía', async () => {
    const fetchPage = vi.fn(async () => ({ data: null, error: null }))
    await expect(collectPages<number>(fetchPage)).resolves.toEqual([])
  })

  it('un error corta con throw y conserva el código', async () => {
    const fetchPage = async () => ({
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    })
    await expect(collectPages(fetchPage)).rejects.toMatchObject({
      code: '42P01',
      message: 'relation does not exist',
    })
  })

  it('con maxPages 2 y páginas llenas devuelve 2000 y avisa por consola sin datos', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchPage = vi.fn(async (from: number) => ({
      data: Array.from({ length: 1000 }, (_, i) => ({ guest_name: `Cliente ${from + i}` })),
      error: null,
    }))
    const rows = await collectPages(fetchPage, { maxPages: 2 })
    expect(rows).toHaveLength(2000)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Cliente')
    warn.mockRestore()
  })

  it('respeta un pageSize propio', async () => {
    const ranges: Array<[number, number]> = []
    const rows = await collectPages<number>(
      async (from, to) => {
        ranges.push([from, to])
        return { data: ranges.length === 1 ? [1, 2] : [3], error: null }
      },
      { pageSize: 2 },
    )
    expect(rows).toEqual([1, 2, 3])
    expect(ranges).toEqual([
      [0, 1],
      [2, 3],
    ])
  })
})

describe('isMissingTableError', () => {
  it('reconoce la tabla inexistente de Postgres y de PostgREST', () => {
    expect(isMissingTableError({ code: '42P01', message: 'x' })).toBe(true)
    expect(isMissingTableError({ code: 'PGRST205', message: 'x' })).toBe(true)
  })
  it('no confunde otros errores con una migración pendiente', () => {
    expect(isMissingTableError({ code: '42501', message: 'x' })).toBe(false)
    expect(isMissingTableError(new Error('boom'))).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})

describe('toSegmentEventInput', () => {
  it('conserva id, fecha, hora, cupo, nombre y color, y saca el resto', () => {
    const out = toSegmentEventInput({
      id: 'e1',
      tenant_id: TENANT,
      template_id: 't1',
      event_date: '2026-09-10',
      starts_at_local: '21:00:00',
      ends_at_local: null,
      capacity: 70,
      meal_type: 'hub_event',
      name_override: null,
      notes: 'nota interna',
      template: { name: 'Sushi libre', color_hex: '#ff0000' },
    })
    expect(out).toEqual({
      id: 'e1',
      event_date: '2026-09-10',
      starts_at_local: '21:00:00',
      capacity: 70,
      name_override: null,
      template: { name: 'Sushi libre', color_hex: '#ff0000' },
    })
  })

  it('un template como array (embed de PostgREST) se aplana; sin template queda null', () => {
    const base = {
      id: 'e2',
      event_date: '2026-09-10',
      starts_at_local: '13:00:00',
      capacity: 40,
      name_override: 'Merienda y Arte',
    }
    const withArray = toSegmentEventInput({
      ...base,
      template: [{ name: 'Arte', color_hex: '#00ff00' }] as unknown as {
        name: string
        color_hex: string
      },
    })
    expect(withArray.template).toEqual({ name: 'Arte', color_hex: '#00ff00' })
    expect(toSegmentEventInput({ ...base, template: null }).template).toBeNull()
  })
})

describe('mapSearchRow', () => {
  const base = {
    id: 'r1',
    guest_name: 'Ana López',
    reservation_date: '2026-09-10',
    reservation_time_local: '21:30:00',
    estimated_guests: 4,
    actual_guests: null,
    status: 'pending',
  }

  it('con evento a las 21:00 → cena y nombre del evento, aunque meal_type diga lunch', () => {
    const out = mapSearchRow({
      ...base,
      meal_type: 'lunch',
      scheduled_event_id: 'e1',
      scheduled_event: {
        id: 'e1',
        starts_at_local: '21:00:00',
        name_override: null,
        template: { name: 'Ramen', color_hex: '#123456' },
      },
    })
    expect(out.segment).toBe('dinner')
    expect(out.eventName).toBe('Ramen')
    expect(out.reservation_time_local).toBe('21:30')
  })

  it('sin evento con meal tea_time → merienda', () => {
    const out = mapSearchRow({
      ...base,
      meal_type: 'tea_time',
      scheduled_event_id: null,
      scheduled_event: null,
    })
    expect(out.segment).toBe('tea_time')
    expect(out.eventName).toBeNull()
  })

  it('personas = reales si están cargadas, si no las estimadas', () => {
    expect(mapSearchRow({ ...base, meal_type: 'dinner', actual_guests: 6 }).guests).toBe(6)
    expect(mapSearchRow({ ...base, meal_type: 'dinner' }).guests).toBe(4)
  })

  it('el evento embebido como array también se lee', () => {
    const out = mapSearchRow({
      ...base,
      meal_type: 'dinner',
      scheduled_event: [
        { id: 'e2', starts_at_local: '16:00:00', name_override: 'Merienda Libre', template: null },
      ],
    })
    expect(out.segment).toBe('tea_time')
    expect(out.eventName).toBe('Merienda Libre')
  })
})

describe('searchTerms', () => {
  it('saca lo que rompe el or() de PostgREST y los comodines', () => {
    expect(searchTerms('López (3513)')).toEqual({ name: 'López 3513', digits: '3513' })
    expect(searchTerms('a%b,c*d"e\\f')).toEqual({ name: 'a b c d e f', digits: null })
  })
  it('menos de 2 caracteres útiles no busca por nombre; menos de 4 dígitos no busca teléfono', () => {
    expect(searchTerms('%%')).toEqual({ name: null, digits: null })
    expect(searchTerms('lo')).toEqual({ name: 'lo', digits: null })
    expect(searchTerms('351')).toEqual({ name: '351', digits: null })
    expect(searchTerms('+54 351 300')).toEqual({ name: '+54 351 300', digits: '54351300' })
  })
})

describe('mappers de config', () => {
  it('toWeeklyCapRows descarta servicios y días inválidos y convierte números', () => {
    const out = toWeeklyCapRows([
      { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
      { segment: 'dinner', iso_dow: '7', capacity: '120', warn_at: null },
      { segment: 'breakfast', iso_dow: 1, capacity: 10, warn_at: null },
      { segment: 'lunch', iso_dow: 8, capacity: 10, warn_at: null },
    ])
    expect(out).toEqual([
      { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
      { segment: 'dinner', iso_dow: 7, capacity: 120, warn_at: null },
    ])
  })

  it('toSettingRows recorta la columna time a HH:MM', () => {
    expect(
      toSettingRows([{ segment: 'lunch', default_time: '13:00:00', warn_note: 'Terraza' }]),
    ).toEqual([{ segment: 'lunch', default_time: '13:00', warn_note: 'Terraza' }])
  })

  it('toOverrideRows conserva el motivo y normaliza el vacío a null', () => {
    expect(
      toOverrideRows([
        { segment: 'lunch', override_date: '2026-10-12', capacity: 120, warn_at: null, reason: '' },
      ]),
    ).toEqual([
      { segment: 'lunch', override_date: '2026-10-12', capacity: 120, warn_at: null, reason: null },
    ])
  })

  it('toSegmentReservationInput: cake_count null cuenta 0 y los números llegan como number', () => {
    const out = toSegmentReservationInput({
      id: 'r1',
      reservation_date: '2026-09-10',
      meal_type: 'dinner',
      reservation_time_local: '21:00:00',
      scheduled_event_id: null,
      zone: 'planta_alta',
      status: 'arrived',
      estimated_guests: '4',
      actual_guests: null,
      kind: 'birthday',
      cake_count: null,
    })
    expect(out.estimated_guests).toBe(4)
    expect(out.actual_guests).toBeNull()
    expect(out.cake_count).toBe(0)
  })

  it('fallbackTotalFromSettings suma PA + PB; sin cupo cargado da 0 y lo que no es número cuenta 0', () => {
    expect(
      fallbackTotalFromSettings({ salon_capacities: { planta_alta: 60, planta_baja: 70 } }),
    ).toBe(130)
    expect(
      fallbackTotalFromSettings({ salon_capacities: { planta_alta: '60', planta_baja: 70 } }),
    ).toBe(130)
    expect(fallbackTotalFromSettings({ salon_capacities: { planta_alta: 60 } })).toBe(60)
    expect(
      fallbackTotalFromSettings({ salon_capacities: { planta_alta: 'abc', planta_baja: 70 } }),
    ).toBe(70)
    expect(fallbackTotalFromSettings({ otra_cosa: true })).toBe(0)
    expect(fallbackTotalFromSettings({ salon_capacities: null })).toBe(0)
    expect(fallbackTotalFromSettings(null)).toBe(0)
    expect(fallbackTotalFromSettings(undefined)).toBe(0)
  })

  it('zoneCapsFromSettings: cada planta por separado, con la misma tolerancia que el total', () => {
    expect(
      zoneCapsFromSettings({ salon_capacities: { planta_alta: 60, planta_baja: 70 } }),
    ).toEqual({ planta_alta: 60, planta_baja: 70 })
    expect(
      zoneCapsFromSettings({ salon_capacities: { planta_alta: '60', planta_baja: 'abc' } }),
    ).toEqual({ planta_alta: 60, planta_baja: 0 })
    expect(zoneCapsFromSettings({ salon_capacities: { planta_baja: 70 } })).toEqual({
      planta_alta: 0,
      planta_baja: 70,
    })
    expect(zoneCapsFromSettings({ salon_capacities: null })).toEqual({
      planta_alta: 0,
      planta_baja: 0,
    })
    expect(zoneCapsFromSettings(undefined)).toEqual({ planta_alta: 0, planta_baja: 0 })
  })

  it('el total y las plantas salen de la misma lectura: nunca se contradicen', () => {
    for (const settings of [
      { salon_capacities: { planta_alta: 60, planta_baja: 70 } },
      { salon_capacities: { planta_alta: '45', planta_baja: 'x' } },
      {},
      null,
    ]) {
      const caps = zoneCapsFromSettings(settings)
      expect(fallbackTotalFromSettings(settings)).toBe(caps.planta_alta + caps.planta_baja)
    }
  })

  it('SEGMENT_RES_SELECT no pide datos personales', () => {
    expect(SEGMENT_RES_SELECT).not.toMatch(/guest_name|guest_phone|guest_email|comments/)
  })
})

// ──────────────────────────────────────────────────────────
// Actions (con Supabase y la membership falsos)
// ──────────────────────────────────────────────────────────

describe('segment-actions: bordes y permisos', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.mocked(createClient).mockReset()
    vi.mocked(requireTenantAccess).mockReset()
    vi.mocked(logAudit).mockClear()
    vi.mocked(revalidatePath).mockClear()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('fetchDayOverview con una fecha inválida devuelve ok:false sin consultar la DB', async () => {
    asRole('owner')
    for (const bad of ['2026-02-30', '10/09/2026', '', '2026-09-10; drop']) {
      const res = await fetchDayOverview('hub', bad)
      expect(res.ok).toBe(false)
    }
    expect(requireTenantAccess).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('fetchDaySegments con una fecha inválida tampoco consulta', async () => {
    asRole('owner')
    const res = await fetchDaySegments('hub', '2026-13-01')
    expect(res).toEqual({ ok: false, message: 'La fecha no es válida.', field: 'date' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each([
    'host',
    'waiter',
  ] as const)('saveSegmentConfig, upsertSegmentOverride y removeSegmentOverride rechazan a %s', async (role) => {
    asRole(role)
    const save = await saveSegmentConfig('hub', { weekly: [], settings: [] })
    const upsert = await upsertSegmentOverride('hub', {
      override_date: '2026-10-12',
      segment: 'lunch',
      capacity: 120,
    })
    const remove = await removeSegmentOverride('hub', {
      override_date: '2026-10-12',
      segment: 'lunch',
    })
    for (const res of [save, upsert, remove]) {
      expect(res).toEqual({ ok: false, message: 'No tenés permiso para esa acción.' })
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('searchReservations: el mozo no busca (trae nombres) y 1 letra no llega a la base', async () => {
    asRole('waiter')
    expect(await searchReservations('hub', 'lopez')).toEqual({
      ok: false,
      message: 'No tenés permiso para esa acción.',
    })
    asRole('host')
    const short = await searchReservations('hub', 'l')
    expect(short.ok).toBe(false)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('un fallo de red en la membership no se disfraza de "no tenés permiso"', async () => {
    vi.mocked(requireTenantAccess).mockRejectedValue(new Error('tenant_access_failed'))
    const res = await fetchDayOverview('hub', '2026-09-10')
    expect(res).toEqual({ ok: false, message: 'No pudimos leer el día. Probá de nuevo.' })
  })
})

describe('segment-queries: migración pendiente y paginación', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.mocked(createClient).mockReset()
    asRole('host')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('sin las tablas nuevas (PGRST205) cae al cupo general PA + PB y no se rompe', async () => {
    fakeSupabase((call) => {
      if (call.table.startsWith('salon_segment_')) return MISSING_TABLE
      if (call.table === 'tenants') return TENANT_SETTINGS
      if (call.table === 'salon_reservations') {
        return {
          data: [
            {
              id: 'r1',
              reservation_date: '2026-09-10',
              meal_type: 'dinner',
              reservation_time_local: '21:00:00',
              scheduled_event_id: null,
              zone: 'planta_alta',
              status: 'pending',
              estimated_guests: 4,
              actual_guests: null,
              kind: 'normal',
              cake_count: 0,
            },
          ],
          error: null,
        }
      }
      return OK_EMPTY
    })
    const res = await fetchDaySegments('hub', '2026-09-10')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.caps.dinner).toMatchObject({ capacity: 130, source: 'fallback' })
    expect(res.data.caps.lunch).toMatchObject({ capacity: 130, source: 'fallback' })
    expect(res.data.settings.tea_time.defaultTime).toBe('15:30')
    expect(res.data.reservations).toHaveLength(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('con 42P01 (error de Postgres) también cae al fallback', async () => {
    fakeSupabase((call) => {
      if (call.table.startsWith('salon_segment_')) {
        return { data: null, error: { code: '42P01', message: 'relation does not exist' } }
      }
      if (call.table === 'tenants') return TENANT_SETTINGS
      return OK_EMPTY
    })
    const res = await fetchDayOverview('hub', '2026-09-10')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.caps.dinner.capacity).toBe(130)
    expect(res.data.isoDow).toBe(4)
    expect(res.data.suggestedRaise).toEqual({ lunch: null, tea_time: null, dinner: null })
    // El cupo de cada planta viaja para el filtro de planta de la vista del día.
    expect(res.data.zoneCaps).toEqual({ planta_alta: 60, planta_baja: 70 })
  })

  it('otro error de la config NO se tapa con el fallback: ok:false y log con tenant y código', async () => {
    fakeSupabase((call) => {
      if (call.table === 'salon_segment_capacities') {
        return { data: null, error: { code: '08006', message: 'connection failure' } }
      }
      if (call.table === 'tenants') return TENANT_SETTINGS
      return OK_EMPTY
    })
    const res = await fetchDaySegments('hub', '2026-09-10')
    expect(res).toEqual({ ok: false, message: 'No pudimos leer el día. Probá de nuevo.' })
    expect(errorSpy).toHaveBeenCalledWith('[salon.segments.daySegments]', {
      tenantId: TENANT,
      code: '08006',
    })
  })

  it('si falla la lectura del cupo general NO cae en silencio a "sin tope": ok:false y log con el código', async () => {
    // Celda vaciada → ese día usa el cupo general. Un timeout en tenants antes
    // dejaba fallbackTotal en 0 ("sin tope"): sin semáforo y sin confirmar el
    // sobrecupo al guardar.
    fakeSupabase((call) => {
      if (call.table === 'tenants') {
        return {
          data: null,
          error: { code: '57014', message: 'canceling statement due to timeout' },
        }
      }
      return OK_EMPTY
    })
    const res = await fetchDaySegments('hub', '2026-09-10')
    expect(res).toEqual({ ok: false, message: 'No pudimos leer el día. Probá de nuevo.' })
    expect(errorSpy).toHaveBeenCalledWith('[salon.segments.daySegments]', {
      tenantId: TENANT,
      code: '57014',
    })
  })

  it('sin cupo general cargado (tenant sin salon_capacities) sí es "sin tope"', async () => {
    const calls = fakeSupabase((call) => {
      if (call.table === 'tenants') return { data: { settings: {} }, error: null }
      return OK_EMPTY
    })
    const res = await fetchDaySegments('hub', '2026-09-10')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.caps.dinner).toMatchObject({ capacity: null, source: 'none' })
    const tenantsCall = calls.find((c) => c.table === 'tenants')
    expect(filterOf(tenantsCall as Call, 'eq')).toEqual(['id', TENANT])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('con la config cargada resuelve el cupo semanal y sugiere subir el almuerzo', async () => {
    fakeSupabase((call) => {
      if (call.table === 'salon_segment_capacities') {
        return {
          data: [
            { segment: 'lunch', iso_dow: 4, capacity: 70, warn_at: 50 },
            { segment: 'lunch', iso_dow: 6, capacity: 120, warn_at: null },
          ],
          error: null,
        }
      }
      if (call.table === 'salon_segment_settings') {
        return {
          data: [{ segment: 'lunch', default_time: '12:30:00', warn_note: 'Abrí la terraza' }],
          error: null,
        }
      }
      if (call.table === 'tenants') return TENANT_SETTINGS
      return OK_EMPTY
    })
    const res = await fetchDayOverview('hub', '2026-09-10')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.caps.lunch).toMatchObject({
      capacity: 70,
      warnAt: 50,
      warnNote: 'Abrí la terraza',
      source: 'weekly',
    })
    expect(res.data.settings.lunch.defaultTime).toBe('12:30')
    expect(res.data.suggestedRaise.lunch).toBe(120)
  })

  it('getMonthSegments pagina el mes entero (2.345 reservas en 3 viajes)', async () => {
    const sizes = [1000, 1000, 345]
    let page = 0
    const calls = fakeSupabase((call) => {
      if (call.table === 'salon_reservations') {
        const size = sizes[page] ?? 0
        page += 1
        return {
          data: Array.from({ length: size }, (_, i) => ({
            id: `r${page}-${i}`,
            reservation_date: '2026-09-10',
            meal_type: 'dinner',
            reservation_time_local: '21:00:00',
            scheduled_event_id: null,
            zone: 'planta_baja',
            status: 'pending',
            estimated_guests: 1,
            actual_guests: null,
            kind: 'normal',
            cake_count: 0,
          })),
          error: null,
        }
      }
      if (call.table.startsWith('salon_segment_')) return MISSING_TABLE
      if (call.table === 'tenants') return TENANT_SETTINGS
      return OK_EMPTY
    })
    const month = await getMonthSegments({ tenantId: TENANT, ym: '2026-09', events: [] })
    expect(Object.keys(month.days)).toHaveLength(30)
    expect(month.days['2026-09-10']?.segments.dinner.people).toBe(2345)
    expect(month.configured).toBe(false)
    expect(month.fallbackTotal).toBe(130)
    // Misma lectura de tenants: el cupo por planta llega sin un viaje más.
    expect(month.zoneCaps).toEqual({ planta_alta: 60, planta_baja: 70 })
    expect(calls.filter((c) => c.table === 'tenants')).toHaveLength(1)

    const resCalls = calls.filter((c) => c.table === 'salon_reservations')
    expect(resCalls).toHaveLength(3)
    expect(resCalls.map((c) => filterOf(c, 'range'))).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
    const first = resCalls[0]
    if (!first) throw new Error('sin query de reservas')
    expect(first.columns).toBe(SEGMENT_RES_SELECT)
    expect(filterOf(first, 'gte')).toEqual(['reservation_date', '2026-09-01'])
    expect(filterOf(first, 'lte')).toEqual(['reservation_date', '2026-09-30'])
    expect(filterOf(first, 'not')).toEqual(['status', 'in', '(cancelled,no_show)'])
    const orders = first.filters.filter((f) => f[0] === 'order').map((f) => f[1])
    expect(orders).toEqual(['reservation_date', 'id'])
  })
})

describe('searchReservations', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.mocked(createClient).mockReset()
    asRole('host')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errorSpy.mockRestore())

  it('con 4+ dígitos busca por nombre O teléfono, sanitizado, más recientes primero y hasta 20', async () => {
    const calls = fakeSupabase(() => OK_EMPTY)
    const res = await searchReservations('hub', 'López (3513)')
    expect(res).toEqual({ ok: true, data: [] })
    const call = calls[0]
    if (!call) throw new Error('sin query')
    expect(filterOf(call, 'or')).toEqual(['guest_name.ilike.%López 3513%,guest_phone.ilike.%3513%'])
    expect(filterOf(call, 'eq')).toEqual(['tenant_id', TENANT])
    expect(filterOf(call, 'limit')).toEqual([20])
    expect(call.filters.filter((f) => f[0] === 'order').map((f) => f.slice(1))).toEqual([
      ['reservation_date', { ascending: false }],
      ['reservation_time_local', { ascending: true }],
    ])
  })

  it('sin dígitos busca solo por nombre', async () => {
    const calls = fakeSupabase(() => OK_EMPTY)
    await searchReservations('hub', 'lop')
    const call = calls[0]
    if (!call) throw new Error('sin query')
    expect(filterOf(call, 'ilike')).toEqual(['guest_name', '%lop%'])
    expect(filterOf(call, 'or')).toBeUndefined()
  })

  it('si falla, el log no lleva lo buscado', async () => {
    fakeSupabase(() => ({ data: null, error: { code: '57014', message: 'timeout' } }))
    const res = await searchReservations('hub', 'Ana López')
    expect(res).toEqual({ ok: false, message: 'No pudimos buscar. Probá de nuevo.' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('López')
  })
})

describe('config: guardar la grilla y los cupos especiales', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.mocked(createClient).mockReset()
    vi.mocked(logAudit).mockClear()
    vi.mocked(revalidatePath).mockClear()
    asRole('owner')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errorSpy.mockRestore())

  it('saveSegmentConfig: las celdas con cupo se upsertean, las vacías se borran y los ajustes se upsertean', async () => {
    const calls = fakeSupabase(() => ({ data: null, error: null }))
    const res = await saveSegmentConfig('hub', {
      weekly: [
        { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
        { segment: 'lunch', iso_dow: 6, capacity: null, warn_at: null },
        { segment: 'lunch', iso_dow: 7, capacity: null, warn_at: null },
        { segment: 'dinner', iso_dow: 1, capacity: 120, warn_at: null },
      ],
      settings: [
        { segment: 'lunch', default_time: '13:00', warn_note: 'Conviene abrir la terraza' },
        { segment: 'tea_time', default_time: '15:30', warn_note: '' },
      ],
    })
    expect(res).toEqual({ ok: true, data: null, message: 'Cupos guardados.' })

    const upsertCaps = calls.find(
      (c) => c.table === 'salon_segment_capacities' && c.op === 'upsert',
    )
    expect(upsertCaps?.payload).toEqual([
      { tenant_id: TENANT, segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
      { tenant_id: TENANT, segment: 'dinner', iso_dow: 1, capacity: 120, warn_at: null },
    ])
    expect(upsertCaps?.options).toEqual({ onConflict: 'tenant_id,segment,iso_dow' })

    const deletes = calls.filter((c) => c.table === 'salon_segment_capacities' && c.op === 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]?.filters).toEqual([
      ['eq', 'tenant_id', TENANT],
      ['eq', 'segment', 'lunch'],
      ['in', 'iso_dow', [6, 7]],
    ])

    const upsertSettings = calls.find((c) => c.table === 'salon_segment_settings')
    expect(upsertSettings?.op).toBe('upsert')
    expect(upsertSettings?.payload).toEqual([
      {
        tenant_id: TENANT,
        segment: 'lunch',
        default_time: '13:00',
        warn_note: 'Conviene abrir la terraza',
      },
      { tenant_id: TENANT, segment: 'tea_time', default_time: '15:30', warn_note: null },
    ])
    expect(upsertSettings?.options).toEqual({ onConflict: 'tenant_id,segment' })

    expect(logAudit).toHaveBeenCalledTimes(1)
    const audit = vi.mocked(logAudit).mock.calls[0]?.[0]
    expect(audit?.action).toBe('salon_segment_config.updated')
    expect(JSON.stringify(audit?.payload)).not.toContain('terraza')

    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
    expect(paths).toEqual(
      expect.arrayContaining([
        '/hub/configuracion/salon',
        '/hub/eventos/programados',
        '/hub/operativo',
        '/hub/salon/reservas-operativo',
      ]),
    )
  })

  it('saveSegmentConfig: un aviso mayor al cupo no llega a la base', async () => {
    const res = await saveSegmentConfig('hub', {
      weekly: [{ segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 80 }],
      settings: [],
    })
    expect(res).toMatchObject({
      ok: false,
      message: 'El aviso tiene que ser menor o igual al cupo',
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('saveSegmentConfig: con la migración pendiente lo dice en vez de un error genérico', async () => {
    fakeSupabase(() => MISSING_TABLE)
    const res = await saveSegmentConfig('hub', {
      weekly: [{ segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: null }],
      settings: [],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/todavía no están activados/)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('saveSegmentConfig: si una escritura entra y otra falla, audita lo que quedó y avisa el error', async () => {
    fakeSupabase((call) =>
      call.table === 'salon_segment_settings'
        ? { data: null, error: { code: '08006', message: 'connection failure' } }
        : { data: null, error: null },
    )
    const res = await saveSegmentConfig('hub', {
      weekly: [
        { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
        { segment: 'lunch', iso_dow: 7, capacity: null, warn_at: null },
      ],
      settings: [{ segment: 'lunch', default_time: '13:00', warn_note: 'Abrí la terraza' }],
    })
    expect(res).toEqual({ ok: false, message: 'No se pudieron guardar los cupos. Probá de nuevo.' })

    // El cupo del bar cambió de verdad: queda en audit_log aunque el dueño no
    // vuelva a guardar, marcado como parcial.
    expect(logAudit).toHaveBeenCalledTimes(1)
    const audit = vi.mocked(logAudit).mock.calls[0]?.[0]
    expect(audit).toMatchObject({
      tenantId: TENANT,
      userId: USER,
      action: 'salon_segment_config.updated',
      entity: 'salon_segment_config',
    })
    expect(audit?.payload).toMatchObject({
      partial: true,
      applied: [
        { table: 'salon_segment_capacities', op: 'upsert' },
        { table: 'salon_segment_capacities', op: 'delete', segment: 'lunch', iso_dows: [7] },
      ],
      failed: [{ table: 'salon_segment_settings', op: 'upsert', code: '08006' }],
      weekly: [
        { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
        { segment: 'lunch', iso_dow: 7, capacity: null, warn_at: null },
      ],
    })
    // Ni la nota (texto libre) ni el mensaje del error de Postgres.
    const serialized = JSON.stringify(audit?.payload)
    expect(serialized).not.toContain('terraza')
    expect(serialized).not.toContain('connection failure')

    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toContain(
      '/hub/configuracion/salon',
    )
    expect(errorSpy).toHaveBeenCalledWith('[salon.segments.saveConfig]', {
      tenantId: TENANT,
      code: '08006',
    })
  })

  it('saveSegmentConfig: si fallan todas las escrituras no audita ni revalida', async () => {
    fakeSupabase(() => ({ data: null, error: { code: '08006', message: 'connection failure' } }))
    const res = await saveSegmentConfig('hub', {
      weekly: [
        { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: null },
        { segment: 'lunch', iso_dow: 7, capacity: null, warn_at: null },
      ],
      settings: [{ segment: 'lunch', default_time: '13:00', warn_note: null }],
    })
    expect(res.ok).toBe(false)
    expect(logAudit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('upsertSegmentOverride devuelve el especial anterior (para Deshacer) y firma updated_by', async () => {
    const previousRow = {
      segment: 'lunch',
      override_date: '2026-10-12',
      capacity: 90,
      warn_at: null,
      reason: 'Feriado',
    }
    const calls = fakeSupabase((call) =>
      call.op === 'select' ? { data: previousRow, error: null } : { data: null, error: null },
    )
    const res = await upsertSegmentOverride('hub', {
      override_date: '2026-10-12',
      segment: 'lunch',
      capacity: 120,
      reason: '',
    })
    expect(res).toEqual({
      ok: true,
      data: { previous: previousRow },
      message: 'Cupo especial guardado.',
    })
    const upsert = calls.find((c) => c.op === 'upsert')
    expect(upsert?.payload).toEqual({
      tenant_id: TENANT,
      segment: 'lunch',
      override_date: '2026-10-12',
      capacity: 120,
      warn_at: null,
      reason: null,
      updated_by: USER,
    })
    expect(upsert?.options).toEqual({ onConflict: 'tenant_id,override_date,segment' })
    const audit = vi.mocked(logAudit).mock.calls[0]?.[0]
    expect(audit?.action).toBe('salon_segment_override.saved')
    expect(audit?.payload).toMatchObject({ previous_capacity: 90, has_reason: false })
  })

  it('upsertSegmentOverride sin especial previo devuelve previous null', async () => {
    fakeSupabase(() => ({ data: null, error: null }))
    const res = await upsertSegmentOverride('hub', {
      override_date: '2026-09-25',
      segment: 'lunch',
      capacity: 120,
    })
    expect(res).toMatchObject({ ok: true, data: { previous: null } })
  })

  it('removeSegmentOverride: si no había especial no borra nada y responde ok', async () => {
    const calls = fakeSupabase(() => ({ data: null, error: null }))
    const res = await removeSegmentOverride('hub', {
      override_date: '2026-10-12',
      segment: 'lunch',
    })
    expect(res).toEqual({ ok: true, data: { previous: null } })
    expect(calls.some((c) => c.op === 'delete')).toBe(false)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('removeSegmentOverride: borra por (tenant, fecha, servicio) y devuelve lo que había', async () => {
    const previousRow = {
      segment: 'dinner',
      override_date: '2026-10-12',
      capacity: 0,
      warn_at: null,
      reason: 'Evento privado',
    }
    const calls = fakeSupabase((call) =>
      call.op === 'select' ? { data: previousRow, error: null } : { data: null, error: null },
    )
    const res = await removeSegmentOverride('hub', {
      override_date: '2026-10-12',
      segment: 'dinner',
    })
    expect(res).toMatchObject({ ok: true, data: { previous: previousRow } })
    const del = calls.find((c) => c.op === 'delete')
    expect(del?.filters).toEqual([
      ['eq', 'tenant_id', TENANT],
      ['eq', 'override_date', '2026-10-12'],
      ['eq', 'segment', 'dinner'],
    ])
    expect(vi.mocked(logAudit).mock.calls[0]?.[0].action).toBe('salon_segment_override.removed')
  })
})

describe('createSalonReservation: hub_event legacy', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset()
    vi.mocked(logAudit).mockClear()
    vi.mocked(revalidatePath).mockClear()
    asRole('host')
  })

  function input(meal: string) {
    return {
      guest_name: 'Cliente Prueba',
      kind: 'normal',
      meal_type: meal,
      reservation_date: '2026-09-25',
      reservation_time_local: '21:00',
      zone: 'planta_alta',
      estimated_guests: 4,
      origin: 'whatsapp',
      primary_manager_id: MANAGER,
    }
  }

  it("un alta con meal_type 'hub_event' se guarda como 'dinner' y revalida el calendario", async () => {
    const calls = fakeSupabase((call) =>
      call.op === 'insert' ? { data: { id: 'new-id' }, error: null } : OK_EMPTY,
    )
    const res = await createSalonReservation('hub', input('hub_event'))
    expect(res).toMatchObject({ ok: true, data: { id: 'new-id' } })
    const insert = calls.find((c) => c.table === 'salon_reservations' && c.op === 'insert')
    expect(insert?.payload).toMatchObject({ meal_type: 'dinner' })
    expect(vi.mocked(logAudit).mock.calls[0]?.[0].payload).toMatchObject({ meal_type: 'dinner' })
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toContain(
      '/hub/eventos/programados',
    )
  })

  it('los demás servicios se guardan tal cual', async () => {
    const calls = fakeSupabase((call) =>
      call.op === 'insert' ? { data: { id: 'new-id' }, error: null } : OK_EMPTY,
    )
    await createSalonReservation('hub', input('tea_time'))
    const insert = calls.find((c) => c.table === 'salon_reservations' && c.op === 'insert')
    expect(insert?.payload).toMatchObject({ meal_type: 'tea_time' })
  })
})
