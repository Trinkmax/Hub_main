import { describe, expect, it } from 'vitest'
import {
  buildEventConsolidated,
  type ConsolidatedEditionInput,
} from '@/lib/salon/event-consolidated'
import {
  buildMonthMarketingReport,
  type EventMarketingRow,
  NIGHT_RESULT_DISCLAIMER,
} from '@/lib/salon/event-marketing'
import {
  buildMoneyShare,
  donutArcs,
  eventMoneyShare,
  eventMoneyShareBase,
  eventMoneyTotals,
  largestRemainder,
  MONEY_SHARE_ORGANIC_NOTE,
  MONEY_SHARE_TITLE,
  type MoneyTotals,
  monthMoneyShare,
} from '@/lib/salon/money-share'

const HOY = '2026-10-02'

/** El espacio duro de los montos, escrito como en pantalla para que el test se lea. */
function nb(text: string): string {
  return text.replace(/\$ /g, '$\u00A0').replace(/ %/g, '\u00A0%')
}

function row(id: string, over: Partial<EventMarketingRow> = {}): EventMarketingRow {
  return {
    scheduledEventId: id,
    adSpendUsdCents: 0,
    messages: null,
    reach: null,
    revenueArsCents: null,
    usdArsRate: null,
    revenuePerGuestArsCents: null,
    costPerGuestArsCents: null,
    drinkRevenuePerGuestArsCents: null,
    drinkCostPerGuestArsCents: null,
    notes: null,
    updatedAt: '2026-09-30T20:30:00Z',
    updatedByName: 'Nacho B.',
    ...over,
  }
}

function ed(
  key: string,
  date: string,
  over: Partial<ConsolidatedEditionInput> = {},
): ConsolidatedEditionInput {
  return {
    key,
    eventId: key,
    date,
    reservations: 0,
    guests: 0,
    billableGuests: 0,
    attendedGuests: 0,
    isFuture: date > HOY,
    isTonight: date === HOY,
    ...over,
  }
}

/** 2x1 Burger Martes con los datos reales al 02/10/2026. */
const BURGER_EDITIONS: ConsolidatedEditionInput[] = [
  ed('b1027', '2026-10-27'),
  ed('b1020', '2026-10-20'),
  ed('b1013', '2026-10-13'),
  ed('b1006', '2026-10-06'),
  ed('b0929', '2026-09-29', {
    reservations: 6,
    guests: 15,
    billableGuests: 15,
    attendedGuests: 15,
  }),
  ed('b0922', '2026-09-22', {
    reservations: 10,
    guests: 26,
    billableGuests: 25,
    attendedGuests: 25,
  }),
  ed('b0915', '2026-09-15', {
    reservations: 23,
    guests: 62,
    billableGuests: 65,
    attendedGuests: 65,
  }),
  ed('b0908', '2026-09-08', {
    reservations: 14,
    guests: 56,
    billableGuests: 59,
    attendedGuests: 51,
  }),
  ed('b0901', '2026-09-01', {
    reservations: 10,
    guests: 28,
    billableGuests: 28,
    attendedGuests: 28,
  }),
]

const BURGER_MARKETING: Record<string, EventMarketingRow> = {
  b0929: row('b0929', { adSpendUsdCents: 7774, messages: 54 }),
  b0922: row('b0922', { adSpendUsdCents: 4782, messages: 48 }),
  b0915: row('b0915', {
    adSpendUsdCents: 10582,
    messages: 132,
    usdArsRate: 1550,
    revenuePerGuestArsCents: 14_500_00,
    costPerGuestArsCents: 6_500_00,
  }),
  b0908: row('b0908', {
    adSpendUsdCents: 5341,
    messages: 56,
    usdArsRate: 1550,
    revenuePerGuestArsCents: 11_500_00,
    costPerGuestArsCents: 6_800_00,
  }),
  b0901: row('b0901', {
    adSpendUsdCents: 14225,
    messages: 86,
    usdArsRate: 1600,
    revenuePerGuestArsCents: 8_500_00,
    costPerGuestArsCents: 5_500_00,
    drinkRevenuePerGuestArsCents: 4_000_00,
    drinkCostPerGuestArsCents: 1_500_00,
  }),
}

