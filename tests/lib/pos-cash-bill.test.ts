import { describe, expect, it } from 'vitest'
import {
  byProductAmount,
  cashChange,
  chargePreview,
  computeBill,
  creditSurcharge,
  defaultInvoice,
  discountAmount,
  partLabel,
  percentToBp,
  perPerson,
  picksToItemIds,
  roundToPeso,
  type SplitLine,
  splitEqual,
  tenderSuggestions,
  tipFromPct,
} from '@/lib/pos/cash/bill'
import { toCashError } from '@/lib/pos/cash/errors'

/** La base guarda centavos; el bar habla en pesos. */
const pesos = (n: number): number => n * 100
const BILLS = [20000, 10000, 2000, 1000, 500, 200, 100]

describe('por persona', () => {
  it('reparte parejo y redondea al peso', () => {
    expect(perPerson(pesos(100_000), 4)).toBe(pesos(25_000))
    expect(perPerson(pesos(100_000), 3)).toBe(pesos(33_333))
    expect(perPerson(pesos(50_000), 3)).toBe(pesos(16_667))
  })

  it('sin saber cuántos son no inventa un número', () => {
    expect(perPerson(pesos(100_000), null)).toBeNull()
    expect(perPerson(pesos(100_000), 0)).toBeNull()
  })

  it('redondea la mitad hacia arriba', () => {
    expect(roundToPeso(149)).toBe(100)
    expect(roundToPeso(150)).toBe(200)
    expect(roundToPeso(0)).toBe(0)
  })
})

describe('partes iguales', () => {
  it('la suma da exacto el total y lo que sobra va de a un peso a las primeras', () => {
    const parts = splitEqual(pesos(100_000), 3)
    expect(parts).toEqual([pesos(33_334), pesos(33_333), pesos(33_333)])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(pesos(100_000))
  })

  it('cuando entra justo, todas iguales', () => {
    expect(splitEqual(pesos(84_000), 4)).toEqual([
      pesos(21_000),
      pesos(21_000),
      pesos(21_000),
      pesos(21_000),
    ])
    expect(splitEqual(pesos(45_000), 1)).toEqual([pesos(45_000)])
  })

  it('todas las partes son pesos enteros, para cualquier total y cantidad', () => {
    for (const total of [pesos(1), pesos(7), pesos(10_001), pesos(165_000), pesos(999_999)]) {
      for (let parts = 1; parts <= 12; parts += 1) {
        const split = splitEqual(total, parts)
        expect(split.reduce((a, b) => a + b, 0)).toBe(total)
        expect(split.every((cents) => cents > 0 && cents % 100 === 0)).toBe(true)
        expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(100)
      }
    }
  })

  it('si no alcanza para que todos pongan un peso, hay menos partes', () => {
    expect(splitEqual(pesos(2), 3)).toEqual([pesos(1), pesos(1)])
  })

  it('con centavos sueltos igual suma el total', () => {
    const parts = splitEqual(1_000_050, 3)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_050)
  })

  it('nada que dividir', () => {
    expect(splitEqual(0, 3)).toEqual([])
    expect(splitEqual(pesos(100), 0)).toEqual([])
    expect(splitEqual(pesos(100), 2.5)).toEqual([])
  })

  it('rotula cada parte', () => {
    expect(partLabel(1, 4)).toBe('Parte 2 de 4')
  })
})

