import { describe, expect, it } from 'vitest'
import {
  buildCashDailySeries,
  buildCashDailyViews,
  CASH_CHART_ALL,
  CASH_CHART_RANGE_OPTIONS,
  type CashDailyAccount,
  type CashDailyReport,
  cashDailyBalanceText,
  cashDailySummary,
  formatAxisCents,
  resolveCashChartRange,
} from '@/lib/accounting/cash-daily'
import { parseCashDaily } from '@/lib/accounting/queries/cash-flow'

const NBSP = ' '
const MINUS = '−'
/** Los importes llevan espacio duro después del `$`: se compara con espacios comunes. */
const plain = (text: string) => text.replaceAll(NBSP, ' ')

const CAJA = '11111111-1111-4111-8111-111111111111'
const BANCO = '22222222-2222-4222-8222-222222222222'
const TARJETA = '33333333-3333-4333-8333-333333333333'

function account(over: Partial<CashDailyAccount> = {}): CashDailyAccount {
  return {
    treasuryId: CAJA,
    name: 'Caja',
    kind: 'cash',
    active: true,
    openingCents: 0,
    closingCents: 0,
    days: [],
    ...over,
  }
}

describe('resolveCashChartRange: el período del gráfico (?periodo=)', () => {
  it('sin nada, los últimos 30 días contando hoy', () => {
    const range = resolveCashChartRange(null, '2026-10-12')
    expect(range).toMatchObject({ key: 'ultimos-30-dias', from: '2026-09-13', to: '2026-10-12' })
    expect(range.label).toBe('13/09 – 12/10/2026')
  })

  it('«Este mes» va del 1 hasta hoy: los días que faltan no se dibujan', () => {
    expect(resolveCashChartRange('este-mes', '2026-10-12')).toMatchObject({
      key: 'este-mes',
      from: '2026-10-01',
      to: '2026-10-12',
    })
    // El 1 del mes es un solo día.
    expect(resolveCashChartRange('este-mes', '2026-10-01')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-01',
    })
  })

  it('«Mes pasado» es el mes entero, también al cruzar de año', () => {
    expect(resolveCashChartRange('mes-pasado', '2026-10-12')).toMatchObject({
      key: 'mes-pasado',
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(resolveCashChartRange('mes-pasado', '2027-01-05')).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })

  it('un valor que no es ninguno de los tres cae en los últimos 30 días', () => {
    for (const raw of ['2026-09', 'este-anio', '  ', '2026-01-01..2026-12-31']) {
      expect(resolveCashChartRange(raw, '2026-10-12').key).toBe('ultimos-30-dias')
    }
  })

  it('ofrece los tres períodos con el nombre de siempre', () => {
    expect(CASH_CHART_RANGE_OPTIONS).toEqual([
      { key: 'ultimos-30-dias', label: 'Últimos 30 días' },
      { key: 'este-mes', label: 'Este mes' },
      { key: 'mes-pasado', label: 'Mes pasado' },
    ])
  })
})

describe('buildCashDailySeries: un punto por día', () => {
  const range = { from: '2026-10-01', to: '2026-10-06' }

  it('los días sin movimiento arrastran el saldo del anterior', () => {
    const series = buildCashDailySeries(
      account({
        openingCents: 100_000,
        closingCents: 130_000,
        days: [
          { day: '2026-10-02', inCents: 50_000, outCents: 0, balanceCents: 150_000 },
          { day: '2026-10-05', inCents: 10_000, outCents: 30_000, balanceCents: 130_000 },
        ],
      }),
      range,
    )
    expect(series.points.map((p) => p.day)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ])
    expect(series.points.map((p) => p.balanceCents)).toEqual([
      100_000, 150_000, 150_000, 150_000, 130_000, 130_000,
    ])
    expect(series.points.map((p) => p.moved)).toEqual([false, true, false, false, true, false])
    expect(series.points[1]).toMatchObject({ upCents: 50_000, downCents: 0 })
    expect(series.points[4]).toMatchObject({ upCents: 10_000, downCents: 30_000 })
    expect(series).toMatchObject({
      mode: 'money',
      openingCents: 100_000,
      closingCents: 130_000,
      upCents: 60_000,
      downCents: 30_000,
      hasMovements: true,
    })
  })

  it('cada día cierra con el anterior + lo que entró − lo que salió', () => {
    const series = buildCashDailySeries(
      account({
        openingCents: 20_000,
        days: [
          { day: '2026-10-01', inCents: 5_000, outCents: 1_000, balanceCents: 24_000 },
          { day: '2026-10-03', inCents: 0, outCents: 30_000, balanceCents: -6_000 },
          { day: '2026-10-06', inCents: 8_000, outCents: 0, balanceCents: 2_000 },
        ],
      }),
      range,
    )
    let previous = series.openingCents
    for (const p of series.points) {
      expect(p.balanceCents).toBe(previous + p.upCents - p.downCents)
      previous = p.balanceCents
    }
    expect(series.closingCents).toBe(2_000)
  })

  it('sin movimientos en el período, una línea plana en el saldo anterior', () => {
    const series = buildCashDailySeries(account({ openingCents: 75_000, closingCents: 75_000 }), {
      from: '2026-10-01',
      to: '2026-10-03',
    })
    expect(series.hasMovements).toBe(false)
    expect(series.points.map((p) => p.balanceCents)).toEqual([75_000, 75_000, 75_000])
    expect(series.upCents + series.downCents).toBe(0)
  })

  it('el saldo de un día con movimiento es el que mandó la base', () => {
    // Si la base y la suma no coincidieran, vale la base (es la que muestra la pantalla).
    const series = buildCashDailySeries(
      account({
        openingCents: 0,
        days: [{ day: '2026-10-02', inCents: 100, outCents: 0, balanceCents: 999 }],
      }),
      range,
    )
    expect(series.closingCents).toBe(999)
  })

  it('la tarjeta de la empresa se lee como deuda: sube con los consumos y baja con los pagos', () => {
    const series = buildCashDailySeries(
      account({
        treasuryId: TARJETA,
        name: 'Visa',
        kind: 'credit_card',
        // Debe − Haber: se deben $ 500.
        openingCents: -50_000,
        days: [
          // Un consumo (Haber) de $ 300 y, después, un pago (Debe) de $ 800.
          { day: '2026-10-02', inCents: 0, outCents: 30_000, balanceCents: -80_000 },
          { day: '2026-10-04', inCents: 80_000, outCents: 0, balanceCents: 0 },
        ],
      }),
      range,
    )
    expect(series.mode).toBe('card')
    expect(series.openingCents).toBe(50_000)
    expect(series.points.map((p) => p.balanceCents)).toEqual([50_000, 80_000, 80_000, 0, 0, 0])
    expect(series.points[1]).toMatchObject({ upCents: 30_000, downCents: 0 })
    expect(series.points[3]).toMatchObject({ upCents: 0, downCents: 80_000 })
    expect(series).toMatchObject({ upCents: 30_000, downCents: 80_000, closingCents: 0 })
    // Nunca «−0».
    expect(Object.is(series.closingCents, -0)).toBe(false)
    expect(series.points.every((p) => !Object.is(p.balanceCents, -0))).toBe(true)
  })
})

