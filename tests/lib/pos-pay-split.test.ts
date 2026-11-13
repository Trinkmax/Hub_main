import { describe, expect, it } from 'vitest'
import { groupLines } from '@/lib/pos/pay/lines'
import { billMode, billName, billPeople, billTitle } from '@/lib/pos/pay/mode'
import { initialSplit, portionOf, reconcileSplit, type Split } from '@/lib/pos/pay/split'
import { discount, line, makeBill, payment, pesos } from './pos-pay-fixtures'

const table = () => [line('Clásicas', 3, 11_000), line('Mojito', 4, 6500), line('Lomo', 1, 26_000)]

describe('cuánto es este cobro', () => {
  it('todo junto: lo que falta, y con eso la mesa se cierra', () => {
    const bill = makeBill({ lines: table() })
    const portion = portionOf({ kind: 'all' }, bill, groupLines(bill.lines))
    expect(portion).toEqual({
      amountCents: pesos(85_000),
      label: null,
      title: 'toda la cuenta',
      itemIds: [],
      closes: true,
    })
  })

  it('después de un cobro, «todo» es todo lo que falta', () => {
    const bill = makeBill({ lines: table(), payments: [payment('cash', 20_000)] })
    const portion = portionOf({ kind: 'all' }, bill, groupLines(bill.lines))
    expect(portion.amountCents).toBe(pesos(65_000))
    expect(portion.title).toBe('todo lo que falta')
  })

  it('partes iguales: la parte que toca, con su rótulo', () => {
    const bill = makeBill({
      lines: table(),
      payments: [payment('cash', 21_250, { payer_label: 'Parte 1 de 4' })],
    })
    const portion = portionOf({ kind: 'equal', parts: 4 }, bill, groupLines(bill.lines))
    expect(portion).toMatchObject({
      amountCents: pesos(21_250),
      label: 'Parte 2 de 4',
      title: 'Parte 2 de 4',
      closes: false,
    })
  })

  it('la última parte cierra la mesa', () => {
    const bill = makeBill({
      lines: table(),
      payments: [payment('cash', 42_500, { payer_label: 'Parte 1 de 2' })],
    })
    expect(portionOf({ kind: 'equal', parts: 2 }, bill, groupLines(bill.lines))).toMatchObject({
      amountCents: pesos(42_500),
      closes: true,
    })
  })

  it('por producto: sin nada elegido no hay nada que cobrar', () => {
    const bill = makeBill({ lines: table() })
    const portion = portionOf({ kind: 'items', chosen: {} }, bill, groupLines(bill.lines))
    expect(portion).toMatchObject({ amountCents: 0, closes: false, title: 'por producto' })
  })

  it('por producto: la suma de lo elegido, con los renglones que viajan', () => {
    const lines = table()
    const bill = makeBill({ lines })
    const groups = groupLines(lines)
    const mojito = groups[1]
    const lomo = groups[2]
    if (!mojito || !lomo) throw new Error('faltan renglones')
    const portion = portionOf(
      { kind: 'items', chosen: { [mojito.key]: 2, [lomo.key]: 1 } },
      bill,
      groups,
    )
    expect(portion.amountCents).toBe(pesos(39_000))
    expect(portion.label).toBe('2 Mojito + 1 Lomo')
    expect(portion.title).toBe('3 productos')
    expect(portion.itemIds).toEqual([lines[1]?.id, lines[1]?.id, lines[2]?.id])
  })

  it('por producto con seña: cada producto carga su parte', () => {
    const lines = table()
    // Consumo 85.000 y seña 17.000: se cobra el 80 % de cada cosa.
    const bill = makeBill({ lines, depositPesos: 17_000 })
    const groups = groupLines(lines)
    const lomo = groups[2]
    if (!lomo) throw new Error('falta el lomo')
    expect(portionOf({ kind: 'items', chosen: { [lomo.key]: 1 } }, bill, groups).amountCents).toBe(
      pesos(20_800),
    )
  })

  it('un monto suelto nunca pasa lo que falta', () => {
    const bill = makeBill({ lines: table() })
    const groups = groupLines(bill.lines)
    expect(portionOf({ kind: 'amount', cents: pesos(30_000) }, bill, groups)).toMatchObject({
      amountCents: pesos(30_000),
      closes: false,
    })
    expect(portionOf({ kind: 'amount', cents: pesos(999_000) }, bill, groups)).toMatchObject({
      amountCents: pesos(85_000),
      closes: true,
    })
    expect(portionOf({ kind: 'amount', cents: null }, bill, groups).amountCents).toBe(0)
  })
})