/** Ratatuille: las dos noches, orgánicas (gasto 0) y con su cuenta. */
const RATA_EDITIONS: ConsolidatedEditionInput[] = [
  ed('r1019', '2026-10-19', { reservations: 19, guests: 44, billableGuests: 44 }),
  ed('r0922', '2026-09-22', {
    reservations: 19,
    guests: 52,
    billableGuests: 52,
    attendedGuests: 52,
  }),
  ed('r0914', '2026-09-14', {
    reservations: 12,
    guests: 54,
    billableGuests: 48,
    attendedGuests: 48,
  }),
]
const RATA_MARKETING: Record<string, EventMarketingRow> = {
  r0922: row('r0922', { revenuePerGuestArsCents: 25_000_00, costPerGuestArsCents: 7_200_00 }),
  r0914: row('r0914', { revenuePerGuestArsCents: 28_500_00, costPerGuestArsCents: 9_000_00 }),
}

function totals(over: Partial<MoneyTotals>): MoneyTotals {
  return {
    revenueArs: 0,
    costArs: 0,
    adSpendArs: 0,
    resultArs: 0,
    dates: 2,
    organicDates: 0,
    ...over,
  }
}

describe('largestRemainder', () => {
  it('reparte exacto y por resto mayor', () => {
    expect(largestRemainder([474_406, 1_019_700, 476_894], 1000)).toEqual([241, 517, 242])
    expect(largestRemainder([474_406, 1_019_700, 476_894], 100)).toEqual([24, 52, 24])
  })
  it('un cero nunca recibe nada, y sin nada no reparte', () => {
    expect(largestRemainder([0, 1, 2], 1000)).toEqual([0, 333, 667])
    expect(largestRemainder([0, 0, 0], 100)).toEqual([0, 0, 0])
  })
  it('empates: gana el que va antes (pauta, costo, resultado)', () => {
    expect(largestRemainder([1, 1, 1], 100)).toEqual([34, 33, 33])
  })
  it('siempre suma el total pedido', () => {
    const cases = [
      [1, 2, 3],
      [999_999, 1, 0],
      [33_333, 33_333, 33_334],
      [7, 13, 1_000_000],
    ]
    for (const c of cases) {
      expect(largestRemainder(c, 1000).reduce((a, b) => a + b, 0)).toBe(1000)
      expect(largestRemainder(c, 100).reduce((a, b) => a + b, 0)).toBe(100)
    }
  })
})

describe('Por evento — 2x1 Burger Martes (datos reales)', () => {
  const share = eventMoneyShare({ editions: BURGER_EDITIONS, marketing: BURGER_MARKETING })

  it('reparte el ingreso de las 3 fechas juzgadas, con la base nombrada', () => {
    expect(share?.state).toBe('reparto')
    expect(share?.title).toBe(MONEY_SHARE_TITLE)
    expect(share?.base).toBe('En las 3 fechas con la cuenta cerrada')
    expect(share?.center).toEqual({
      value: nb('$ 1.971.000'),
      label: 'de ingreso',
      tone: 'default',
    })
  })

  it('tres renglones en orden fijo, con % que suman 100,0 y los montos del total', () => {
    expect(share?.slices.map((s) => [s.label, s.share, s.amount])).toEqual([
      ['Pauta', nb('24,1 %'), nb('$ 474.406')],
      ['Costo', nb('51,7 %'), nb('$ 1.019.700')],
      ['Resultado', nb('24,2 %'), nb('$ 476.894')],
    ])
    expect(share?.slices.map((s) => s.arc)).toEqual([474_406, 1_019_700, 476_894])
  })

  it('la oración dice lo mismo en pesos de cada $ 100', () => {
    expect(share?.sentence).toBe(
      nb('De cada $ 100 que entraron, $ 24 se fueron en pauta, $ 52 en costo y quedaron $ 24.'),
    )
  })

  // Lo que oye el lector (el centro, la leyenda y la oración) se prueba sobre el
  // HTML en money-share-donut-render.test.tsx.
  it('lleva el disclaimer (T3)', () => {
    expect(share?.disclaimer).toBe(NIGHT_RESULT_DISCLAIMER)
  })

  it('los montos son los de la fila de total del cuadro «Rentabilidad» (pantalla = planilla)', () => {
    const t = eventMoneyTotals({ editions: BURGER_EDITIONS, marketing: BURGER_MARKETING })
    const csv = buildEventConsolidated({
      templateName: '2x1 Burger Martes',
      editions: BURGER_EDITIONS,
      marketing: BURGER_MARKETING,
    })?.total?.csv.cells
    expect(String(t?.revenueArs)).toBe(csv?.['Ingreso ARS'])
    expect(String(t?.costArs)).toBe(csv?.['Costo ARS'])
    expect(String(t?.adSpendArs)).toBe(csv?.['Pauta ARS'])
    expect(String(t?.resultArs)).toBe(csv?.['Resultado ARS'])
    // Cierra justo: ingreso = costo + pauta + resultado.
    expect((t?.costArs ?? 0) + (t?.adSpendArs ?? 0) + (t?.resultArs ?? 0)).toBe(t?.revenueArs)
  })
})