describe('por producto', () => {
  const lines: SplitLine[] = [
    { id: 'lomo', quantity: 1, line_total_cents: pesos(30_000), paid_units: 0 },
    { id: 'birra', quantity: 3, line_total_cents: pesos(15_000), paid_units: 0 },
  ]
  const plain = {
    subtotal_cents: pesos(45_000),
    due_cents: pesos(45_000),
    remaining_cents: pesos(45_000),
  }

  it('sin descuentos es la suma de lo elegido', () => {
    expect(byProductAmount(lines, [{ lineId: 'lomo', units: 1 }], plain)).toBe(pesos(30_000))
    expect(byProductAmount(lines, [{ lineId: 'birra', units: 2 }], plain)).toBe(pesos(10_000))
    expect(
      byProductAmount(
        lines,
        [
          { lineId: 'lomo', units: 1 },
          { lineId: 'birra', units: 1 },
        ],
        plain,
      ),
    ).toBe(pesos(35_000))
  })

  it('con descuento cada producto carga su parte', () => {
    // 10 % a toda la mesa: el lomo de 30.000 paga 27.000, no 30.000.
    const discounted = { ...plain, due_cents: pesos(40_500), remaining_cents: pesos(40_500) }
    expect(byProductAmount(lines, [{ lineId: 'lomo', units: 1 }], discounted)).toBe(pesos(27_000))
  })

  it('con seña también se reparte', () => {
    // Seña de 15.000 sobre 45.000: queda un tercio menos para cada producto.
    const withDeposit = { ...plain, due_cents: pesos(30_000), remaining_cents: pesos(30_000) }
    expect(byProductAmount(lines, [{ lineId: 'lomo', units: 1 }], withDeposit)).toBe(pesos(20_000))
  })

  it('quien se lleva todo lo que queda paga justo lo que falta', () => {
    const paidLines: SplitLine[] = [
      { id: 'lomo', quantity: 1, line_total_cents: pesos(30_000), paid_units: 1 },
      { id: 'birra', quantity: 3, line_total_cents: pesos(15_000), paid_units: 1 },
    ]
    const bill = {
      subtotal_cents: pesos(45_000),
      due_cents: pesos(40_333),
      remaining_cents: pesos(8_963),
    }
    expect(byProductAmount(paidLines, [{ lineId: 'birra', units: 2 }], bill)).toBe(pesos(8_963))
  })

  it('no cobra unidades que ya están cubiertas ni pasa lo que falta', () => {
    const paidLines: SplitLine[] = [
      { id: 'lomo', quantity: 1, line_total_cents: pesos(30_000), paid_units: 0 },
      { id: 'birra', quantity: 3, line_total_cents: pesos(15_000), paid_units: 2 },
    ]
    const bill = { ...plain, remaining_cents: pesos(35_000) }
    // Pide 3 cervezas pero solo queda 1 sin cobrar.
    expect(byProductAmount(paidLines, [{ lineId: 'birra', units: 3 }], bill)).toBe(pesos(5_000))
    expect(
      byProductAmount(lines, [{ lineId: 'lomo', units: 1 }], {
        ...plain,
        remaining_cents: pesos(12_000),
      }),
    ).toBe(pesos(12_000))
  })

  it('sin elegir nada, o con la mesa saldada, no hay monto', () => {
    expect(byProductAmount(lines, [], plain)).toBe(0)
    expect(byProductAmount(lines, [{ lineId: 'no-existe', units: 1 }], plain)).toBe(0)
    expect(
      byProductAmount(lines, [{ lineId: 'lomo', units: 1 }], { ...plain, remaining_cents: 0 }),
    ).toBe(0)
  })

  it('arma los item_ids: el renglón repetido una vez por unidad', () => {
    expect(
      picksToItemIds([
        { lineId: 'lomo', units: 1 },
        { lineId: 'birra', units: 2 },
        { lineId: 'flan', units: 0 },
      ]),
    ).toEqual(['lomo', 'birra', 'birra'])
  })
})

describe('recargo de crédito', () => {
  it('va solo sobre lo que se paga con crédito', () => {
    expect(creditSurcharge(pesos(25_000), 1000)).toBe(pesos(2_500))
    expect(creditSurcharge(pesos(25_000), 0)).toBe(0)
    expect(creditSurcharge(0, 1000)).toBe(0)
  })

  it('se redondea al peso, la mitad hacia arriba', () => {
    expect(creditSurcharge(pesos(12_345), 1000)).toBe(pesos(1_235)) // 1.234,50
    expect(creditSurcharge(pesos(12_344), 1000)).toBe(pesos(1_234)) // 1.234,40
    expect(creditSurcharge(pesos(9_999), 1500)).toBe(pesos(1_500)) // 1.499,85
  })

  it('da lo mismo que la cuenta entera de la base', () => {
    // ((monto × bp + 500000) / 1000000) × 100, con división entera.
    for (const amount of [pesos(1), pesos(999), pesos(12_345), pesos(165_000), 1_234_550]) {
      for (const bp of [1, 250, 1000, 1575, 5000]) {
        const expected = Number(((BigInt(amount) * BigInt(bp) + 500_000n) / 1_000_000n) * 100n)
        expect(creditSurcharge(amount, bp)).toBe(expected)
      }
    }
  })

  it('se muestra antes de cobrar, con la propina aparte', () => {
    expect(
      chargePreview({
        amountCents: pesos(25_000),
        method: 'credit',
        surchargeBp: 1000,
        tipCents: pesos(2_000),
      }),
    ).toEqual({
      surchargeCents: pesos(2_500),
      tipCents: pesos(2_000),
      totalCents: pesos(29_500),
    })
    expect(
      chargePreview({ amountCents: pesos(25_000), method: 'debit', surchargeBp: 1000 }),
    ).toEqual({
      surchargeCents: 0,
      tipCents: 0,
      totalCents: pesos(25_000),
    })
  })
})

