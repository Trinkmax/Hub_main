import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { orderHasRoom } from '@/lib/ticketing/queries'

/**
 * ¿La función de un pago rechazado todavía tiene lugar? Decide si la entrada sigue
 * mostrando cómo transferir después de la hora del lugar guardado. Ante la duda, no.
 */

const TZ = 'America/Argentina/Cordoba'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'

type Event = {
  event_date: string
  starts_at_local: string
  capacity: number
  private_group: boolean
}

const CORALINE: Event = {
  event_date: '2026-12-02',
  starts_at_local: '21:00:00',
  capacity: 50,
  private_group: false,
}

function fakeService(
  event: Event | null,
  seats: { taken: number; held: number } | null,
  fail: { event?: boolean; seats?: boolean } = {},
) {
  const rpc = vi.fn(async () =>
    fail.seats
      ? { data: null, error: { code: 'XX000' } }
      : {
          data: seats
            ? [{ scheduled_event_id: EVENT_ID, capacity: event?.capacity ?? 0, ...seats }]
            : [],
          error: null,
        },
  )
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () =>
      fail.event ? { data: null, error: { code: 'XX000' } } : { data: event, error: null },
  }
  return { service: { from: () => chain, rpc }, rpc }
}

beforeEach(() => {
  vi.useFakeTimers()
  // 19:42 del 06/11 en Córdoba.
  vi.setSystemTime(new Date('2026-11-06T22:42:00.000Z'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('orderHasRoom', () => {
  it('función a la venta con lugar para todo el grupo: sí', async () => {
    const { service, rpc } = fakeService(CORALINE, { taken: 9, held: 0 })
    expect(await orderHasRoom(service, 't1', EVENT_ID, 2, TZ)).toBe(true)
    expect(rpc).toHaveBeenCalledWith('ticketing_event_seats', {
      p_tenant_id: 't1',
      p_event_ids: [EVENT_ID],
    })
  })

  it('justo los lugares del grupo: sí; uno menos: no', async () => {
    expect(
      await orderHasRoom(
        fakeService(CORALINE, { taken: 46, held: 2 }).service,
        't1',
        EVENT_ID,
        2,
        TZ,
      ),
    ).toBe(true)
    expect(
      await orderHasRoom(
        fakeService(CORALINE, { taken: 47, held: 2 }).service,
        't1',
        EVENT_ID,
        2,
        TZ,
      ),
    ).toBe(false)
  })

  it('los lugares que guardan otros también cuentan', async () => {
    const { service } = fakeService(CORALINE, { taken: 40, held: 9 })
    expect(await orderHasRoom(service, 't1', EVENT_ID, 2, TZ)).toBe(false)
  })

  it('una función privada no se vende online', async () => {
    const { service, rpc } = fakeService(
      { ...CORALINE, private_group: true },
      { taken: 0, held: 0 },
    )
    expect(await orderHasRoom(service, 't1', EVENT_ID, 2, TZ)).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una función que ya empezó, no', async () => {
    const today = { ...CORALINE, event_date: '2026-11-06', starts_at_local: '19:30:00' }
    const { service } = fakeService(today, { taken: 0, held: 0 })
    expect(await orderHasRoom(service, 't1', EVENT_ID, 2, TZ)).toBe(false)
  })

  it('sin función, o la función ya no existe: no', async () => {
    expect(await orderHasRoom(fakeService(CORALINE, null).service, 't1', null, 2, TZ)).toBe(false)
    expect(await orderHasRoom(fakeService(null, null).service, 't1', EVENT_ID, 2, TZ)).toBe(false)
  })

  it('si la base no contesta: no (mostrar la cuenta de más termina en sobrecupo)', async () => {
    const seatsDown = fakeService(CORALINE, null, { seats: true }).service
    expect(await orderHasRoom(seatsDown, 't1', EVENT_ID, 2, TZ)).toBe(false)
    const eventDown = fakeService(CORALINE, null, { event: true }).service
    expect(await orderHasRoom(eventDown, 't1', EVENT_ID, 2, TZ)).toBe(false)
  })
})
