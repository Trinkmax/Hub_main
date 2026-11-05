import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/jobs/queue', () => ({ enqueueJob: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }))

const { pendingEventStarts } = await import('@/lib/flows/triggers')

const EVENTO_A = '11111111-1111-1111-1111-111111111111'
const EVENTO_B = '22222222-2222-2222-2222-222222222222'

describe('se acerca un evento: una vez por cliente y por evento', () => {
  it('cada reserva lleva su evento, para que la base no lo repita', () => {
    expect(
      pendingEventStarts([{ customer_id: 'ana', scheduled_event_id: EVENTO_A }], new Set()),
    ).toEqual([{ customer_id: 'ana', context: { scheduled_event_id: EVENTO_A } }])
  })

  it('dos reservas de la misma persona en el mismo evento son un solo aviso', () => {
    const rows = [
      { customer_id: 'ana', scheduled_event_id: EVENTO_A },
      { customer_id: 'ana', scheduled_event_id: EVENTO_A },
    ]
    expect(pendingEventStarts(rows, new Set())).toHaveLength(1)
  })

  it('en dos eventos, dos avisos', () => {
    const rows = [
      { customer_id: 'ana', scheduled_event_id: EVENTO_A },
      { customer_id: 'ana', scheduled_event_id: EVENTO_B },
    ]
    expect(pendingEventStarts(rows, new Set())).toHaveLength(2)
  })

  it('a quien ya se le avisó de ese evento no se le vuelve a encolar', () => {
    const rows = [
      { customer_id: 'ana', scheduled_event_id: EVENTO_A },
      { customer_id: 'beto', scheduled_event_id: EVENTO_A },
    ]
    expect(pendingEventStarts(rows, new Set([`ana:${EVENTO_A}`]))).toEqual([
      { customer_id: 'beto', context: { scheduled_event_id: EVENTO_A } },
    ])
  })

  it('una reserva sin ficha no entra', () => {
    expect(
      pendingEventStarts([{ customer_id: null, scheduled_event_id: EVENTO_A }], new Set()),
    ).toEqual([])
  })
})