describe('Por evento — noches sin pauta (Ratatuille)', () => {
  const share = eventMoneyShare({ editions: RATA_EDITIONS, marketing: RATA_MARKETING })

  it('la pauta no desaparece: dice «sin pauta» y 0 %, sin arco', () => {
    expect(share?.base).toBe('En las 2 fechas con la cuenta cerrada (todas sin pauta)')
    expect(share?.slices[0]).toMatchObject({
      label: 'Pauta',
      arc: 0,
      share: nb('0 %'),
      amount: 'sin pauta',
      tone: 'muted',
    })
    expect(share?.slices.slice(1).map((s) => [s.share, s.amount])).toEqual([
      [nb('30,2 %'), nb('$ 806.400')],
      [nb('69,8 %'), nb('$ 1.861.600')],
    ])
    expect(share?.sentence).toBe(
      nb('De cada $ 100 que entraron, $ 30 se fueron en costo y quedaron $ 70: no hubo pauta.'),
    )
  })

  it('base con algunas sin pauta y con una sola', () => {
    expect(eventMoneyShareBase({ dates: 4, organicDates: 1 })).toBe(
      'En las 4 fechas con la cuenta cerrada (1 sin pauta)',
    )
    expect(eventMoneyShareBase({ dates: 1, organicDates: 0 })).toBe(
      'En la única fecha con la cuenta cerrada',
    )
    expect(eventMoneyShareBase({ dates: 1, organicDates: 1 })).toBe(
      'En la única fecha con la cuenta cerrada (sin pauta)',
    )
  })
})

describe('quedó abajo: el aro va vacío y se dice en palabras', () => {
  // Solo el 01/09 con la cuenta cerrada: la cuenta de esa fecha sola.
  const only0901 = eventMoneyShare({
    editions: BURGER_EDITIONS,
    marketing: { b0901: BURGER_MARKETING.b0901 as EventMarketingRow },
  })

  it('una sola fecha, en negativo: sin porciones, centro en ámbar con lo que faltó', () => {
    expect(only0901?.state).toBe('abajo')
    expect(only0901?.base).toBe('En la única fecha con la cuenta cerrada')
    expect(only0901?.center).toEqual({ value: nb('$ 73.600'), label: 'abajo', tone: 'warning' })
    expect(only0901?.slices.every((s) => s.arc === 0)).toBe(true)
  })

  it('la leyenda conserva los tres renglones; el % es del ingreso y ya no suma 100', () => {
    expect(only0901?.slices.map((s) => [s.label, s.share, s.amount, s.tone])).toEqual([
      ['Pauta', nb('65,0 %'), nb('$ 227.600'), 'default'],
      ['Costo', nb('56,0 %'), nb('$ 196.000'), 'default'],
      ['Resultado', '—', nb('$ 73.600 abajo'), 'warning'],
    ])
  })

  it('la oración no tiene un «-$» ni un número negativo', () => {
    expect(only0901?.sentence).toBe(
      nb(
        'La pauta y el costo ($ 423.600) se llevaron más que todo el ingreso ($ 350.000): faltaron $ 73.600.',
      ),
    )
    expect(JSON.stringify(only0901)).not.toMatch(/-\$|\$\u00A0-/)
  })

  it('sin pauta, quien se llevó el ingreso es el costo', () => {
    const s = buildMoneyShare(
      totals({ revenueArs: 238_000, costArs: 300_000, adSpendArs: 0, resultArs: -62_000 }),
      { base: 'x' },
    )
    expect(s.sentence).toBe(
      nb('El costo ($ 300.000) se llevó más que todo el ingreso ($ 238.000): faltaron $ 62.000.'),
    )
    expect(s.slices[0].amount).toBe('sin pauta')
  })
})