describe('buildCashDailyViews: lo que elige el selector', () => {
  const report: CashDailyReport = {
    from: '2026-10-10',
    to: '2026-10-12',
    // Como la manda la base: cajas de activo, sin la tarjeta y sin mover plata entre cajas.
    total: account({
      treasuryId: null,
      name: '',
      kind: null,
      openingCents: 300_000,
      closingCents: 350_000,
      days: [{ day: '2026-10-11', inCents: 50_000, outCents: 0, balanceCents: 350_000 }],
    }),
    accounts: [
      account({
        openingCents: 100_000,
        closingCents: 0,
        // Sacó $ 1.000 de la caja para depositarlos en el banco.
        days: [{ day: '2026-10-11', inCents: 0, outCents: 100_000, balanceCents: 0 }],
      }),
      account({
        treasuryId: BANCO,
        name: 'Banco',
        kind: 'bank',
        active: false,
        openingCents: 200_000,
        closingCents: 350_000,
        days: [{ day: '2026-10-11', inCents: 150_000, outCents: 0, balanceCents: 350_000 }],
      }),
      account({
        treasuryId: TARJETA,
        name: 'Visa',
        kind: 'credit_card',
        openingCents: -40_000,
        closingCents: -40_000,
      }),
    ],
  }
  const views = buildCashDailyViews(report, { today: '2026-10-12' })

  it('«Todas las cajas» primero y después cada una, en su orden', () => {
    expect(views.map((v) => v.value)).toEqual([CASH_CHART_ALL, CAJA, BANCO, TARJETA])
    expect(views.map((v) => v.label)).toEqual([
      'Todas las cajas',
      'Caja',
      'Banco (desactivada)',
      'Visa',
    ])
  })

  it('«Todas las cajas» usa la suma de la base: sin la tarjeta y sin mover plata entre cajas', () => {
    const all = views[0]
    expect(all?.series.points.map((p) => p.balanceCents)).toEqual([300_000, 350_000, 350_000])
    // Los $ 1.000 que pasaron de la caja al banco no entraron ni salieron.
    expect(all?.series).toMatchObject({ upCents: 50_000, downCents: 0, closingCents: 350_000 })
    expect(all?.note).toContain('Mover plata de una caja a otra no cuenta')
    expect(all?.note).toContain('tarjetas de la empresa van aparte')
  })

  it('la tarjeta explica cómo leerla; una caja común no lleva aclaración', () => {
    expect(views[1]?.note).toBeNull()
    expect(views[3]?.note).toBe('Es una deuda: sube con los consumos y baja con los pagos.')
    expect(views[3]?.series.mode).toBe('card')
  })

  it('sin tarjetas, la aclaración de todas no las nombra', () => {
    const without = buildCashDailyViews(
      { ...report, accounts: report.accounts.slice(0, 2) },
      { today: '2026-10-12' },
    )
    expect(without[0]?.note).toBe(
      'Mover plata de una caja a otra no cuenta como entrada ni como salida.',
    )
  })

  it('el resumen dice «hoy» solo si el período termina hoy', () => {
    expect(plain(views[0]?.summary ?? '')).toBe(
      'Empezó en $ 3.000 y hoy hay $ 3.500. En el período entró $ 500 y salió $ 0.',
    )
    const past = buildCashDailyViews(report, { today: '2026-10-20' })
    expect(plain(past[0]?.summary ?? '')).toContain('y terminó en $ 3.500.')
  })
})

