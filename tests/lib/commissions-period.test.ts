import { describe, expect, it } from 'vitest'
import {
  type CommissionPeriod,
  MAX_COMMISSION_PERIOD_DAYS,
  payableUpperBound,
  periodLabel,
  resolveCommissionPeriod,
  shiftPeriod,
} from '@/lib/commissions/period'

// "Hoy" fijo para todos los casos que dependen del mes en curso.
const TODAY = '2026-09-18'

function resolve(input: { from?: string; to?: string; month?: string }): CommissionPeriod {
  return resolveCommissionPeriod(input, TODAY)
}

describe('resolveCommissionPeriod', () => {
  it('sin nada devuelve el mes en curso del calendario del bar', () => {
    expect(resolve({})).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      days: 30,
      label: '1 al 30 de septiembre de 2026',
    })
  })

  it('traduce el ?month=YYYY-MM legacy al mes completo (bookmarks viejos)', () => {
    expect(resolve({ month: '2026-08' })).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
      days: 31,
      label: '1 al 31 de agosto de 2026',
    })
  })

  it('resuelve febrero bisiesto desde el month legacy', () => {
    const period = resolve({ month: '2024-02' })
    expect(period.from).toBe('2024-02-01')
    expect(period.to).toBe('2024-02-29')
    expect(period.days).toBe(29)
  })

  it('un month inexistente (2026-13) cae al mes en curso', () => {
    expect(resolve({ month: '2026-13' }).from).toBe('2026-09-01')
  })

  it('from y to válidos mandan sobre el month legacy', () => {
    const period = resolve({ from: '2026-09-01', to: '2026-09-15', month: '2026-08' })
    expect(period).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
      days: 15,
      label: '1 al 15 de septiembre de 2026',
    })
  })

  it('el rango del dueño (15 al 15) cruza de mes y cuenta los dos bordes', () => {
    const period = resolve({ from: '2026-08-15', to: '2026-09-15' })
    expect(period.days).toBe(32)
    expect(period.label).toBe('15/08/2026 → 15/09/2026')
  })

  it('from > to se da vuelta en vez de devolver vacío', () => {
    expect(resolve({ from: '2026-09-15', to: '2026-08-15' })).toEqual({
      from: '2026-08-15',
      to: '2026-09-15',
      days: 32,
      label: '15/08/2026 → 15/09/2026',
    })
  })

  it('solo from completa hasta fin del mes de ese día', () => {
    const period = resolve({ from: '2026-09-20' })
    expect(period.from).toBe('2026-09-20')
    expect(period.to).toBe('2026-09-30')
  })

  it('solo to completa desde el día 1 del mes de ese día', () => {
    const period = resolve({ to: '2026-09-15' })
    expect(period.from).toBe('2026-09-01')
    expect(period.to).toBe('2026-09-15')
    expect(period.label).toBe('1 al 15 de septiembre de 2026')
  })

  it('un solo día es un período válido de 1 día', () => {
    expect(resolve({ from: '2026-09-15', to: '2026-09-15' })).toEqual({
      from: '2026-09-15',
      to: '2026-09-15',
      days: 1,
      label: 'martes 15/09/2026',
    })
  })

  it('fechas que matchean el formato pero no existen se ignoran', () => {
    // `2026-02-31` pasa cualquier regex yyyy-MM-dd y Postgres lo rechaza con 22008.
    expect(resolve({ from: '2026-02-31', to: '2026-02-31' }).from).toBe('2026-09-01')
    // Si una sola es basura, la otra sigue valiendo (se completa el mes).
    const half = resolve({ from: '2026-02-31', to: '2026-08-20' })
    expect(half).toMatchObject({ from: '2026-08-01', to: '2026-08-20' })
  })

  it('ignora strings que no son fechas', () => {
    expect(resolve({ from: 'ayer', to: '' }).from).toBe('2026-09-01')
  })

  it('recorta un rango absurdo al tope y lo dice en el label', () => {
    const period = resolve({ from: '2020-01-01', to: '2026-01-01' })
    expect(period.days).toBe(MAX_COMMISSION_PERIOD_DAYS)
    // 2020 es bisiesto: 400 días desde el 01/01/2020 terminan el 03/02/2021.
    expect(period.to).toBe('2021-02-03')
    expect(period.label).toContain('recortado a 400 días')
  })

  it('no recorta un rango justo en el tope', () => {
    const period = resolve({ from: '2026-01-01', to: '2027-02-04' })
    expect(period.days).toBe(MAX_COMMISSION_PERIOD_DAYS)
    expect(period.to).toBe('2027-02-04')
    expect(period.label).not.toContain('recortado')
  })
})