describe('bordes del reparto', () => {
  it('resultado en cero: dos porciones, el resultado en «$ 0» gris', () => {
    const s = buildMoneyShare(
      totals({ revenueArs: 100_000, costArs: 60_000, adSpendArs: 40_000, resultArs: 0 }),
      { base: 'x' },
    )
    expect(s.state).toBe('reparto')
    expect(s.slices.map((x) => [x.share, x.amount, x.arc])).toEqual([
      [nb('40,0 %'), nb('$ 40.000'), 40_000],
      [nb('60,0 %'), nb('$ 60.000'), 60_000],
      [nb('0 %'), nb('$ 0'), 0],
    ])
    expect(s.slices[2].tone).toBe('muted')
    expect(s.sentence).toBe(
      nb('De cada $ 100 que entraron, $ 40 se fueron en pauta y $ 60 en costo: no quedó nada.'),
    )
  })

  it('una pauta chiquita no es «0 %»: es «menos de 0,1 %» y «menos de $ 1»', () => {
    const s = buildMoneyShare(
      totals({ revenueArs: 1_000_000, costArs: 600_000, adSpendArs: 400, resultArs: 399_600 }),
      { base: 'x' },
    )
    expect(s.slices[0].share).toBe(nb('menos de 0,1 %'))
    expect(s.sentence).toBe(
      nb(
        'De cada $ 100 que entraron, menos de $ 1 se fue en pauta, $ 60 en costo y quedaron $ 40.',
      ),
    )
  })

  it('el singular concuerda', () => {
    const s = buildMoneyShare(
      totals({ revenueArs: 100, costArs: 75, adSpendArs: 1, resultArs: 24 }),
      { base: 'x' },
    )
    expect(s.sentence).toBe(
      nb('De cada $ 100 que entraron, $ 1 se fue en pauta, $ 75 en costo y quedaron $ 24.'),
    )
  })

  it('los porcentajes del reparto siempre suman 100,0', () => {
    const cases: Array<[number, number, number]> = [
      [474_406, 1_019_700, 476_894],
      [1, 1, 1],
      [12_345, 67_890, 1_234],
      [0, 806_400, 1_861_600],
    ]
    for (const [a, c, r] of cases) {
      const s = buildMoneyShare(
        totals({ revenueArs: a + c + r, costArs: c, adSpendArs: a, resultArs: r }),
        { base: 'x' },
      )
      const sum = s.slices
        .map((x) => x.share.replace('\u00A0%', '').replace(',', '.'))
        .map(Number)
        .reduce((p, q) => p + q, 0)
      expect(Math.round(sum * 10)).toBe(1000)
    }
  })
})

describe('donutArcs: dónde va cada porción del aro', () => {
  it('2x1: las tres en orden, una detrás de la otra desde las 12, y cierran la vuelta', () => {
    const share = eventMoneyShare({ editions: BURGER_EDITIONS, marketing: BURGER_MARKETING })
    const arcs = donutArcs(share?.slices ?? [])
    const total = 474_406 + 1_019_700 + 476_894
    expect(arcs.map((a) => a.key)).toEqual(['pauta', 'costo', 'resultado'])
    expect(arcs[0]).toEqual({ key: 'pauta', start: 0, size: 474_406 / total })
    expect(arcs[1]?.start).toBeCloseTo(474_406 / total, 12)
    expect(arcs[2]?.start).toBeCloseTo((474_406 + 1_019_700) / total, 12)
    expect((arcs[2]?.start ?? 0) + (arcs[2]?.size ?? 0)).toBeCloseTo(1, 12)
  })

  it('sin pauta: la pauta no tiene arco y el costo arranca a las 12', () => {
    const s = buildMoneyShare(
      totals({ revenueArs: 100, costArs: 30, adSpendArs: 0, resultArs: 70 }),
      { base: 'x' },
    )
    expect(donutArcs(s.slices)).toEqual([
      { key: 'costo', start: 0, size: 0.3 },
      { key: 'resultado', start: 0.3, size: 0.7 },
    ])
  })

  it('una sola porción: el aro entero', () => {
    const s = buildMoneyShare(
      totals({ revenueArs: 100, costArs: 100, adSpendArs: 0, resultArs: 0 }),
      { base: 'x' },
    )
    expect(donutArcs(s.slices)).toEqual([{ key: 'costo', start: 0, size: 1 }])
  })

  it('la cuenta abajo o todo en cero: ninguna porción, el aro vacío (T2)', () => {
    const abajo = buildMoneyShare(
      totals({ revenueArs: 350_000, costArs: 196_000, adSpendArs: 227_600, resultArs: -73_600 }),
      { base: 'x' },
    )
    expect(donutArcs(abajo.slices)).toEqual([])
    expect(donutArcs(buildMoneyShare(totals({}), { base: 'x' }).slices)).toEqual([])
  })
})

