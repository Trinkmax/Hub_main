import { describe, expect, it } from 'vitest'
import {
  groupSalesByDay,
  previousPageEnd,
  purchaseDay,
  SALES_PAGE_DAYS,
  salesDaySummary,
  salesDayTitle,
  salesPage,
  salesPageLabel,
  salesPageRange,
  shiftDay,
} from '@/lib/ticketing/sales-days'
import type { OrderStatus } from '@/lib/ticketing/types'

/**
 * Ventas online, día por día (audio de Nacho del 06/11/2026: «que se pueda seguir viendo todos los
 * días, por día, todos los que te pagaron»). Antes eran las últimas 60 compras y en HUB lo anterior
 * al 04/11 no se veía.
 */

const NOW = new Date('2026-11-06T17:00:00.000Z') // viernes 6/11, 14:00 en Córdoba

type Sale = {
  id: string
  created_at: string
  status: OrderStatus
  paid_cents: number | null
  total_cents: number
}

function sale(id: string, createdAt: string, status: OrderStatus, paid: number | null = null) {
  return {
    id,
    created_at: createdAt,
    status,
    paid_cents: paid,
    total_cents: 4_000_000,
  } satisfies Sale
}

describe('salesPage — qué semana se ve', () => {
  it('sin fecha: la semana que termina hoy, en el reloj del bar', () => {
    expect(SALES_PAGE_DAYS).toBe(7)
    expect(salesPage(undefined, NOW)).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
      today: '2026-11-06',
      latest: true,
    })
    // 23:30 del jueves en Córdoba ya es viernes en UTC: manda el bar.
    expect(salesPage(undefined, new Date('2026-11-06T02:30:00.000Z')).today).toBe('2026-11-05')
  })

  it('con hasta: la semana que termina ese día', () => {
    expect(salesPage('2026-11-01', NOW)).toEqual({
      from: '2026-10-26',
      to: '2026-11-01',
      today: '2026-11-06',
      latest: false,
    })
    expect(salesPage(['2026-10-30', '2026-10-01'], NOW).to).toBe('2026-10-30')
  })

  it('una fecha futura, de hoy, que no existe o ilegible: vuelve a esta semana', () => {
    for (const raw of ['2026-12-01', '2026-11-06', '2026-02-30', 'ayer', '', '2026-1-5']) {
      expect(salesPage(raw, NOW), raw).toMatchObject({ to: '2026-11-06', latest: true })
    }
  })

  it('el rango de la consulta: de la medianoche del primer día a la del día después del último', () => {
    expect(salesPageRange({ from: '2026-10-31', to: '2026-11-06' })).toEqual({
      fromIso: '2026-10-31T03:00:00.000Z',
      toIso: '2026-11-07T03:00:00.000Z',
    })
  })

  it('el día de la compra es el del bar', () => {
    expect(purchaseDay('2026-11-06T02:59:00.000Z')).toBe('2026-11-05') // 23:59
    expect(purchaseDay('2026-11-06T03:00:00.000Z')).toBe('2026-11-06') // 00:00
  })

  it('«Ver días anteriores» salta a la semana de la venta anterior, aunque haya días vacíos', () => {
    expect(previousPageEnd('2026-10-28T23:10:00.000Z')).toBe('2026-10-28')
    expect(previousPageEnd(null)).toBeNull()
    expect(previousPageEnd('cualquier cosa')).toBeNull()
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('«Del 26/10 al 01/11» para una semana que no es esta', () => {
    expect(salesPageLabel({ from: '2026-10-26', to: '2026-11-01' })).toBe('Del 26/10 al 01/11')
  })
})

describe('groupSalesByDay — una tanda por día de compra', () => {
  it('del día más nuevo al más viejo, cada compra en su día y en el orden que llegó', () => {
    const groups = groupSalesByDay([
      sale('a', '2026-11-06T16:00:00.000Z', 'approved', 4_000_000),
      sale('b', '2026-11-06T13:00:00.000Z', 'rejected'),
      // 23:30 del 4/11 en Córdoba, aunque en UTC ya sea el 5.
      sale('c', '2026-11-05T02:30:00.000Z', 'approved', 2_000_000),
      sale('d', '2026-11-04T20:00:00.000Z', 'refunded', 4_000_000),
      sale('e', '2026-11-04T19:00:00.000Z', 'pending'),
    ])
    expect(groups.map((g) => [g.day, g.orders.map((o) => o.id)])).toEqual([
      ['2026-11-06', ['a', 'b']],
      ['2026-11-04', ['c', 'd', 'e']],
    ])
  })

  it('cuenta lo cobrado (sin las devueltas) y lo que quedó sin pagar', () => {
    const [today, before] = groupSalesByDay([
      sale('a', '2026-11-06T16:00:00.000Z', 'approved', 4_000_000),
      sale('b', '2026-11-06T15:00:00.000Z', 'approved', null), // sin el dato: lo de la compra
      sale('c', '2026-11-06T14:00:00.000Z', 'rejected'),
      sale('d', '2026-11-06T13:00:00.000Z', 'pending'),
      sale('e', '2026-11-05T13:00:00.000Z', 'refunded', 4_000_000),
    ])
    expect(today).toMatchObject({ paid: 2, paidCents: 8_000_000, unpaid: 2 })
    expect(before).toMatchObject({ paid: 0, paidCents: 0, unpaid: 0 })
  })

  it('aunque lleguen desordenadas, los días salen del más nuevo al más viejo', () => {
    const groups = groupSalesByDay([
      sale('viejo', '2026-10-30T15:00:00.000Z', 'approved', 1),
      sale('nuevo', '2026-11-02T15:00:00.000Z', 'approved', 1),
    ])
    expect(groups.map((g) => g.day)).toEqual(['2026-11-02', '2026-10-30'])
    expect(groupSalesByDay([])).toEqual([])
  })
})

describe('el título y el resumen de cada día', () => {
  it('Hoy y Ayer con la fecha al lado; los demás, la fecha sola', () => {
    expect(salesDayTitle('2026-11-06', '2026-11-06')).toEqual({
      title: 'Hoy',
      date: 'viernes 6 de noviembre',
    })
    expect(salesDayTitle('2026-11-05', '2026-11-06')).toEqual({
      title: 'Ayer',
      date: 'jueves 5 de noviembre',
    })
    expect(salesDayTitle('2026-11-04', '2026-11-06')).toEqual({
      title: 'Miércoles 4 de noviembre',
      date: null,
    })
    // Ayer cruzando el año.
    expect(salesDayTitle('2025-12-31', '2026-01-01')).toEqual({
      title: 'Ayer',
      date: 'miércoles 31 de diciembre de 2025',
    })
    expect(salesDayTitle('2025-12-30', '2026-01-01').title).toBe('Martes 30 de diciembre de 2025')
  })

  it('lo cobrado y lo que quedó sin pagar', () => {
    expect(salesDaySummary({ paid: 0, paidCents: 0, unpaid: 0 })).toEqual({
      paid: 'Ninguna pagada',
      unpaid: null,
    })
    const one = salesDaySummary({ paid: 1, paidCents: 2_000_000, unpaid: 1 })
    expect(one.paid.replace(/\s/g, ' ')).toBe('1 pagada · $ 20.000')
    expect(one.unpaid).toBe('1 sin pagar')
    const many = salesDaySummary({ paid: 3, paidCents: 12_000_000, unpaid: 2 })
    expect(many.paid.replace(/\s/g, ' ')).toBe('3 pagadas · $ 120.000')
    expect(many.unpaid).toBe('2 sin pagar')
  })
})