describe('efectivo', () => {
  it('el vuelto es lo que entregó menos el monto y la propina', () => {
    expect(cashChange(pesos(50_000), pesos(20_000))).toBe(pesos(30_000))
    expect(cashChange(pesos(20_000), pesos(17_500), pesos(1_000))).toBe(pesos(1_500))
    expect(cashChange(pesos(17_500), pesos(17_500))).toBe(0)
  })

  it('si no alcanza no hay vuelto que calcular', () => {
    expect(cashChange(pesos(10_000), pesos(17_500))).toBeNull()
    expect(cashChange(pesos(18_000), pesos(17_500), pesos(1_000))).toBeNull()
  })

  it('«paga con»: justo y los próximos redondos con los billetes del bar', () => {
    expect(tenderSuggestions(pesos(17_500), BILLS)).toEqual([
      pesos(17_500),
      pesos(18_000),
      pesos(20_000),
    ])
    expect(tenderSuggestions(pesos(45_000), BILLS)).toEqual([
      pesos(45_000),
      pesos(50_000),
      pesos(60_000),
    ])
  })

  it('una cuenta chica ofrece los billetes grandes y no pasa de cinco opciones', () => {
    expect(tenderSuggestions(pesos(3_250), BILLS)).toEqual([
      pesos(3_250),
      pesos(3_500),
      pesos(4_000),
      pesos(10_000),
      pesos(20_000),
    ])
  })

  it('una cuenta grande igual ofrece redondear con los dos billetes más grandes', () => {
    expect(tenderSuggestions(pesos(653_700), BILLS)).toEqual([pesos(653_700), pesos(660_000)])
  })

  it('sin billetes cargados queda el justo; sin monto, nada', () => {
    expect(tenderSuggestions(pesos(17_500), [])).toEqual([pesos(17_500)])
    expect(tenderSuggestions(0, BILLS)).toEqual([])
  })

  it('la propina de un botón de porcentaje va al peso', () => {
    expect(tipFromPct(pesos(17_500), 10)).toBe(pesos(1_750))
    expect(tipFromPct(pesos(17_555), 10)).toBe(pesos(1_756))
    expect(tipFromPct(pesos(17_500), 0)).toBe(0)
  })
})

describe('facturar', () => {
  const byMethod = {
    cash: false,
    transfer: true,
    qr: true,
    debit: true,
    credit: true,
    other: false,
  }

  it('sale de lo que el bar tiene puesto para cada medio', () => {
    expect(defaultInvoice('cash', byMethod)).toBe(false)
    expect(defaultInvoice('transfer', byMethod)).toBe(true)
    expect(defaultInvoice('cash', { ...byMethod, cash: true })).toBe(true)
  })

  it('sin ajustes: el efectivo y «otro» no, el resto sí', () => {
    expect(defaultInvoice('cash', null)).toBe(false)
    expect(defaultInvoice('other', {})).toBe(false)
    expect(defaultInvoice('qr', {})).toBe(true)
  })
})

