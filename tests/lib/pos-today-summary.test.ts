// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isDay,
  serviceDayWindow,
  shiftDay,
  shiftWords,
  summarizeToday,
  TOP_PRODUCTS,
  todaySentence,
} from '@/lib/pos/today/summary'
import type {
  TodayBill,
  TodayData,
  TodayLine,
  TodayOpenTable,
  TodayPayment,
  TodayShift,
} from '@/lib/pos/today/types'

/**
 * Los números que el dueño ve en «Hoy en vivo» tienen que ser los mismos que ve la caja: la venta es
 * lo que bajó de las cuentas, el recargo y la propina van aparte y lo anulado no cuenta.
 */

const A = 'alta'
const C = 'cerro'
const money = (cents: number) => `$ ${Math.round(cents / 100).toLocaleString('es-AR')}`

let seq = 0
const pay = (over: Partial<TodayPayment>): TodayPayment => ({
  id: `p${++seq}`,
  branchId: C,
  sessionId: `s${seq}`,
  shiftId: 'turno',
  method: 'cash',
  amountCents: 0,
  surchargeCents: 0,
  tipCents: 0,
  invoice: false,
  status: 'ok',
  createdAt: '2026-11-13T23:10:00.000Z',
  edits: 0,
  ...over,
})
const bill = (over: Partial<TodayBill>): TodayBill => ({
  sessionId: `b${++seq}`,
  branchId: C,
  partySize: 2,
  subtotalCents: 0,
  discountCents: 0,
  depositCents: 0,
  dueCents: 0,
  closedAt: '2026-11-13T23:30:00.000Z',
  hasCustomer: false,
  pointsAwarded: 0,
  ...over,
})
const open = (over: Partial<TodayOpenTable>): TodayOpenTable => ({
  sessionId: `o${++seq}`,
  branchId: C,
  partySize: 2,
  totalCents: 0,
  openedAt: '2026-11-13T22:00:00.000Z',
  billRequestedAt: null,
  ...over,
})
const line = (over: Partial<TodayLine>): TodayLine => ({
  branchId: C,
  menuItemId: 'm1',
  name: 'Mojito',
  quantity: 1,
  totalCents: 800000,
  cancelled: false,
  ...over,
})
const shift = (over: Partial<TodayShift>): TodayShift => ({
  id: `t${++seq}`,
  branchId: C,
  label: 'Noche',
  status: 'open',
  openedAt: '2026-11-13T21:00:00.000Z',
  openedByName: 'Ana',
  closedAt: null,
  closedByName: null,
  differenceCents: null,
  ...over,
})
const data = (over: Partial<TodayData>): TodayData => ({
  day: '2026-11-13',
  isToday: true,
  loadedAt: 0,
  branches: [
    { id: A, name: 'Alta Córdoba', shortName: null, slug: 'alta-cordoba', color: '#2f5d50' },
    { id: C, name: 'Cerro', shortName: null, slug: 'cerro', color: '#a8452d' },
  ],
  payments: [],
  bills: [],
  shifts: [],
  openTables: [],
  lines: [],
  ...over,
})

describe('la venta del día', () => {
  it('es lo que bajó de las cuentas; el recargo y la propina van aparte', () => {
    const summary = summarizeToday(
      data({
        payments: [
          pay({ method: 'cash', amountCents: 4700000 }),
          pay({ method: 'credit', amountCents: 1120000, surchargeCents: 112000, invoice: true }),
          pay({ method: 'qr', amountCents: 10100000, tipCents: 1000000, invoice: true }),
        ],
      }),
      null,
    )
    expect(summary.salesCents).toBe(15920000)
    expect(summary.surchargeCents).toBe(112000)
    expect(summary.tipCents).toBe(1000000)
    expect(summary.collectedCents).toBe(17032000)
    expect(summary.payments).toBe(3)
    expect(summary.invoicedCents).toBe(11332000)
    expect(summary.notInvoicedCents).toBe(4700000)
  })

  it('un cobro anulado no cuenta, pero queda a la vista', () => {
    const summary = summarizeToday(
      data({
        payments: [pay({ amountCents: 5000000 }), pay({ amountCents: 3000000, status: 'voided' })],
      }),
      null,
    )
    expect(summary.salesCents).toBe(5000000)
    expect(summary.payments).toBe(1)
    expect(summary.voidedPayments).toBe(1)
  })

  it('por medio: en el orden de siempre, con el recargo adentro y la parte de cada uno', () => {
    const summary = summarizeToday(
      data({
        payments: [
          pay({ method: 'credit', amountCents: 1000000, surchargeCents: 100000 }),
          pay({ method: 'cash', amountCents: 3000000 }),
          pay({ method: 'cash', amountCents: 900000 }),
        ],
      }),
      null,
    )
    expect(summary.byMethod.map((entry) => entry.method)).toEqual(['cash', 'credit'])
    expect(summary.byMethod[0]).toMatchObject({ count: 2, cents: 3900000, share: 78 })
    expect(summary.byMethod[1]).toMatchObject({ count: 1, cents: 1100000, share: 22 })
  })

  it('cuántos cobros se corrigieron', () => {
    const summary = summarizeToday(
      data({ payments: [pay({ amountCents: 100, edits: 2 }), pay({ amountCents: 100 })] }),
      null,
    )
    expect(summary.correctedPayments).toBe(1)
  })
})

