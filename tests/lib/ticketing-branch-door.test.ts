import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La puerta con sucursales (docs/features/sucursales.md): la puerta es la sucursal de este equipo.
 * Lo que se fija:
 * - una entrada de otra sucursal no pasa: lo dice claro («Esta entrada es para … en Cerro»);
 * - lo que invalida la entrada y el «Ya entraron» siguen ganando;
 * - la acción compara la sucursal de la reserva ANTES de pedirle a la base que deje pasar (la base
 *   no la mira), con la sucursal con la que se dibujó la puerta o, sin ella, la del equipo.
 */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const ALTA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const CERRO = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'

const branch = (id: string, name: string) => ({
  id,
  name,
  shortName: null,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  color: '#2f5d50',
  address: null,
  position: 0,
  isDefault: id === ALTA,
  openedOn: null,
  seatCapacity: null,
})

const state = vi.hoisted(() => ({
  /** La sucursal de la reserva de la entrada. */
  reservationBranch: null as string | null,
  /** Las sucursales que ve quien recibe y la de este equipo (`getBranchScope(…, 'device')`). */
  scope: { branches: [] as Array<{ id: string; name: string }>, current: null as unknown },
  /** El nombre de una sucursal que quien recibe no tiene (lo lee de `branches`). */
  otherName: 'Cerro' as string | null,
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  admitError: null as { message: string; code?: string } | null,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/branches/scope', () => ({
  getBranchScope: vi.fn(async () => state.scope),
}))
vi.mock('@/lib/tenant', async (actual) => ({
  ...(await actual<typeof import('@/lib/tenant')>()),
  requireTenantAccess: vi.fn(async () => ({
    tenant: { id: TENANT, name: 'Bar', slug: 'bar', feature_flags: {} },
    role: 'waiter',
    isPlatformAdmin: false,
    user: { id: 'u1' },
  })),
}))

function doorTicketRow(over: Record<string, unknown> = {}) {
  return {
    order_id: ORDER_ID,
    short_code: '7C9E6679',
    status: 'approved',
    title: 'Shrek 2',
    poster_url: null,
    accent_hex: null,
    guest_name: 'Ana Pérez',
    party_size: 2,
    payment_option: 'deposit',
    unit_price_cents: 2_000_000,
    full_price_cents: 4_500_000,
    paid_cents: 4_000_000,
    balance_cash_only: false,
    event_date: '2026-12-01',
    event_time: '21:00',
    service_day: '2026-12-01',
    reservation: {
      id: 'res-1',
      status: 'pending',
      date: '2026-12-01',
      time: '21:00',
      estimated_guests: 2,
      actual_guests: null,
      arrived_at_label: null,
      arrived_by_name: null,
    },
    room: { inside: 0, expected: 2 },
    ...over,
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args })
      if (name === 'ticket_door_admit' && state.admitError) {
        return { data: null, error: state.admitError }
      }
      return { data: doorTicketRow(), error: null }
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'salon_reservations') {
            return { data: { branch_id: state.reservationBranch }, error: null }
          }
          if (table === 'branches') {
            return { data: state.otherName ? { name: state.otherName } : null, error: null }
          }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }),
}))

import { getBranchScope } from '@/lib/branches/scope'
import {
  type DoorTicket,
  doorFunctionSchema,
  doorVerdict,
  isOtherBranch,
  otherBranchNote,
} from '@/lib/ticketing/door'
import { admitDoorTicket, lookupDoorTicket } from '@/lib/ticketing/door-actions'

const ticket = (over: Partial<DoorTicket> = {}): DoorTicket =>
  ({ ...doorTicketRow(), ...over }) as DoorTicket

const elsewhere = { branch: 'Cerro', here: 'Alta Córdoba' }