describe('payableUpperBound', () => {
  it('el período por defecto (mes completo) se topea en hoy', () => {
    // Es el caso que estrena el botón: entrar el 18/09 muestra hasta el 30/09,
    // pero del 19 al 30 todavía no ocurrió nada.
    expect(payableUpperBound(resolve({}).to, TODAY)).toBe(TODAY)
  })

  it('un período ya cerrado se paga entero', () => {
    expect(payableUpperBound('2026-08-31', TODAY)).toBe('2026-08-31')
  })

  it('hoy mismo entra: la reserva de esta noche ya se puede liquidar', () => {
    expect(payableUpperBound(TODAY, TODAY)).toBe(TODAY)
  })

  it('un ?to tipeado con el año mal no puede pagar el futuro', () => {
    // `2062-09-15` es un typo de 2026 y pasa cualquier validación de forma.
    expect(payableUpperBound('2062-09-15', TODAY)).toBe(TODAY)
  })

  it('un período enteramente futuro queda vacío (from > to), no paga nada', () => {
    const period = resolve({ from: '2026-10-01', to: '2026-10-31' })
    const to = payableUpperBound(period.to, TODAY)
    expect(to).toBe(TODAY)
    expect(period.from > to).toBe(true)
  })
})

describe('periodLabel', () => {
  it('mismo mes: sin ceros a la izquierda', () => {
    expect(periodLabel('2026-09-01', '2026-09-15')).toBe('1 al 15 de septiembre de 2026')
  })

  it('meses distintos: dd/MM/yyyy de punta a punta', () => {
    expect(periodLabel('2026-12-20', '2027-01-05')).toBe('20/12/2026 → 05/01/2027')
  })

  it('un solo día: día de la semana en castellano', () => {
    expect(periodLabel('2026-09-15', '2026-09-15')).toBe('martes 15/09/2026')
    expect(periodLabel('2026-09-16', '2026-09-16')).toBe('miércoles 16/09/2026')
    expect(periodLabel('2026-09-19', '2026-09-19')).toBe('sábado 19/09/2026')
  })

  it('mismo mes de años distintos no se confunde', () => {
    expect(periodLabel('2025-09-01', '2026-09-15')).toBe('01/09/2025 → 15/09/2026')
  })
})

describe('shiftPeriod', () => {
  it('hacia atrás: pega el rango anterior sin huecos ni solapes', () => {
    expect(shiftPeriod({ from: '2026-09-01', to: '2026-09-15' }, -1)).toEqual({
      from: '2026-08-17',
      to: '2026-08-31',
    })
  })

  it('hacia adelante: arranca al día siguiente y mantiene el largo', () => {
    expect(shiftPeriod({ from: '2026-09-01', to: '2026-09-15' }, 1)).toEqual({
      from: '2026-09-16',
      to: '2026-09-30',
    })
  })

  it('conserva el largo de un ciclo 15 a 15 aunque los meses midan distinto', () => {
    const previous = shiftPeriod({ from: '2026-08-15', to: '2026-09-15' }, -1)
    expect(previous).toEqual({ from: '2026-07-14', to: '2026-08-14' })
    expect(shiftPeriod(previous, 1)).toEqual({ from: '2026-08-15', to: '2026-09-15' })
  })

  it('un solo día se mueve de a un día', () => {
    expect(shiftPeriod({ from: '2026-09-15', to: '2026-09-15' }, -1)).toEqual({
      from: '2026-09-14',
      to: '2026-09-14',
    })
  })
})