describe('mesas, personas y per cápita', () => {
  it('salen de las cuentas cerradas: consumo menos descuentos, por persona y al peso', () => {
    const summary = summarizeToday(
      data({
        bills: [
          bill({ partySize: 2, subtotalCents: 4700000 }),
          bill({
            partySize: 4,
            subtotalCents: 10100000,
            discountCents: 1010000,
            hasCustomer: true,
            pointsAwarded: 91,
          }),
          bill({ partySize: 8, subtotalCents: 16500000, depositCents: 8000000 }),
        ],
      }),
      null,
    )
    expect(summary.tables).toBe(3)
    expect(summary.people).toBe(14)
    expect(summary.consumptionCents).toBe(30290000)
    expect(summary.perPersonCents).toBe(2163600)
    expect(summary.discountCents).toBe(1010000)
    expect(summary.discountedTables).toBe(1)
    expect(summary.depositCents).toBe(8000000)
    expect(summary.memberTables).toBe(1)
    expect(summary.pointsAwarded).toBe(91)
  })

  it('sin personas anotadas no inventa un per cápita', () => {
    const summary = summarizeToday(
      data({ bills: [bill({ partySize: null, subtotalCents: 500000 })] }),
      null,
    )
    expect(summary.people).toBe(0)
    expect(summary.perPersonCents).toBeNull()
  })
})

describe('lo que sigue abierto y lo que hay para mirar', () => {
  it('las mesas abiertas suman lo pendiente y cuántas pidieron la cuenta', () => {
    const summary = summarizeToday(
      data({
        openTables: [
          open({ totalCents: 9000000 }),
          open({ totalCents: 2240000, billRequestedAt: '2026-11-13T23:40:00.000Z' }),
        ],
      }),
      null,
    )
    expect(summary.openTables).toBe(2)
    expect(summary.openCents).toBe(11240000)
    expect(summary.waitingBill).toBe(1)
  })

  it('las bajas se cuentan aparte y no entran en lo que más salió', () => {
    const summary = summarizeToday(
      data({
        lines: [
          line({ menuItemId: 'm1', name: 'Mojito', quantity: 2, totalCents: 1600000 }),
          line({ menuItemId: 'm1', name: 'Mojito', quantity: 1, totalCents: 800000 }),
          line({ menuItemId: 'm2', name: 'Lomo', quantity: 1, totalCents: 2400000 }),
          line({
            menuItemId: 'm2',
            name: 'Lomo',
            quantity: 1,
            totalCents: 2400000,
            cancelled: true,
          }),
        ],
      }),
      null,
    )
    expect(summary.voidedLines).toBe(1)
    expect(summary.voidedCents).toBe(2400000)
    expect(summary.topProducts).toEqual([
      { menuItemId: 'm1', name: 'Mojito', quantity: 3, cents: 2400000 },
      { menuItemId: 'm2', name: 'Lomo', quantity: 1, cents: 2400000 },
    ])
  })

  it(`lo que más salió entra en ${TOP_PRODUCTS} renglones`, () => {
    const lines = Array.from({ length: 12 }, (_, index) =>
      line({ menuItemId: `m${index}`, name: `Producto ${index}`, quantity: index + 1 }),
    )
    const summary = summarizeToday(data({ lines }), null)
    expect(summary.topProducts).toHaveLength(TOP_PRODUCTS)
    expect(summary.topProducts[0]?.quantity).toBe(12)
  })

  it('los turnos: abiertos, cerrados y los que cerraron con diferencia', () => {
    const summary = summarizeToday(
      data({
        shifts: [
          shift({ status: 'closed', differenceCents: 0 }),
          shift({ status: 'closed', differenceCents: -100000 }),
          shift({ status: 'open' }),
        ],
      }),
      null,
    )
    expect(summary.openShifts).toBe(1)
    expect(summary.closedShifts).toBe(2)
    expect(summary.shiftsOff).toBe(1)
    expect(summary.shiftDifferenceCents).toBe(-100000)
  })
})

