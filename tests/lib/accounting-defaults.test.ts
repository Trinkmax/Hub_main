import { describe, expect, it } from 'vitest'
import {
  amountLooksOff,
  medianCents,
  nextRangeStart,
  pickAccountingDate,
  pickTreasury,
  pickVatRate,
  pickVoucherType,
  rangeStartFor,
  suggestDueDate,
  suggestPaymentTerm,
} from '@/lib/accounting/defaults'

const CAJA = { id: 'caja', kind: 'cash' as const, active: true }
const MP = { id: 'mp', kind: 'wallet' as const, active: true }
const BANCO = { id: 'banco', kind: 'bank' as const, active: true }
const VIEJA = { id: 'vieja', kind: 'cash' as const, active: false }

describe('pickTreasury: ¿con qué pagaste? (H.5)', () => {
  const treasuries = [MP, BANCO, CAJA, VIEJA]

  it('primero el último medio usado con ese proveedor', () => {
    expect(pickTreasury({ treasuries, lastUsedWithParty: 'banco', myLastQuickExpense: 'mp' })).toBe(
      'banco',
    )
  })

  it('si no, mi último «Nuevo gasto»', () => {
    expect(pickTreasury({ treasuries, lastUsedWithParty: null, myLastQuickExpense: 'mp' })).toBe(
      'mp',
    )
  })

  it('una caja desactivada o borrada se saltea', () => {
    expect(
      pickTreasury({ treasuries, lastUsedWithParty: 'vieja', myLastQuickExpense: 'no-existe' }),
    ).toBe('caja')
  })

  it('si no, Caja (la primera de efectivo activa, en el orden de las cajas)', () => {
    const otraCaja = { id: 'caja2', kind: 'cash' as const, active: true }
    expect(pickTreasury({ treasuries: [MP, otraCaja, CAJA] })).toBe('caja2')
    expect(pickTreasury({ treasuries: [MP, otraCaja, CAJA], order: ['caja', 'caja2', 'mp'] })).toBe(
      'caja',
    )
  })

  it('sin efectivo, la primera activa; sin cajas, null', () => {
    expect(pickTreasury({ treasuries: [MP, BANCO] })).toBe('mp')
    expect(pickTreasury({ treasuries: [VIEJA] })).toBeNull()
    expect(pickTreasury({ treasuries: [] })).toBeNull()
  })
})

describe('suggestPaymentTerm: plazo sugerido tras 3 facturas iguales', () => {
  const thirty = [
    { issueDate: '2026-10-20', dueDate: '2026-11-19' },
    { issueDate: '2026-10-10', dueDate: '2026-11-09' },
    { issueDate: '2026-09-30', dueDate: '2026-10-30' },
  ]

  it('tres seguidas a 30 días con el plazo cargado en 21 → propone 30', () => {
    expect(suggestPaymentTerm({ currentTermDays: 21, recent: thirty })).toBe(30)
  })

  it('si ya es el plazo cargado, no propone nada', () => {
    expect(suggestPaymentTerm({ currentTermDays: 30, recent: thirty })).toBeNull()
  })

  it('con menos de tres, plazos distintos o una sin vencimiento, no propone', () => {
    expect(suggestPaymentTerm({ currentTermDays: 21, recent: thirty.slice(0, 2) })).toBeNull()
    const mixed = [...thirty.slice(0, 2), { issueDate: '2026-09-30', dueDate: '2026-10-21' }]
    expect(suggestPaymentTerm({ currentTermDays: 21, recent: mixed })).toBeNull()
    const noDue = [...thirty.slice(0, 2), { issueDate: '2026-09-30', dueDate: null }]
    expect(suggestPaymentTerm({ currentTermDays: 21, recent: noDue })).toBeNull()
  })

  it('solo miran las tres más nuevas', () => {
    const older = [...thirty, { issueDate: '2026-09-01', dueDate: '2026-09-02' }]
    expect(suggestPaymentTerm({ currentTermDays: 0, recent: older })).toBe(30)
  })

  it('vencimiento por defecto: emisión + plazo', () => {
    expect(suggestDueDate('2026-10-03', 21)).toBe('2026-10-24') // E1
    expect(suggestDueDate('2026-12-20', 30)).toBe('2027-01-19')
    expect(suggestDueDate('2026-10-03', -5)).toBe('2026-10-03')
  })
})

