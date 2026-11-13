import { describe, expect, it } from 'vitest'
import { formatCentsShort } from '@/lib/money'
import {
  countTotal,
  emptyCount,
  expectedCash,
  isTransposition,
  liveTotals,
  methodChangeLabel,
  probableMistakes,
  type ShiftMovement,
  type ShiftPayment,
} from '@/lib/pos/cash/shift'

/** La base guarda centavos; el bar habla en pesos. */
const pesos = (n: number): number => n * 100
const BILLS = [20000, 10000, 2000, 1000, 500, 200, 100]

let seq = 0
function payment(over: Partial<ShiftPayment> = {}): ShiftPayment {
  seq += 1
  return {
    id: `p${seq}`,
    method: 'cash',
    amount_cents: pesos(10_000),
    surcharge_cents: 0,
    tip_cents: 0,
    change_cents: 0,
    invoice: false,
    status: 'ok',
    table_label: null,
    ...over,
  }
}

function movement(over: Partial<ShiftMovement> = {}): ShiftMovement {
  seq += 1
  return {
    id: `m${seq}`,
    kind: 'out',
    amount_cents: pesos(8_000),
    reason: 'Hielo',
    voided_at: null,
    ...over,
  }
}

/** La noche del ensayo contra la base: tiene que dar los mismos números que `pos_shift_summary`. */
const NIGHT_PAYMENTS: ShiftPayment[] = [
  payment({ method: 'cash', amount_cents: pesos(20_000) }),
  payment({ method: 'cash', amount_cents: pesos(25_000) }),
  payment({ method: 'transfer', amount_cents: pesos(20_000), invoice: true }),
  payment({ method: 'transfer', amount_cents: pesos(30_000), invoice: true }),
  payment({ method: 'qr', amount_cents: pesos(107_000), tip_cents: pesos(5_000), invoice: true }),
  payment({ method: 'cash', amount_cents: pesos(30_000), status: 'voided' }),
  payment({ method: 'debit', amount_cents: pesos(44_000), invoice: true }),
  payment({ method: 'cash', amount_cents: pesos(35_000), status: 'voided' }),
  payment({ method: 'cash', amount_cents: pesos(30_000) }),
]
const NIGHT_MOVEMENTS: ShiftMovement[] = [
  movement({ kind: 'out', amount_cents: pesos(8_000), reason: 'Hielo' }),
  movement({ kind: 'in', amount_cents: pesos(2_000), reason: 'Cambio' }),
  movement({
    kind: 'out',
    amount_cents: pesos(1_000),
    reason: 'Error',
    voided_at: '2026-11-13T02:00:00Z',
  }),
]