describe('cashDailySummary: el gráfico en palabras', () => {
  const range = { from: '2026-10-01', to: '2026-10-03' }

  it('un descubierto se dice con palabras, sin menos', () => {
    const series = buildCashDailySeries(
      account({
        openingCents: -10_000,
        days: [{ day: '2026-10-02', inCents: 0, outCents: 5_000, balanceCents: -15_000 }],
      }),
      range,
    )
    const text = plain(cashDailySummary(series, { endsToday: true }))
    expect(text).toBe(
      'Empezó con un descubierto de $ 100 y hoy hay un descubierto de $ 150. En el período entró $ 0 y salió $ 50.',
    )
    expect(text).not.toContain(MINUS)
    expect(plain(cashDailySummary(series, { endsToday: false }))).toContain(
      'terminó con un descubierto de $ 150',
    )
  })

  it('la tarjeta habla de deuda, consumos y pagos', () => {
    const card = (days: CashDailyAccount['days'], openingCents: number) =>
      buildCashDailySeries(account({ kind: 'credit_card', openingCents, days }), range)
    expect(
      plain(
        cashDailySummary(
          card(
            [{ day: '2026-10-02', inCents: 0, outCents: 20_000, balanceCents: -70_000 }],
            -50_000,
          ),
          { endsToday: true },
        ),
      ),
    ).toBe(
      'Empezó con una deuda de $ 500 y hoy la deuda es de $ 700. En el período hubo consumos por $ 200 y pagos por $ 0.',
    )
    expect(
      plain(
        cashDailySummary(
          card(
            [{ day: '2026-10-02', inCents: 60_000, outCents: 0, balanceCents: 10_000 }],
            -50_000,
          ),
          { endsToday: false },
        ),
      ),
    ).toContain('terminó con $ 100 a favor.')
    expect(
      plain(
        cashDailySummary(
          card([{ day: '2026-10-02', inCents: 50_000, outCents: 0, balanceCents: 0 }], -50_000),
          { endsToday: true },
        ),
      ),
    ).toContain('y hoy no hay deuda.')
    expect(plain(cashDailySummary(card([], 0), { endsToday: false }))).toBe(
      'Empezó sin deuda y terminó sin deuda.',
    )
  })

  it('sin movimientos no inventa entradas ni salidas', () => {
    const series = buildCashDailySeries(account({ openingCents: 80_000 }), range)
    expect(plain(cashDailySummary(series, { endsToday: true }))).toBe(
      'Empezó en $ 800 y hoy hay $ 800.',
    )
  })
})

describe('cashDailyBalanceText: el saldo de un día', () => {
  it('una caja: importe, o «Descubierto» si quedó en negativo', () => {
    expect(plain(cashDailyBalanceText('money', 123_450))).toBe('$ 1.234,50')
    expect(plain(cashDailyBalanceText('money', -123_450))).toBe('Descubierto $ 1.234,50')
    expect(plain(cashDailyBalanceText('money', 0))).toBe('$ 0,00')
    expect(plain(cashDailyBalanceText('money', 123_450, 0))).toBe('$ 1.235')
  })

  it('la tarjeta: la deuda, a favor o sin deuda', () => {
    expect(plain(cashDailyBalanceText('card', 50_000))).toBe('$ 500,00')
    expect(plain(cashDailyBalanceText('card', -50_000))).toBe('A favor $ 500,00')
    expect(cashDailyBalanceText('card', 0)).toBe('Sin deuda')
  })
})