describe('la cuenta entera', () => {
  it('por ciento → puntos básicos', () => {
    expect(percentToBp(10)).toBe(1000)
    expect(percentToBp(12.5)).toBe(1250)
    expect(percentToBp(100)).toBe(10_000)
  })

  it('un porcentaje sigue al consumo; un monto es fijo', () => {
    expect(discountAmount(pesos(165_000), 'percent', 1000)).toBe(pesos(16_500))
    expect(discountAmount(pesos(12_345), 'percent', 1000)).toBe(pesos(1_235))
    expect(discountAmount(pesos(165_000), 'amount', pesos(5_000))).toBe(pesos(5_000))
  })

  it('consumo − descuentos − seña − cobros (los mismos números que da la base)', () => {
    // Mesa del ensayo: 165.000 de consumo, 10 % + $ 5.000 de descuento, seña de 80.000.
    const bill = computeBill({
      subtotalCents: pesos(165_000),
      discounts: [
        { kind: 'percent', value: 1000 },
        { kind: 'amount', value: pesos(5_000) },
      ],
      depositAvailableCents: pesos(80_000),
      payments: [],
    })
    expect(bill).toMatchObject({
      subtotal_cents: pesos(165_000),
      discount_cents: pesos(21_500),
      deposit_cents: pesos(80_000),
      due_cents: pesos(63_500),
      remaining_cents: pesos(63_500),
      overpaid_cents: 0,
    })
  })

  it('la seña nunca deja la cuenta en negativo', () => {
    const bill = computeBill({
      subtotalCents: pesos(60_000),
      discounts: [],
      depositAvailableCents: pesos(90_000),
      payments: [],
    })
    expect(bill.deposit_cents).toBe(pesos(60_000))
    expect(bill.due_cents).toBe(0)
    expect(bill.remaining_cents).toBe(0)
  })

  it('los descuentos nunca pasan el consumo', () => {
    const bill = computeBill({
      subtotalCents: pesos(10_000),
      discounts: [
        { kind: 'percent', value: 8000 },
        { kind: 'percent', value: 8000 },
        { kind: 'amount', value: pesos(3_000) },
      ],
      depositAvailableCents: 0,
      payments: [],
    })
    expect(bill.discount_cents).toBe(pesos(10_000))
    expect(bill.due_cents).toBe(0)
  })

  it('los cobros anulados no cuentan; recargo y propina van aparte', () => {
    const bill = computeBill({
      subtotalCents: pesos(45_000),
      discounts: [],
      depositAvailableCents: 0,
      payments: [
        { amount_cents: pesos(20_000), surcharge_cents: 0, tip_cents: 0, status: 'ok' },
        { amount_cents: pesos(30_000), surcharge_cents: 0, tip_cents: 0, status: 'voided' },
        {
          amount_cents: pesos(10_000),
          surcharge_cents: pesos(1_000),
          tip_cents: pesos(500),
          status: 'ok',
        },
      ],
    })
    expect(bill.paid_cents).toBe(pesos(30_000))
    expect(bill.remaining_cents).toBe(pesos(15_000))
    expect(bill.surcharge_cents).toBe(pesos(1_000))
    expect(bill.tip_cents).toBe(pesos(500))
  })

  it('una baja después de cobrar deja plata de más, y falta queda en cero', () => {
    const bill = computeBill({
      subtotalCents: pesos(30_000),
      discounts: [],
      depositAvailableCents: 0,
      payments: [{ amount_cents: pesos(35_000), surcharge_cents: 0, tip_cents: 0, status: 'ok' }],
    })
    expect(bill.overpaid_cents).toBe(pesos(5_000))
    expect(bill.remaining_cents).toBe(0)
  })
})

describe('los errores, en criollo', () => {
  it('traduce el código que tira la base', () => {
    expect(toCashError({ message: 'no_open_shift' })).toMatchObject({
      code: 'no_open_shift',
      message: 'La caja está cerrada: hay que abrir el turno antes de cobrar.',
    })
  })

  it('dice cuánto falta cuando el monto se pasa', () => {
    const error = toCashError({ message: 'amount_exceeds_remaining', details: '1250000' })
    expect(error.code).toBe('amount_exceeds_remaining')
    expect(error.message).toContain('12.500')
  })

  it('no confunde un código con otro que lo contiene', () => {
    expect(toCashError({ message: 'items_already_paid' }).code).toBe('items_already_paid')
    expect(toCashError({ message: 'item_already_paid' }).code).toBe('item_already_paid')
    expect(toCashError({ message: 'error: closed_shift_owner_only (42501)' }).code).toBe(
      'closed_shift_owner_only',
    )
  })

  it('lo que no es de la caja lo traduce el de siempre', () => {
    expect(toCashError({ message: 'session_not_open' })).toMatchObject({
      code: 'session_not_open',
      message: 'Esa mesa ya se cerró.',
    })
    expect(toCashError({ message: 'algo raro' }).code).toBe('unknown')
    expect(toCashError(null).code).toBe('unknown')
  })

  it('el motivo vale para un descuento, una anulación o un retiro', () => {
    expect(toCashError({ message: 'reason_required' }).message).toBe('Contame el motivo.')
  })
})