describe('la caja en vivo', () => {
  const totals = liveTotals(NIGHT_PAYMENTS, NIGHT_MOVEMENTS, pesos(15_000))

  it('suma lo que entró por cada medio, en el orden de siempre', () => {
    expect(totals.by_method.map((row) => row.method)).toEqual(['cash', 'transfer', 'qr', 'debit'])
    expect(totals.by_method[0]).toMatchObject({ count: 3, amount_cents: pesos(75_000) })
    expect(totals.by_method[1]).toMatchObject({ count: 2, amount_cents: pesos(50_000) })
  })

  it('los anulados no cuentan', () => {
    expect(totals.payments_count).toBe(7)
    expect(totals.sales_cents).toBe(pesos(276_000))
  })

  it('la propina va aparte: no es venta ni efectivo que tenga que haber', () => {
    expect(totals.tip_cents).toBe(pesos(5_000))
    expect(totals.collected_cents).toBe(pesos(281_000))
    expect(totals.by_method.find((row) => row.method === 'qr')?.total_cents).toBe(pesos(112_000))
  })

  it('efectivo que tiene que haber = cambio + cobros en efectivo + ingresos − retiros', () => {
    expect(totals.cash_sales_cents).toBe(pesos(75_000))
    expect(totals.cash_in_cents).toBe(pesos(2_000))
    expect(totals.cash_out_cents).toBe(pesos(8_000))
    expect(totals.expected_cash_cents).toBe(pesos(84_000))
    expect(expectedCash(pesos(15_000), NIGHT_PAYMENTS, NIGHT_MOVEMENTS)).toBe(pesos(84_000))
  })

  it('separa lo que se factura de lo que no', () => {
    expect(totals.invoiced_cents).toBe(pesos(201_000))
    expect(totals.not_invoiced_cents).toBe(pesos(75_000))
  })

  it('el recargo se suma a lo cobrado y a lo facturado, no a la venta', () => {
    const withCredit = liveTotals(
      [
        payment({
          method: 'credit',
          amount_cents: pesos(25_000),
          surcharge_cents: pesos(2_500),
          invoice: true,
        }),
      ],
      [],
      0,
    )
    expect(withCredit.sales_cents).toBe(pesos(25_000))
    expect(withCredit.surcharge_cents).toBe(pesos(2_500))
    expect(withCredit.invoiced_cents).toBe(pesos(27_500))
    expect(withCredit.expected_cash_cents).toBe(0)
  })

  it('un turno sin cobros espera el cambio inicial', () => {
    expect(liveTotals([], [], pesos(15_000))).toMatchObject({
      by_method: [],
      sales_cents: 0,
      expected_cash_cents: pesos(15_000),
    })
  })
})

describe('el conteo', () => {
  it('arranca en blanco con los billetes del bar, de mayor a menor', () => {
    const blank = emptyCount([1000, 20000, 10000, 1000])
    expect(blank.bills.map((bill) => bill.value)).toEqual([20000, 10000, 1000])
    expect(countTotal(blank)).toBe(0)
  })

  it('suma billete por billete, más las monedas', () => {
    expect(
      countTotal({
        bills: [
          { value: 20000, count: 4 },
          { value: 1000, count: 3 },
        ],
        other_cents: 0,
      }),
    ).toBe(pesos(83_000))
    expect(countTotal({ bills: [{ value: 500, count: 2 }], other_cents: pesos(350) })).toBe(
      pesos(1_350),
    )
  })
})