describe('sin la cuenta cerrada no hay dona', () => {
  it('ninguna fecha juzgada → null', () => {
    expect(
      eventMoneyShare({
        editions: BURGER_EDITIONS,
        marketing: { b0922: BURGER_MARKETING.b0922 as EventMarketingRow },
      }),
    ).toBeNull()
    expect(eventMoneyShare({ editions: BURGER_EDITIONS, marketing: {} })).toBeNull()
  })

  it('lo que todavía no pasó no entra, aunque tenga plata cargada', () => {
    const t = eventMoneyTotals({
      editions: [
        ...BURGER_EDITIONS,
        ed('b1003', '2026-10-03', { reservations: 3, guests: 9, billableGuests: 9 }),
      ],
      marketing: {
        ...BURGER_MARKETING,
        b1003: row('b1003', { revenuePerGuestArsCents: 10_000_00, costPerGuestArsCents: 5_000_00 }),
      },
    })
    expect(t?.dates).toBe(3)
  })
})

describe('Pestaña «Pauta» — la dona del mes', () => {
  const edition = (key: string, date: string, people: number) => ({
    key,
    eventId: key,
    date,
    title: key === 'rata' ? 'Ratatuille' : 'Ramen',
    colorHex: null,
    reservations: Math.ceil(people / 2),
    guests: people,
    billableGuests: people,
    attendedGuests: people,
    startsAtLocal: '21:00:00',
  })
  const report = buildMonthMarketingReport({
    ym: '2026-09',
    today: HOY,
    truncated: false,
    editions: [
      edition('a', '2026-09-07', 57),
      edition('b', '2026-09-28', 46),
      edition('rata', '2026-09-14', 48),
    ],
    marketing: {
      a: row('a', {
        adSpendUsdCents: 15135,
        messages: 68,
        usdArsRate: 1600,
        revenuePerGuestArsCents: 27_000_00,
        costPerGuestArsCents: 7_200_00,
        drinkRevenuePerGuestArsCents: 6_000_00,
        drinkCostPerGuestArsCents: 2_000_00,
      }),
      b: row('b', {
        adSpendUsdCents: 16216,
        messages: 49,
        usdArsRate: 1600,
        revenuePerGuestArsCents: 27_000_00,
        costPerGuestArsCents: 7_200_00,
      }),
      rata: row('rata', { revenuePerGuestArsCents: 28_500_00, costPerGuestArsCents: 9_000_00 }),
    },
  })
  const share = monthMoneyShare(report)

  it('es la cuenta del mes (fechas CON pauta) con su base, y nombra las noches sin pauta', () => {
    expect(share?.base).toBe('En 2 de 2 fechas con ingreso y costo cargados (1 con bebida)')
    expect(share?.notes).toEqual([MONEY_SHARE_ORGANIC_NOTE])
  })

  it('los montos son los mismos que la línea de la cuenta del mes', () => {
    for (const s of share?.slices ?? []) {
      expect(report.result?.math).toContain(s.amount)
    }
    expect(report.result?.math).toContain(share?.center.value)
  })

  it('un mes sin la cuenta cerrada no tiene dona', () => {
    const empty = buildMonthMarketingReport({
      ym: '2026-09',
      today: HOY,
      truncated: false,
      editions: [edition('a', '2026-09-07', 57)],
      marketing: { a: row('a', { adSpendUsdCents: 15135, messages: 68 }) },
    })
    expect(monthMoneyShare(empty)).toBeNull()
  })
})