beforeEach(() => {
  state.reservationBranch = ALTA
  state.scope = {
    branches: [branch(ALTA, 'Alta Córdoba')],
    current: branch(ALTA, 'Alta Córdoba'),
  }
  state.otherName = 'Cerro'
  state.rpcs = []
  state.admitError = null
  vi.mocked(getBranchScope).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('el veredicto con sucursales', () => {
  it('de otra sucursal: no pasa y dice dónde (hoy u otro día)', () => {
    expect(doorVerdict(ticket(), elsewhere)).toEqual({
      kind: 'other_branch',
      branch: 'Cerro',
      here: 'Alta Córdoba',
      date: '2026-12-01',
      time: '21:00',
      today: true,
    })
    const future = ticket({
      reservation: { ...doorTicketRow().reservation, date: '2026-12-15' },
    } as Partial<DoorTicket>)
    expect(doorVerdict(future, elsewhere)).toMatchObject({ kind: 'other_branch', today: false })
  })

  it('sin otra sucursal, todo como siempre', () => {
    expect(doorVerdict(ticket(), null).kind).toBe('admit')
    expect(doorVerdict(ticket()).kind).toBe('admit')
  })

  it('lo que invalida la entrada y «Ya entraron» siguen ganando', () => {
    expect(doorVerdict(ticket({ status: 'refunded' }), elsewhere).kind).toBe('refunded')
    expect(doorVerdict(ticket({ status: 'pending' }), elsewhere).kind).toBe('not_paid')
    expect(doorVerdict(ticket({ reservation: null }), elsewhere).kind).toBe('no_reservation')
    const used = ticket({
      reservation: { ...doorTicketRow().reservation, status: 'arrived', actual_guests: 2 },
    } as Partial<DoorTicket>)
    expect(doorVerdict(used, elsewhere).kind).toBe('used')
  })

  it('el aviso, como se lo dice quien recibe', () => {
    const today = doorVerdict(ticket(), elsewhere)
    if (today.kind !== 'other_branch') throw new Error('esperaba otra sucursal')
    expect(otherBranchNote('Shrek 2', today)).toBe(
      'Esta entrada es para Shrek 2 de hoy a las 21:00 hs en Cerro. Este equipo está en Alta Córdoba.',
    )
    expect(
      otherBranchNote('Coraline', {
        ...today,
        date: '2026-12-15',
        today: false,
        branch: null,
        here: null,
      }),
    ).toBe('Esta entrada es para Coraline del martes 15 de diciembre, 21:00 hs, en otra sucursal.')
  })

  it('solo es otra sucursal si se saben las dos', () => {
    expect(isOtherBranch(CERRO, ALTA)).toBe(true)
    expect(isOtherBranch(ALTA, ALTA)).toBe(false)
    expect(isOtherBranch(null, ALTA)).toBe(false)
    expect(isOtherBranch(CERRO, null)).toBe(false)
  })

  it('el cartel de la puerta acepta la sucursal de cada función (y vive sin ella)', () => {
    const row = { event_id: 'e1', title: 'Shrek 2', time: '21:00', inside: 3, expected: 40 }
    expect(doorFunctionSchema.parse({ ...row, branch_id: CERRO }).branch_id).toBe(CERRO)
    expect(doorFunctionSchema.parse(row).branch_id).toBeUndefined()
  })
})

describe('la acción de la puerta', () => {
  it('escanear una entrada de esta sucursal: sin aviso', async () => {
    const result = await lookupDoorTicket('bar', '7C9E6679', ALTA)
    expect(result).toMatchObject({ ok: true, elsewhere: null })
  })

  it('escanear una del Cerro en Alta Córdoba: avisa dónde es', async () => {
    state.reservationBranch = CERRO
    const result = await lookupDoorTicket('bar', '7C9E6679', ALTA)
    expect(result).toMatchObject({
      ok: true,
      elsewhere: { branch: 'Cerro', here: 'Alta Córdoba' },
    })
    expect(getBranchScope).toHaveBeenCalledWith('bar', 'device')
  })

  it('dejar pasar una del Cerro: no le pide nada a la base', async () => {
    state.reservationBranch = CERRO
    const result = await admitDoorTicket('bar', ORDER_ID, 2, 0, ALTA)
    expect(result).toMatchObject({ ok: true, admitted: false, elsewhere: { branch: 'Cerro' } })
    expect(state.rpcs.map((r) => r.name)).toEqual(['ticket_door_lookup'])
  })

  it('dejar pasar una de esta sucursal: la base la deja pasar', async () => {
    const result = await admitDoorTicket('bar', ORDER_ID, 2, 0, ALTA)
    expect(result).toMatchObject({ ok: true, admitted: true, elsewhere: null })
    expect(state.rpcs.map((r) => r.name)).toEqual(['ticket_door_lookup', 'ticket_door_admit'])
  })

  it('sin la sucursal de la pantalla (el escáner del salón), vale la del equipo', async () => {
    state.reservationBranch = CERRO
    state.scope = {
      branches: [branch(ALTA, 'Alta Córdoba'), branch(CERRO, 'Cerro')],
      current: branch(CERRO, 'Cerro'),
    }
    expect(await lookupDoorTicket('bar', '7C9E6679')).toMatchObject({ ok: true, elsewhere: null })
    // Una sucursal que la persona no tiene no se cuela: vale la del equipo.
    state.scope = {
      branches: [branch(ALTA, 'Alta Córdoba')],
      current: branch(ALTA, 'Alta Córdoba'),
    }
    expect(await lookupDoorTicket('bar', '7C9E6679', CERRO)).toMatchObject({
      ok: true,
      elsewhere: { branch: 'Cerro', here: 'Alta Córdoba' },
    })
  })

  it('si no se sabe dónde está la puerta, se valida como siempre', async () => {
    state.reservationBranch = CERRO
    state.scope = { branches: [], current: null }
    const result = await admitDoorTicket('bar', ORDER_ID, 2, 0)
    expect(result).toMatchObject({ ok: true, admitted: true })
  })

  it('si la base no deja, vuelve a mirar la entrada (con la sucursal)', async () => {
    state.admitError = { message: 'ticket_stale' }
    const result = await admitDoorTicket('bar', ORDER_ID, 2, 0, ALTA)
    expect(result).toMatchObject({ ok: true, elsewhere: null })
    expect(result).not.toHaveProperty('admitted', true)
    expect(state.rpcs.map((r) => r.name)).toEqual([
      'ticket_door_lookup',
      'ticket_door_admit',
      'ticket_door_lookup',
    ])
  })
})
