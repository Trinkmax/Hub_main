import { describe, expect, it } from 'vitest'
import { groupManagersForSelect, pickDefaultManagerId } from '@/lib/salon/managers'
import type { ReservationManagerRow } from '@/lib/salon/types'

function mgr(over: Partial<ReservationManagerRow> & { id: string }): ReservationManagerRow {
  return {
    tenant_id: 't1',
    user_id: null,
    display_name: over.id,
    phone: null,
    email: null,
    commission_eligible: false,
    active: true,
    notes: null,
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
    ...over,
  }
}

const LUZ = mgr({ id: 'luz', display_name: 'Luz', commission_eligible: true })
const TOMI = mgr({ id: 'tomi', display_name: 'Tomas Burgos', user_id: 'u-tomi' })
const EZE = mgr({ id: 'eze', display_name: 'Eze Fuica', user_id: 'u-eze' })
const TURNO = mgr({ id: 'turno', display_name: 'Turno Mañana' })

describe('groupManagersForSelect', () => {
  it('separa equipo (con cuenta) de gestores sin cuenta', () => {
    const groups = groupManagersForSelect([EZE, LUZ, TOMI, TURNO])
    expect(groups.map((g) => g.key)).toEqual(['team', 'external'])
    expect(groups[0]?.label).toBe('Equipo')
    expect(groups[0]?.items.map((m) => m.id)).toEqual(['eze', 'tomi'])
    expect(groups[1]?.label).toBe('Otros gestores')
    expect(groups[1]?.items.map((m) => m.id)).toEqual(['luz', 'turno'])
  })

  it('pone al usuario actual primero dentro del equipo', () => {
    const groups = groupManagersForSelect([EZE, TOMI], 'tomi')
    expect(groups[0]?.items.map((m) => m.id)).toEqual(['tomi', 'eze'])
  })

  it('no rompe si el usuario actual no está en la lista', () => {
    const groups = groupManagersForSelect([EZE, TOMI], 'fantasma')
    expect(groups[0]?.items.map((m) => m.id)).toEqual(['eze', 'tomi'])
  })

  it('omite el encabezado cuando hay un solo grupo', () => {
    expect(groupManagersForSelect([LUZ, TURNO])).toEqual([
      { key: 'external', label: null, items: [LUZ, TURNO] },
    ])
    expect(groupManagersForSelect([EZE, TOMI])[0]?.label).toBeNull()
  })

  it('devuelve lista vacía sin gestores', () => {
    expect(groupManagersForSelect([])).toEqual([])
  })

  it('no muta el array recibido', () => {
    const input = [EZE, TOMI]
    groupManagersForSelect(input, 'tomi')
    expect(input.map((m) => m.id)).toEqual(['eze', 'tomi'])
  })
})

describe('pickDefaultManagerId', () => {
  const managers = [LUZ, TOMI, EZE]

  it('en edit manda el gestor guardado en la reserva', () => {
    expect(
      pickDefaultManagerId({
        managers,
        mode: 'edit',
        currentManagerId: 'luz',
        lastUsedManagerId: 'tomi',
        selfManagerId: 'eze',
      }),
    ).toBe('luz')
  })

  it('en create el último usado en el dispositivo le gana a "sos vos"', () => {
    // El que carga no siempre es el que tomó la reserva: los socios cargan
    // las que entran por el WhatsApp del local y las cobra Luz.
    expect(
      pickDefaultManagerId({
        managers,
        mode: 'create',
        lastUsedManagerId: 'luz',
        selfManagerId: 'tomi',
      }),
    ).toBe('luz')
  })

  it('cae en el gestor propio cuando el dispositivo no eligió nada', () => {
    expect(pickDefaultManagerId({ managers, mode: 'create', selfManagerId: 'tomi' })).toBe('tomi')
  })

  it('ignora un último usado que ya no está activo', () => {
    expect(
      pickDefaultManagerId({
        managers,
        mode: 'create',
        lastUsedManagerId: 'gestor-dado-de-baja',
        selfManagerId: 'eze',
      }),
    ).toBe('eze')
  })

  it('ignora un gestor propio que ya no está activo', () => {
    expect(
      pickDefaultManagerId({ managers, mode: 'create', selfManagerId: 'gestor-dado-de-baja' }),
    ).toBe('luz')
  })

  it('sin señales usa el primero de la lista', () => {
    expect(pickDefaultManagerId({ managers, mode: 'create' })).toBe('luz')
  })

  it('devuelve string vacío si no hay gestores', () => {
    expect(pickDefaultManagerId({ managers: [], mode: 'create', selfManagerId: 'tomi' })).toBe('')
  })
})
