import { describe, expect, it } from 'vitest'
import { PAY_METHODS } from '@/lib/pos/cash/types'
import {
  DEPOSIT_METHOD_LABELS,
  DEPOSIT_METHODS,
  depositMethodForSave,
  depositMethodLabel,
  parseDepositMethod,
  withDepositMethod,
} from '@/lib/salon/deposit-method'
import { createSalonReservationSchema, depositMethodField } from '@/lib/salon/schemas'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { fullUpdatePayload } from '@/lib/salon/update-payload'

describe('los medios de una seña', () => {
  it('son los mismos del punto de venta, con sus mismos nombres', () => {
    expect([...DEPOSIT_METHODS].sort()).toEqual([...PAY_METHODS].sort())
    expect(DEPOSIT_METHOD_LABELS.transfer).toBe('Transferencia')
    expect(DEPOSIT_METHOD_LABELS.cash).toBe('Efectivo')
    // Una seña casi siempre llega por transferencia: es la primera que se ofrece.
    expect(DEPOSIT_METHODS[0]).toBe('transfer')
  })

  it('lee lo que se entiende y descarta el resto', () => {
    expect(parseDepositMethod('qr')).toBe('qr')
    expect(parseDepositMethod('none')).toBeNull()
    expect(parseDepositMethod('')).toBeNull()
    expect(parseDepositMethod(null)).toBeNull()
    expect(parseDepositMethod(undefined)).toBeNull()
    expect(parseDepositMethod(3)).toBeNull()
  })

  it('se dice con palabras, o no se dice', () => {
    expect(depositMethodLabel('debit')).toBe('Débito')
    expect(depositMethodLabel(null)).toBeNull()
    expect(withDepositMethod('$ 5.000', 'transfer')).toBe('$ 5.000 · Transferencia')
    expect(withDepositMethod('$ 5.000', null)).toBe('$ 5.000')
  })

  it('sin seña no hay medio que guardar', () => {
    expect(depositMethodForSave(500000, 'cash')).toBe('cash')
    expect(depositMethodForSave(0, 'cash')).toBeNull()
    expect(depositMethodForSave(500000, '')).toBeNull()
    expect(depositMethodForSave(500000, undefined)).toBeNull()
  })
})

describe('el campo en el borde', () => {
  it('tres estados: elegido, vaciado a propósito y ausente', () => {
    expect(depositMethodField.parse('transfer')).toBe('transfer')
    expect(depositMethodField.parse('')).toBeNull()
    expect(depositMethodField.parse(null)).toBeNull()
    // Ausente se queda ausente: la action no toca la columna.
    expect(depositMethodField.parse(undefined)).toBeUndefined()
    expect(depositMethodField.safeParse('bitcoin').success).toBe(false)
  })

  it('el alta lo acepta y no lo exige', () => {
    const base = {
      guest_name: 'Adriana Carranza',
      meal_type: 'dinner',
      reservation_date: '2026-11-28',
      reservation_time_local: '21:00',
      zone: 'planta_alta',
      estimated_guests: 4,
      primary_manager_id: '0b8f3c1e-5d2a-4e7b-9c1f-2a3b4c5d6e7f',
    }
    const without = createSalonReservationSchema.safeParse(base)
    expect(without.success).toBe(true)
    // Sin decir nada queda ausente: no se guarda ni se pisa.
    expect(without.success ? without.data.deposit_method : 'no pasó').toBeUndefined()
    const withMethod = createSalonReservationSchema.safeParse({
      ...base,
      deposit_cents: 500000,
      deposit_method: 'transfer',
    })
    expect(withMethod.success && withMethod.data.deposit_method).toBe('transfer')
  })
})

describe('el payload completo de una edición', () => {
  const row = { id: 'r1', reservation_time_local: '21:00:00', deposit_cents: 500000 }

  it('copia el medio tal cual: editar otra cosa no lo borra', () => {
    const payload = fullUpdatePayload({ ...row, deposit_method: 'qr' } as ReservationWithJoins, {
      estimated_guests: 6,
    })
    expect(payload.deposit_method).toBe('qr')
    expect(payload.estimated_guests).toBe(6)
  })

  it('una fila que todavía no trae la columna lo manda ausente', () => {
    const payload = fullUpdatePayload(row as ReservationWithJoins)
    expect(payload.deposit_method).toBeUndefined()
  })
})
