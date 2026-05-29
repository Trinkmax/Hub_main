import { describe, expect, it } from 'vitest'
import {
  accumulateSession,
  type StaffAccumulator,
  splitShare,
  staffForSession,
  type WithStaffUser,
} from '@/lib/staff-performance/attribution'

describe('staffForSession', () => {
  it('vacío en ambos lados → []', () => {
    expect(staffForSession([], [])).toEqual([])
  })

  it('ignora entries con created_by_user_id null (acción del comensal)', () => {
    const events: WithStaffUser[] = [
      { created_by_user_id: null }, // guest joined
      { created_by_user_id: null }, // bill_requested
    ]
    expect(staffForSession(events, [])).toEqual([])
  })

  it('dedup entre events y tickets', () => {
    const events: WithStaffUser[] = [
      { created_by_user_id: 'u1' }, // opened
      { created_by_user_id: 'u1' }, // paid
      { created_by_user_id: 'u2' }, // alias_changed
    ]
    const tickets: WithStaffUser[] = [
      { created_by_user_id: 'u1' }, // staff ticket
      { created_by_user_id: 'u3' }, // staff ticket otro mozo
    ]
    const result = staffForSession(events, tickets)
    expect(result.sort()).toEqual(['u1', 'u2', 'u3'])
  })

  it('un solo mozo → un solo elemento', () => {
    expect(staffForSession([{ created_by_user_id: 'u1' }], [])).toEqual(['u1'])
  })
})

describe('splitShare', () => {
  it('split en partes iguales', () => {
    expect(splitShare(100, 4)).toBe(25)
  })

  it('división no exacta — devolvemos fraccional', () => {
    expect(splitShare(100, 3)).toBeCloseTo(33.333, 2)
  })

  it('staffCount = 0 → 0 (no crash, sin atribución)', () => {
    expect(splitShare(100, 0)).toBe(0)
  })

  it('total 0 → 0', () => {
    expect(splitShare(0, 5)).toBe(0)
  })
})

describe('accumulateSession', () => {
  it('no-op cuando no hay mozos', () => {
    const acc = new Map<string, StaffAccumulator>()
    accumulateSession(acc, [], 4, 100000, 5)
    expect(acc.size).toBe(0)
  })

  it('1 mozo recibe todo', () => {
    const acc = new Map<string, StaffAccumulator>()
    accumulateSession(acc, ['u1'], 4, 100000, 5)
    expect(acc.get('u1')).toEqual({
      user_id: 'u1',
      sessions_count: 1,
      party_size_share: 4,
      revenue_share_cents: 100000,
      items_share: 5,
    })
  })

  it('split equitativo entre 2 mozos', () => {
    const acc = new Map<string, StaffAccumulator>()
    accumulateSession(acc, ['u1', 'u2'], 4, 100000, 10)
    expect(acc.get('u1')?.party_size_share).toBe(2)
    expect(acc.get('u2')?.party_size_share).toBe(2)
    expect(acc.get('u1')?.revenue_share_cents).toBe(50000)
    expect(acc.get('u2')?.revenue_share_cents).toBe(50000)
    expect(acc.get('u1')?.items_share).toBe(5)
    expect(acc.get('u2')?.items_share).toBe(5)
  })

  it('mesas atendidas (sessions_count) suma como 1 por mesa por mozo', () => {
    const acc = new Map<string, StaffAccumulator>()
    accumulateSession(acc, ['u1', 'u2'], 4, 100000, 10) // mesa 1
    accumulateSession(acc, ['u1'], 2, 50000, 3) // mesa 2 solo u1
    expect(acc.get('u1')?.sessions_count).toBe(2)
    expect(acc.get('u2')?.sessions_count).toBe(1)
  })

  it('party_size null → 0 al pool', () => {
    const acc = new Map<string, StaffAccumulator>()
    accumulateSession(acc, ['u1'], null, 100000, 0)
    expect(acc.get('u1')?.party_size_share).toBe(0)
  })

  it('agrega encima de valores existentes en el accumulator', () => {
    const acc = new Map<string, StaffAccumulator>([
      [
        'u1',
        {
          user_id: 'u1',
          sessions_count: 5,
          party_size_share: 20,
          revenue_share_cents: 500000,
          items_share: 30,
        },
      ],
    ])
    accumulateSession(acc, ['u1'], 4, 100000, 5)
    expect(acc.get('u1')).toEqual({
      user_id: 'u1',
      sessions_count: 6,
      party_size_share: 24,
      revenue_share_cents: 600000,
      items_share: 35,
    })
  })
})
