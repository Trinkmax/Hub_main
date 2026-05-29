import { describe, expect, it } from 'vitest'
import {
  isWaitingOnKitchen,
  kitchenOwnsPrep,
  type TicketStatus,
  waiterAdvanceTarget,
} from '@/lib/tickets/ticket-flow'

describe('waiterAdvanceTarget', () => {
  describe('flag OFF (mozo hace todo el flujo)', () => {
    it('accepted → preparing', () => {
      expect(waiterAdvanceTarget('accepted', false)).toBe('preparing')
    })
    it('preparing → ready', () => {
      expect(waiterAdvanceTarget('preparing', false)).toBe('ready')
    })
    it('ready → served', () => {
      expect(waiterAdvanceTarget('ready', false)).toBe('served')
    })
  })

  describe('flag ON (cocina dueña de preparación)', () => {
    it('accepted → null (es de cocina)', () => {
      expect(waiterAdvanceTarget('accepted', true)).toBeNull()
    })
    it('preparing → null (es de cocina)', () => {
      expect(waiterAdvanceTarget('preparing', true)).toBeNull()
    })
    it('ready → served (el mozo entrega siempre)', () => {
      expect(waiterAdvanceTarget('ready', true)).toBe('served')
    })
  })

  it('estados sin avance del mozo → null en ambos modos', () => {
    for (const flag of [false, true]) {
      for (const s of ['pending', 'served', 'cancelled'] as TicketStatus[]) {
        expect(waiterAdvanceTarget(s, flag)).toBeNull()
      }
    }
  })
})

describe('kitchenOwnsPrep', () => {
  it('refleja el flag', () => {
    expect(kitchenOwnsPrep(true)).toBe(true)
    expect(kitchenOwnsPrep(false)).toBe(false)
  })
})

describe('isWaitingOnKitchen', () => {
  it('con flag ON, accepted y preparing esperan a cocina', () => {
    expect(isWaitingOnKitchen('accepted', true)).toBe(true)
    expect(isWaitingOnKitchen('preparing', true)).toBe(true)
  })
  it('con flag ON, ready/served/pending no esperan a cocina', () => {
    expect(isWaitingOnKitchen('ready', true)).toBe(false)
    expect(isWaitingOnKitchen('served', true)).toBe(false)
    expect(isWaitingOnKitchen('pending', true)).toBe(false)
  })
  it('con flag OFF nunca espera a cocina (el mozo maneja todo)', () => {
    for (const s of ['accepted', 'preparing', 'ready'] as TicketStatus[]) {
      expect(isWaitingOnKitchen(s, false)).toBe(false)
    }
  })
})