describe('qué pudo haber pasado', () => {
  it('si cierra justo no hay nada que explicar', () => {
    expect(probableMistakes(0, NIGHT_PAYMENTS, NIGHT_MOVEMENTS, BILLS)).toEqual([])
  })

  it('sobra justo una transferencia: ¿era efectivo?', () => {
    const transfer = payment({ method: 'transfer', amount_cents: pesos(12_000), table_label: '5' })
    const [first] = probableMistakes(pesos(12_000), [payment(), transfer], [], BILLS)
    expect(first).toMatchObject({ kind: 'method_mixup', paymentId: transfer.id })
    expect(first?.message).toBe(
      `Hay una transferencia de ${formatCentsShort(pesos(12_000))} justos (mesa 5): ¿era efectivo?`,
    )
  })

  it('falta justo un cobro en efectivo: ¿era transferencia o tarjeta?', () => {
    const cash = payment({ method: 'cash', amount_cents: pesos(23_500), table_label: '7' })
    const [first] = probableMistakes(-pesos(23_500), [cash, payment({ method: 'qr' })], [], BILLS)
    expect(first).toMatchObject({ kind: 'method_mixup', paymentId: cash.id })
    expect(first?.message).toContain('¿era transferencia o tarjeta?')
  })

  it('no cruza los sentidos: una transferencia no explica un faltante', () => {
    const transfer = payment({ method: 'transfer', amount_cents: pesos(12_300) })
    const found = probableMistakes(-pesos(12_300), [transfer], [], BILLS)
    expect(found.some((mistake) => mistake.kind === 'method_mixup')).toBe(false)
  })

  it('sobra justo un retiro anotado: ¿salió de verdad?', () => {
    const out = movement({ kind: 'out', amount_cents: pesos(8_300), reason: 'Hielo' })
    const [first] = probableMistakes(pesos(8_300), [], [out], BILLS)
    expect(first).toMatchObject({ kind: 'movement_not_real', movementId: out.id })
    expect(first?.message).toContain('«Hielo»')
  })

  it('falta justo un ingreso anotado: ¿entró de verdad?', () => {
    const cashIn = movement({ kind: 'in', amount_cents: pesos(5_300), reason: 'Cambio' })
    const [first] = probableMistakes(-pesos(5_300), [], [cashIn], BILLS)
    expect(first).toMatchObject({ kind: 'movement_not_real', movementId: cashIn.id })
  })

  it('un movimiento anulado no explica nada', () => {
    const voided = movement({ amount_cents: pesos(8_300), voided_at: '2026-11-13T02:00:00Z' })
    const found = probableMistakes(pesos(8_300), [], [voided], BILLS)
    expect(found.some((mistake) => mistake.kind === 'movement_not_real')).toBe(false)
  })

  it('sobra justo un cobro en efectivo anulado: ¿la plata quedó?', () => {
    const voided = payment({ amount_cents: pesos(30_700), status: 'voided', table_label: '6' })
    const [first] = probableMistakes(pesos(30_700), [voided], [], BILLS)
    expect(first).toMatchObject({ kind: 'voided_cash_kept', paymentId: voided.id })
  })

  it('sobran justo las propinas en efectivo', () => {
    const found = probableMistakes(
      pesos(3_700),
      [payment({ tip_cents: pesos(1_700) }), payment({ tip_cents: pesos(2_000) })],
      [],
      BILLS,
    )
    expect(found[0]?.kind).toBe('cash_tips_in_drawer')
  })

  it('faltan justo las propinas de tarjeta: ¿se pagaron del cajón?', () => {
    const found = probableMistakes(
      -pesos(4_300),
      [
        payment({ method: 'debit', tip_cents: pesos(2_300) }),
        payment({ method: 'qr', tip_cents: pesos(2_000) }),
      ],
      [],
      BILLS,
    )
    expect(found[0]?.kind).toBe('card_tips_paid_out')
  })

  it('sobra justo un vuelto: ¿se entregó?', () => {
    const cash = payment({
      amount_cents: pesos(17_500),
      change_cents: pesos(2_500),
      table_label: '3',
    })
    const found = probableMistakes(pesos(2_500), [cash], [], BILLS)
    expect(found.find((mistake) => mistake.kind === 'change_not_given')).toMatchObject({
      paymentId: cash.id,
    })
  })

  it('un billete contado de más o de menos', () => {
    const short = probableMistakes(-pesos(10_000), [], [], BILLS)
    expect(short[0]).toMatchObject({ kind: 'bill_miscount' })
    expect(short[0]?.message).toBe(
      `Es justo un billete de ${formatCentsShort(pesos(10_000))}: ¿se contó de menos?`,
    )
    const over = probableMistakes(pesos(6_000), [], [], BILLS)
    expect(over[0]?.message).toBe(
      `Es justo 3 billetes de ${formatCentsShort(pesos(2_000))}: ¿se contaron de más?`,
    )
  })

  it('un cobro exacto pesa más que un billete', () => {
    const transfer = payment({ method: 'transfer', amount_cents: pesos(20_000) })
    const found = probableMistakes(pesos(20_000), [transfer], [], BILLS)
    expect(found.map((mistake) => mistake.kind).slice(0, 2)).toEqual([
      'method_mixup',
      'bill_miscount',
    ])
  })

  it('un cero de menos en un retiro', () => {
    // Se anotó un retiro de 1.500 y en realidad salieron 15.000: faltan 13.500.
    const out = movement({ kind: 'out', amount_cents: pesos(1_500), reason: 'Verdulería' })
    const found = probableMistakes(-pesos(13_500), [], [out], BILLS)
    const hit = found.find((mistake) => mistake.kind === 'missing_zero')
    expect(hit).toMatchObject({ movementId: out.id })
    expect(hit?.message).toContain(formatCentsShort(pesos(15_000)))
    expect(hit?.message).toContain('un cero más')
    // Con un sospechoso concreto no hace falta el aviso general del múltiplo de 9.
    expect(found.filter((mistake) => mistake.kind === 'transposed')).toEqual([])
  })

  it('un cero de más en un ingreso', () => {
    // Se anotó un ingreso de 20.000 y entraron 2.000: faltan 18.000.
    const cashIn = movement({ kind: 'in', amount_cents: pesos(20_000), reason: 'Cambio' })
    const hit = probableMistakes(-pesos(18_000), [], [cashIn], BILLS).find(
      (mistake) => mistake.kind === 'missing_zero',
    )
    expect(hit?.message).toContain('un cero menos')
  })

  it('dos cifras cambiadas de lugar, con el sospechoso', () => {
    // Se anotó un retiro de 4.500 y salieron 5.400: faltan 900.
    const out = movement({ kind: 'out', amount_cents: pesos(4_500), reason: 'Limones' })
    const hit = probableMistakes(-pesos(900), [], [out], BILLS).find(
      (mistake) => mistake.kind === 'transposed',
    )
    expect(hit).toMatchObject({ movementId: out.id, score: 60 })
    expect(hit?.message).toContain(formatCentsShort(pesos(5_400)))
  })

  it('múltiplo de 9 sin sospechoso: el aviso general', () => {
    const found = probableMistakes(
      pesos(2_700),
      [payment({ amount_cents: pesos(8_000) })],
      [],
      BILLS,
    )
    const hit = found.find((mistake) => mistake.kind === 'transposed')
    expect(hit?.score).toBe(35)
    expect(hit?.paymentId).toBeUndefined()
  })

  it('menos que el billete más chico: redondeo', () => {
    const found = probableMistakes(-pesos(50), [], [], BILLS)
    expect(found[0]?.kind).toBe('rounding')
  })

  it('siempre queda la pregunta de lo que nadie anotó, y va última', () => {
    const short = probableMistakes(-pesos(7_300), [], [], BILLS)
    expect(short.at(-1)).toMatchObject({ kind: 'unrecorded_movement' })
    expect(short.at(-1)?.message).toContain('¿Se sacó plata')
    expect(probableMistakes(pesos(7_300), [], [], BILLS).at(-1)?.message).toContain('¿Entró plata')
  })

  it('viene ordenado de lo más probable a lo menos y respeta el tope', () => {
    const transfer = payment({ method: 'transfer', amount_cents: pesos(18_000) })
    const out = movement({ kind: 'out', amount_cents: pesos(18_000) })
    const found = probableMistakes(pesos(18_000), [transfer], [out], BILLS)
    const scores = found.map((mistake) => mistake.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(found.length).toBeLessThanOrEqual(5)
    expect(probableMistakes(pesos(18_000), [transfer], [out], BILLS, 2)).toHaveLength(2)
  })
})

describe('ayudas', () => {
  it('detecta dos cifras vecinas cambiadas de lugar', () => {
    expect(isTransposition(4500, 5400)).toBe(true)
    expect(isTransposition(12350, 12530)).toBe(true)
    expect(isTransposition(4500, 4500)).toBe(false)
    expect(isTransposition(4500, 5040)).toBe(false) // no son vecinas
    expect(isTransposition(450, 5400)).toBe(false)
  })

  it('una corrección de medio se lee en criollo', () => {
    expect(methodChangeLabel('transfer', 'cash')).toBe('Transferencia → Efectivo')
    expect(methodChangeLabel('credit', 'debit')).toBe('Crédito → Débito')
  })
})
