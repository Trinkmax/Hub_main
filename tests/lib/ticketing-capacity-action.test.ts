import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guardar el cupo de una función (Ventas online › Funciones). Lo que se fija:
 * - lo guardan el dueño y la anfitriona, con su sesión (la RLS del calendario), y nadie más;
 * - nunca por debajo de lo reservado, y solo funciones de la cartelera que no empezaron;
 * - queda en audit_log de cuánto a cuánto, sin tocar nada si el número es el mismo.
 */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const EVENT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const state = vi.hoisted(() => ({
  role: 'host' as string,
  fn: { capacity: 54, reserved: 48, paying: 2 } as {
    capacity: number
    reserved: number
    paying: number
  } | null,
  readFails: false,
  updateResult: { data: { id: 'x' }, error: null } as { data: unknown; error: unknown },
  updates: [] as Array<{ table: string; values: unknown; filters: Array<[string, unknown]> }>,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => {
    throw new Error('service_role al guardar el cupo')
  }),
}))
vi.mock('@/lib/ticketing/queries', () => ({
  getCapacityFunction: vi.fn(async () => {
    if (state.readFails) throw new Error('No pudimos leer la función.')
    return state.fn
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      update: (values: unknown) => {
        const entry = { table, values, filters: [] as Array<[string, unknown]> }
        state.updates.push(entry)
        const chain = {
          eq: (column: string, value: unknown) => {
            entry.filters.push([column, value])
            return chain
          },
          select: () => chain,
          maybeSingle: async () => state.updateResult,
        }
        return chain
      },
    }),
  }),
}))
vi.mock('@/lib/tenant', async (actual) => ({
  ...(await actual<typeof import('@/lib/tenant')>()),
  requireTenantAccess: vi.fn(async () => ({
    tenant: { id: TENANT, name: 'Bar', slug: 'bar', feature_flags: {} },
    role: state.role,
    isPlatformAdmin: false,
    user: { id: USER },
  })),
}))

import { logAudit } from '@/lib/audit'
import { setFunctionCapacity } from '@/lib/ticketing/actions'
import { getCapacityFunction } from '@/lib/ticketing/queries'

beforeEach(() => {
  state.role = 'host'
  state.fn = { capacity: 54, reserved: 48, paying: 2 }
  state.readFails = false
  state.updateResult = { data: { id: 'x' }, error: null }
  state.updates = []
  vi.mocked(logAudit).mockClear()
  vi.mocked(getCapacityFunction).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('setFunctionCapacity', () => {
  it('la anfitriona sube el cupo: se guarda con su sesión y queda en la auditoría', async () => {
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 100 })
    expect(result).toEqual({ ok: true, message: 'Ahora entran 100. Quedan 50 lugares a la venta.' })
    expect(state.updates).toEqual([
      {
        table: 'scheduled_events',
        values: { capacity: 100 },
        filters: [
          ['tenant_id', TENANT],
          ['id', EVENT_ID],
        ],
      },
    ])
    expect(logAudit).toHaveBeenCalledWith({
      tenantId: TENANT,
      userId: USER,
      action: 'scheduled_event.capacity_changed',
      entity: 'scheduled_event',
      entityId: EVENT_ID,
      payload: { from: 54, to: 100, reserved: 48, source: 'ventas_online' },
    })
  })

  it('el dueño también; justo en lo reservado corta la venta', async () => {
    state.role = 'owner'
    state.fn = { capacity: 54, reserved: 48, paying: 0 }
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 48 })
    expect(result).toEqual({ ok: true, message: 'Ahora entran 48. Quedan 0 lugares a la venta.' })
    expect(state.updates).toHaveLength(1)
  })

  it.each([
    'cashier',
    'waiter',
    'kitchen',
    'editor',
    'accountant',
  ])('%s no puede, y no se toca nada', async (role) => {
    state.role = role
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 100 })
    expect(result.ok).toBe(false)
    expect(state.updates).toEqual([])
    expect(getCapacityFunction).not.toHaveBeenCalled()
  })

  it('por debajo de lo reservado, no', async () => {
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 40 })
    expect(result).toEqual({
      ok: false,
      message: 'Ya hay 48 personas reservadas: el cupo no puede ser menos.',
      field: 'capacity',
    })
    expect(state.updates).toEqual([])
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('una función que ya empezó o que no es de la cartelera, no', async () => {
    state.fn = null
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 60 })
    expect(result).toEqual({
      ok: false,
      message: 'Esa función ya empezó o no está en la cartelera.',
    })
    expect(state.updates).toEqual([])
  })

  it('el mismo número: no escribe ni audita', async () => {
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 54 })
    expect(result).toEqual({ ok: true, message: 'Ya entraban 54.' })
    expect(state.updates).toEqual([])
    expect(logAudit).not.toHaveBeenCalled()
  })

  it.each([
    [{ event_id: EVENT_ID, capacity: 0 }],
    [{ event_id: EVENT_ID, capacity: 54.5 }],
    [{ event_id: EVENT_ID, capacity: 1000 }],
    [{ event_id: 'no-es-un-id', capacity: 54 }],
  ])('un dato que no sirve no llega a la base: %o', async (input) => {
    const result = await setFunctionCapacity('bar', input)
    expect(result.ok).toBe(false)
    expect(getCapacityFunction).not.toHaveBeenCalled()
    expect(state.updates).toEqual([])
  })

  it('si la base falla, lo dice y no audita', async () => {
    state.updateResult = { data: null, error: { code: '42501' } }
    const result = await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 60 })
    expect(result).toEqual({ ok: false, message: 'No pudimos guardar el cupo. Probá de nuevo.' })
    expect(logAudit).not.toHaveBeenCalled()

    state.readFails = true
    expect(await setFunctionCapacity('bar', { event_id: EVENT_ID, capacity: 60 })).toEqual({
      ok: false,
      message: 'No pudimos leer la función. Probá de nuevo.',
    })
  })
})