describe('¿un cero de más? (mediana de los últimos 10)', () => {
  it('mediana con cantidad impar y par (redondeando hacia arriba)', () => {
    expect(medianCents([300, 100, 200])).toBe(200)
    expect(medianCents([100, 200])).toBe(150)
    expect(medianCents([100, 201])).toBe(151) // 150,5 → 151
    expect(medianCents([])).toBeNull()
    expect(medianCents([0, -5])).toBeNull()
  })

  it('solo los 10 más recientes', () => {
    const recent = [
      ...Array.from({ length: 10 }, () => 12_000_000),
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
    ]
    expect(medianCents(recent)).toBe(12_000_000)
  })

  it('avisa con 10 veces la mediana o más, o un décimo o menos', () => {
    const median = 12_000_000 // «Con Coca-Cola solés gastar alrededor de $ 120.000»
    expect(amountLooksOff(120_000_000, median)).toBe(true) // un cero de más
    expect(amountLooksOff(119_999_999, median)).toBe(false)
    expect(amountLooksOff(1_200_000, median)).toBe(true) // un cero de menos
    expect(amountLooksOff(1_200_001, median)).toBe(false)
    expect(amountLooksOff(12_500_000, median)).toBe(false)
  })

  it('sin historia no avisa', () => {
    expect(amountLooksOff(1_000, null)).toBe(false)
    expect(amountLooksOff(1_000, 0)).toBe(false)
    expect(amountLooksOff(0, 1_000)).toBe(false)
  })
})

describe('«desde» = último «hasta» + 1 (cierre del día)', () => {
  it('nextRangeStart', () => {
    expect(nextRangeStart(14_662)).toBe(14_663)
    expect(nextRangeStart(null)).toBeNull()
    expect(nextRangeStart(undefined)).toBeNull()
    expect(nextRangeStart(99_999_999)).toBeNull()
  })

  it('desde acc_sales_range_defaults, por tipo y punto de venta', () => {
    const defaults = [
      { voucher_type: 'factura_b', point_of_sale: 3, channel: 'salon', last_number_to: 14_662 },
      { voucher_type: 'factura_b', point_of_sale: 4, channel: 'delivery', last_number_to: 2_130 },
      { voucher_type: 'nota_credito_b', point_of_sale: 3, channel: 'salon', last_number_to: null },
    ]
    expect(rangeStartFor(defaults, 'factura_b', 3)).toBe(14_663)
    expect(rangeStartFor(defaults, 'factura_b', 4)).toBe(2_131)
    expect(rangeStartFor(defaults, 'nota_credito_b', 3)).toBeNull()
    expect(rangeStartFor(defaults, 'factura_a', 3)).toBeNull()
  })
})

describe('comprobante, alícuota y fecha por defecto', () => {
  it('el último con el proveedor, si no por su condición; sin proveedor, sin comprobante', () => {
    expect(pickVoucherType({ hasParty: false })).toBe('sin_comprobante')
    expect(
      pickVoucherType({
        hasParty: true,
        lastVoucherType: 'factura_b',
        partyCondition: 'responsable_inscripto',
      }),
    ).toBe('factura_b')
    expect(pickVoucherType({ hasParty: true, partyCondition: 'responsable_inscripto' })).toBe(
      'factura_a',
    )
    expect(pickVoucherType({ hasParty: true, partyCondition: 'monotributo' })).toBe('factura_c')
    expect(pickVoucherType({ hasParty: true, partyCondition: 'exento' })).toBe('factura_b')
    expect(pickVoucherType({ hasParty: true, partyCondition: 'consumidor_final' })).toBe('tique')
  })

  it('la alícuota de mayor neto del último comprobante; si no, 21 %', () => {
    expect(pickVatRate([])).toBe(2100)
    expect(
      pickVatRate([
        { vatRateBp: 2100, netCents: 100 },
        { vatRateBp: 1050, netCents: 900 },
      ]),
    ).toBe(1050)
    expect(
      pickVatRate([
        { vatRateBp: 1050, netCents: 500 },
        { vatRateBp: 2700, netCents: 500 },
      ]),
    ).toBe(2700)
  })

  it('fecha contable: la de emisión, o el primer día abierto si su mes está cerrado', () => {
    expect(pickAccountingDate('2026-10-03', '2026-10-01')).toEqual({
      date: '2026-10-03',
      moved: false,
    })
    expect(pickAccountingDate('2026-09-28', '2026-10-01')).toEqual({
      date: '2026-10-01',
      moved: true,
    })
    expect(pickAccountingDate('2026-09-28', null)).toEqual({ date: '2026-09-28', moved: false })
  })
})