describe('cuando llega una cuenta nueva', () => {
  it('si la mesa ya venía en partes iguales, arranca así', () => {
    const bill = makeBill({
      lines: table(),
      payments: [payment('cash', 21_250, { payer_label: 'Parte 1 de 4' })],
    })
    expect(initialSplit(bill)).toEqual({ kind: 'equal', parts: 4 })
    expect(initialSplit(makeBill({ lines: table() }))).toEqual({ kind: 'all' })
  })

  it('otro celular empezó a dividir: esta pantalla sigue el plan', () => {
    const bill = makeBill({
      lines: table(),
      payments: [payment('qr', 17_000, { payer_label: 'Parte 1 de 5' })],
    })
    expect(reconcileSplit({ kind: 'all' }, bill, groupLines(bill.lines))).toEqual({
      kind: 'equal',
      parts: 5,
    })
  })

  it('no cambia lo que no hace falta cambiar', () => {
    const bill = makeBill({ lines: table() })
    const groups = groupLines(bill.lines)
    const all: Split = { kind: 'all' }
    const equal: Split = { kind: 'equal', parts: 4 }
    const amount: Split = { kind: 'amount', cents: pesos(10_000) }
    expect(reconcileSplit(all, bill, groups)).toBe(all)
    expect(reconcileSplit(equal, bill, groups)).toBe(equal)
    expect(reconcileSplit(amount, bill, groups)).toBe(amount)
  })

  it('saca de lo elegido lo que otro ya cobró', () => {
    const lines = table()
    const before = groupLines(lines)
    const mojito = before[1]
    if (!mojito) throw new Error('falta el mojito')
    const paidLines = lines.map((l) => (l.name === 'Mojito' ? { ...l, paid_units: 3 } : l))
    const bill = makeBill({ lines: paidLines, payments: [payment('cash', 19_500)] })
    expect(
      reconcileSplit({ kind: 'items', chosen: { [mojito.key]: 4 } }, bill, groupLines(paidLines)),
    ).toEqual({ kind: 'items', chosen: { [mojito.key]: 1 } })
  })

  it('si ya no queda nada para elegir, lo que falta se cobra junto', () => {
    const lines = table().map((l) => ({ ...l, paid_units: l.quantity }))
    const bill = makeBill({ lines, payments: [payment('cash', 80_000)] })
    expect(reconcileSplit({ kind: 'items', chosen: {} }, bill, groupLines(lines))).toEqual({
      kind: 'all',
    })
  })

  it('un monto que ya no entra se vuelve a preguntar', () => {
    const bill = makeBill({ lines: table(), payments: [payment('cash', 70_000)] })
    expect(
      reconcileSplit({ kind: 'amount', cents: pesos(30_000) }, bill, groupLines(bill.lines)),
    ).toEqual({ kind: 'amount', cents: null })
  })

  it('si pagaron más partes de las que había, la división se agranda', () => {
    const bill = makeBill({
      lines: table(),
      payments: [
        payment('cash', 20_000, { payer_label: 'Parte 1 de 2' }),
        payment('cash', 20_000, { payer_label: 'Parte 2 de 3' }),
      ],
    })
    expect(reconcileSplit({ kind: 'equal', parts: 2 }, bill, groupLines(bill.lines))).toEqual({
      kind: 'equal',
      parts: 3,
    })
  })
})

describe('en qué momento está la cuenta', () => {
  it('una mesa con consumo y caja abierta se cobra', () => {
    expect(billMode(makeBill({ lines: table() }))).toEqual({ kind: 'charging' })
  })

  it('sin caja abierta no se cobra', () => {
    expect(billMode(makeBill({ lines: table(), overrides: { shifts: [] } }))).toEqual({
      kind: 'no_shift',
    })
  })

  it('una mesa de práctica se cobra aunque no haya caja', () => {
    const bill = makeBill({
      lines: table(),
      overrides: { shifts: [], session: { is_practice: true } },
    })
    expect(billMode(bill)).toEqual({ kind: 'charging' })
  })

  it('la seña cubre todo: se cierra sin cobrar, y la cierra quien puede', () => {
    const covered = makeBill({ lines: table(), depositPesos: 100_000 })
    expect(covered.bill.remaining_cents).toBe(0)
    expect(billMode(covered)).toEqual({ kind: 'settled', by: 'deposit', canClose: false })
    const asOwner = makeBill({
      lines: table(),
      depositPesos: 100_000,
      overrides: { can: { close_without_payment: true } },
    })
    expect(billMode(asOwner)).toEqual({ kind: 'settled', by: 'deposit', canClose: true })
  })

  it('una cortesía del 100 % también la cierra el encargado', () => {
    const invited = makeBill({ lines: table(), discounts: [discount('percent', 10_000)] })
    expect(billMode(invited)).toEqual({ kind: 'settled', by: 'discount', canClose: false })
  })

  it('si ya hubo un cobro, la cierra cualquiera del salón', () => {
    const bill = makeBill({
      lines: table(),
      payments: [payment('cash', 76_500)],
      discounts: [discount('percent', 1000)],
    })
    expect(bill.bill.remaining_cents).toBe(0)
    expect(billMode(bill)).toEqual({ kind: 'settled', by: 'payments', canClose: true })
  })

  it('cobrado de más: avisa cuánto y si esta persona puede anular', () => {
    const bill = makeBill({
      lines: table(),
      payments: [payment('cash', 85_000)],
      discounts: [discount('amount', pesos(5000))],
    })
    expect(billMode(bill)).toEqual({ kind: 'overpaid', cents: pesos(5000), canVoid: false })
  })

  it('una mesa sin consumo no se cobra', () => {
    expect(billMode(makeBill({ lines: [] }))).toEqual({ kind: 'empty' })
  })

  it('cobrada, juntada o abandonada', () => {
    const paid = makeBill({ lines: table(), overrides: { session: { status: 'paid' } } })
    expect(billMode(paid)).toEqual({ kind: 'closed' })
    const merged = makeBill({ lines: table(), overrides: { session: { status: 'merged' } } })
    expect(billMode(merged)).toEqual({ kind: 'gone' })
  })

  it('nombra la mesa y a quién está', () => {
    const bill = makeBill({ lines: table(), depositPesos: 10_000, partySize: null })
    expect(billTitle(bill.session)).toBe('Mesa 12')
    expect(billTitle({ table_label: null, kind: 'delivery' })).toBe('Delivery')
    expect(billTitle({ table_label: null, kind: 'quick' })).toBe('Venta rápida')
    expect(billName(bill)).toBe('Cumple de Sofi')
    expect(billPeople(bill)).toBe(8)
    expect(billPeople(makeBill({ lines: table(), partySize: null }))).toBeNull()
  })
})