describe('por sucursal', () => {
  const both = data({
    payments: [
      pay({ branchId: A, amountCents: 1000000 }),
      pay({ branchId: C, amountCents: 3000000 }),
    ],
    bills: [
      bill({ branchId: A, subtotalCents: 1000000 }),
      bill({ branchId: C, subtotalCents: 3000000 }),
    ],
    openTables: [open({ branchId: A, totalCents: 500000 })],
    lines: [line({ branchId: C })],
    shifts: [shift({ branchId: A })],
  })

  it('todas juntas', () => {
    const summary = summarizeToday(both, null)
    expect(summary.salesCents).toBe(4000000)
    expect(summary.tables).toBe(2)
  })

  it('una sola: solo lo suyo', () => {
    const cerro = summarizeToday(both, C)
    expect(cerro.salesCents).toBe(3000000)
    expect(cerro.tables).toBe(1)
    expect(cerro.openTables).toBe(0)
    expect(cerro.openShifts).toBe(0)
    expect(cerro.topProducts).toHaveLength(1)
    const alta = summarizeToday(both, A)
    expect(alta.salesCents).toBe(1000000)
    expect(alta.openCents).toBe(500000)
    expect(alta.topProducts).toHaveLength(0)
  })
})

describe('en palabras', () => {
  it('con ventas y mesas abiertas', () => {
    const summary = summarizeToday(
      data({
        payments: [pay({ amountCents: 4700000 }), pay({ amountCents: 1000000 })],
        bills: [bill({ subtotalCents: 5700000 })],
        openTables: [open({ totalCents: 9000000 }), open({ totalCents: 1000000 })],
      }),
      null,
    )
    expect(todaySentence(summary, { isToday: true, money })).toBe(
      'Es lo que se vendió en 2 cobros de 1 mesa. Hay $ 100.000 más en 2 mesas abiertas.',
    )
    expect(todaySentence(summary, { isToday: false, money })).toBe(
      'Fue lo que se vendió en 2 cobros de 1 mesa.',
    )
  })

  it('sin cobros todavía', () => {
    const quiet = summarizeToday(data({}), null)
    expect(todaySentence(quiet, { isToday: true, money })).toBe(
      'Todavía no se cobró nada y no hay mesas abiertas.',
    )
    expect(todaySentence(quiet, { isToday: false, money })).toBe('Ese día no hubo cobros.')
    const busy = summarizeToday(data({ openTables: [open({ totalCents: 2240000 })] }), null)
    expect(todaySentence(busy, { isToday: true, money })).toBe(
      'Todavía no se cobró nada. Hay $ 22.400 en 1 mesa abierta.',
    )
  })

  it('la caja, en pocas palabras', () => {
    expect(shiftWords({ openShifts: 1, closedShifts: 0, shiftsOff: 0 }, true)).toBe('Caja abierta')
    expect(shiftWords({ openShifts: 2, closedShifts: 1, shiftsOff: 0 }, true)).toBe(
      '2 cajas abiertas',
    )
    expect(shiftWords({ openShifts: 0, closedShifts: 0, shiftsOff: 0 }, true)).toBe(
      'Caja sin abrir',
    )
    expect(shiftWords({ openShifts: 0, closedShifts: 0, shiftsOff: 0 }, false)).toBe(
      'Sin turnos de caja',
    )
    expect(shiftWords({ openShifts: 0, closedShifts: 2, shiftsOff: 0 }, true)).toBe(
      'Caja cerrada: cuadró',
    )
    expect(shiftWords({ openShifts: 0, closedShifts: 2, shiftsOff: 1 }, true)).toBe(
      'Caja cerrada con diferencia',
    )
  })
})

describe('los días', () => {
  it('el anterior y el siguiente, cruzando el mes y el año', () => {
    expect(shiftDay('2026-11-13', -1)).toBe('2026-11-12')
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('el día de servicio va de 5 a 5, hora del bar', () => {
    expect(serviceDayWindow('2026-11-13')).toEqual({
      from: '2026-11-13T08:00:00.000Z',
      to: '2026-11-14T08:00:00.000Z',
    })
    // Lo cobrado a las 2 de la mañana del sábado es de la noche del viernes.
    const { from, to } = serviceDayWindow('2026-11-13')
    const at = '2026-11-14T05:10:00.000Z'
    expect(at >= from && at < to).toBe(true)
  })

  it('solo vale un día que existe', () => {
    expect(isDay('2026-11-13')).toBe(true)
    expect(isDay('2026-02-31')).toBe(false)
    expect(isDay('13/11/2026')).toBe(false)
    expect(isDay(undefined)).toBe(false)
  })
})
