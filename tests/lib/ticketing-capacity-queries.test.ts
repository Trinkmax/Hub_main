import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Las funciones de la pestaña Funciones y la que se va a tocar al guardar un cupo. Lo que se
 * fija: solo las de películas del bar, sin las privadas ni las que ya empezaron, con lo
 * reservado y lo que se está pagando por separado, y todo filtrado por el bar.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  films: [] as Row[],
  events: [] as Row[],
  seats: [] as Row[],
  tenantFilters: [] as Array<[string, unknown]>,
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const filters: Array<[string, string, unknown]> = []
      const rows = (): Row[] => {
        let out =
          table === 'event_experiences' ? db.films : table === 'scheduled_events' ? db.events : []
        for (const [op, column, value] of filters) {
          if (op === 'eq') out = out.filter((r) => r[column] === value)
          if (op === 'in') out = out.filter((r) => (value as unknown[]).includes(r[column]))
          if (op === 'gte') out = out.filter((r) => String(r[column]) >= String(value))
        }
        // Como la consulta real: por fecha y hora.
        return [...out].sort((a, b) =>
          `${a.event_date} ${a.starts_at_local}`.localeCompare(
            `${b.event_date} ${b.starts_at_local}`,
          ),
        )
      }
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          if (column === 'tenant_id') db.tenantFilters.push([table, value])
          filters.push(['eq', column, value])
          return chain
        },
        in: (column: string, value: unknown) => {
          filters.push(['in', column, value])
          return chain
        },
        gte: (column: string, value: unknown) => {
          filters.push(['gte', column, value])
          return chain
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: imita el query builder de supabase-js
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      }
      return chain
    },
    rpc: async (_name: string, args: { p_tenant_id: string; p_event_ids: string[] }) => ({
      data: db.seats.filter((s) => args.p_event_ids.includes(String(s.scheduled_event_id))),
      error: null,
    }),
  }),
}))

import { getCapacityFunction, listCapacityFunctions } from '@/lib/ticketing/queries'

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`

const event = (n: number, template: string, date: string, extra: Row = {}): Row => ({
  id: id(n),
  tenant_id: T,
  template_id: template,
  event_date: date,
  starts_at_local: '21:00:00',
  capacity: 54,
  private_group: false,
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers()
  // Miércoles 11/11/2026, 18:30 en Córdoba.
  vi.setSystemTime(new Date('2026-11-11T21:30:00.000Z'))
  db.films = [
    {
      tenant_id: T,
      template_id: 'tpl-cora',
      slug: 'coraline',
      title: 'Coraline',
      accent_hex: '#2f4f7f',
      published: true,
    },
    {
      tenant_id: T,
      template_id: 'tpl-chi',
      slug: 'chihiro',
      title: 'El viaje de Chihiro',
      accent_hex: null,
      published: false,
    },
    {
      tenant_id: OTHER,
      template_id: 'tpl-otro',
      slug: 'otro',
      title: 'De otro bar',
      accent_hex: null,
      published: true,
    },
  ]
  db.events = [
    event(1, 'tpl-cora', '2026-11-15'),
    event(2, 'tpl-chi', '2026-11-16', { capacity: 100 }),
    // Hoy a las 18:00: ya empezó.
    event(3, 'tpl-cora', '2026-11-11', { starts_at_local: '18:00:00' }),
    // Hoy a las 21:00: todavía no.
    event(4, 'tpl-cora', '2026-11-11'),
    // Un grupo privado de la película.
    event(5, 'tpl-cora', '2026-11-20', { private_group: true }),
    // Un evento del calendario que no es una película (Sushi libre).
    event(6, 'tpl-sushi', '2026-11-18', { capacity: 120 }),
    // Ya pasó.
    event(7, 'tpl-cora', '2026-11-01'),
    // De otro bar.
    event(8, 'tpl-otro', '2026-11-15', { tenant_id: OTHER }),
  ]
  db.seats = [
    { scheduled_event_id: id(1), capacity: 54, taken: 46, held: 2 },
    { scheduled_event_id: id(2), capacity: 100, taken: 12, held: 0 },
    { scheduled_event_id: id(4), capacity: 54, taken: 56, held: 0 },
  ]
  db.tenantFilters = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listCapacityFunctions', () => {
  it('las funciones de las películas del bar que vienen, con lo reservado y lo que se paga', async () => {
    const list = await listCapacityFunctions(T)
    expect(list.map((fn) => fn.eventId)).toEqual([id(4), id(1), id(2)])
    expect(list[1]).toEqual({
      eventId: id(1),
      date: '2026-11-15',
      time: '21:00',
      capacity: 54,
      reserved: 46,
      paying: 2,
      left: 6,
      slug: 'coraline',
      title: 'Coraline',
      accent: '#2f4f7f',
      published: true,
    })
    // Con más reservas que cupo no quedan lugares negativos.
    expect(list[0]?.left).toBe(0)
    // La película apagada aparece (el cupo se puede dejar listo), con el color de siempre.
    expect(list[2]).toMatchObject({ published: false, accent: '#c0573e', capacity: 100 })
    expect(db.tenantFilters.every(([, tenant]) => tenant === T)).toBe(true)
  })
})

describe('getCapacityFunction', () => {
  it('una función que viene: sus números', async () => {
    expect(await getCapacityFunction(T, id(1))).toEqual({ capacity: 54, reserved: 46, paying: 2 })
  })

  it('la que ya empezó, la privada, la que no es película o la de otro bar: no', async () => {
    expect(await getCapacityFunction(T, id(3))).toBeNull()
    expect(await getCapacityFunction(T, id(5))).toBeNull()
    expect(await getCapacityFunction(T, id(6))).toBeNull()
    expect(await getCapacityFunction(T, id(7))).toBeNull()
    expect(await getCapacityFunction(T, id(8))).toBeNull()
  })
})