describe('formatAxisCents: importes cortos para el eje', () => {
  it('pesos, miles y millones', () => {
    expect(plain(formatAxisCents(0))).toBe('$ 0')
    expect(plain(formatAxisCents(85_000))).toBe('$ 850')
    expect(plain(formatAxisCents(150_000))).toBe('$ 1,5 mil')
    expect(plain(formatAxisCents(1_250_000))).toBe('$ 12,5 mil')
    expect(plain(formatAxisCents(85_000_000))).toBe('$ 850 mil')
    expect(plain(formatAxisCents(100_000_000))).toBe('$ 1 M')
    expect(plain(formatAxisCents(430_000_000))).toBe('$ 4,3 M')
    expect(plain(formatAxisCents(4_500_000_000))).toBe('$ 45 M')
  })

  it('lo negativo lleva menos tipográfico; el cero, no', () => {
    expect(plain(formatAxisCents(-200_000_000))).toBe(`${MINUS}$ 2 M`)
    expect(plain(formatAxisCents(-10))).toBe('$ 0')
  })

  it('no salta de «999 mil» a «1000 mil»', () => {
    expect(plain(formatAxisCents(99_960_000))).toBe('$ 1 M')
    expect(plain(formatAxisCents(99_940_000))).toBe('$ 999 mil')
  })

  it('un valor que no es número no se dibuja', () => {
    expect(formatAxisCents(Number.NaN)).toBe('')
  })
})

describe('parseCashDaily: las filas de acc_report_cash_daily', () => {
  const range = { from: '2026-10-01', to: '2026-10-12' }
  const raw = [
    {
      treasury_id: null,
      name: null,
      kind: null,
      active: true,
      // `bigint` puede llegar como string.
      opening_cents: '1110519756',
      closing_cents: '4272959432',
      days: [
        { day: '2026-10-08', in_cents: 100, out_cents: 0, balance_cents: '4272959432' },
        { day: '2026-10-02', in_cents: '500', out_cents: '200', balance_cents: 4272959332 },
      ],
    },
    {
      treasury_id: CAJA,
      name: 'Caja',
      kind: 'cash',
      active: true,
      opening_cents: 136339800,
      closing_cents: 39475700,
      days: [
        { day: '2026-10-06', in_cents: 0, out_cents: 96864100, balance_cents: 39475700 },
        // Fuera del período o sin fecha: no se pueden dibujar.
        { day: '2026-09-30', in_cents: 1, out_cents: 0, balance_cents: 1 },
        { day: 'ayer', in_cents: 1, out_cents: 0, balance_cents: 1 },
        'basura',
      ],
    },
    {
      treasury_id: TARJETA,
      name: 'Visa',
      kind: 'tarjeta-rara',
      active: false,
      opening_cents: -5000,
      closing_cents: -5000,
      // jsonb como texto.
      days: '[]',
    },
  ]

  it('separa «todas las cajas» (sin caja) de cada caja', () => {
    const report = parseCashDaily(raw, range)
    expect(report.from).toBe('2026-10-01')
    expect(report.to).toBe('2026-10-12')
    expect(report.total).toMatchObject({
      treasuryId: null,
      kind: null,
      openingCents: 1_110_519_756,
      closingCents: 4_272_959_432,
    })
    expect(report.accounts.map((a) => a.treasuryId)).toEqual([CAJA, TARJETA])
  })

  it('ordena los días y descarta los que no sirven', () => {
    const report = parseCashDaily(raw, range)
    expect(report.total.days).toEqual([
      { day: '2026-10-02', inCents: 500, outCents: 200, balanceCents: 4_272_959_332 },
      { day: '2026-10-08', inCents: 100, outCents: 0, balanceCents: 4_272_959_432 },
    ])
    expect(report.accounts[0]?.days).toEqual([
      { day: '2026-10-06', inCents: 0, outCents: 96_864_100, balanceCents: 39_475_700 },
    ])
  })

  it('una clase de caja que no conoce es «other»; la inactiva queda marcada', () => {
    const card = parseCashDaily(raw, range).accounts[1]
    expect(card).toMatchObject({ kind: 'other', active: false, openingCents: -5000, days: [] })
  })

  it('sin la fila de todas, el total queda en cero (no rompe)', () => {
    const report = parseCashDaily(raw.slice(1), range)
    expect(report.total).toMatchObject({ treasuryId: null, openingCents: 0, days: [] })
    expect(parseCashDaily([], range).accounts).toEqual([])
  })
})
