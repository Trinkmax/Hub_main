import { describe, expect, it } from 'vitest'
import {
  buildEventConsolidated,
  CONSOLIDATED_BASIS_NOTE,
  CONSOLIDATED_CASH_NOTE,
  CONSOLIDATED_NO_DRINKS_NOTE,
  type ConsolidatedEditionInput,
  editionVerdict,
  editionVerdictCsv,
  eventProfitabilityToCsv,
  missingShort,
  PROFITABILITY_EXPORT_HEADERS,
} from '@/lib/salon/event-consolidated'
import {
  type EventMarketingRow,
  NIGHT_RESULT_DISCLAIMER,
  nightResultReason,
  nightResultReport,
} from '@/lib/salon/event-marketing'

const HOY = '2026-09-30'

function nb(text: string): string {
  return text.replace(/\$ /g, '$ ').replace(/US\$ /g, 'US$ ')
}

/** La fila de total de la planilla cierra: Ingreso − Costo = Margen y Margen − Pauta = Resultado. */
function expectCsvTotalCloses(cells: Readonly<Record<string, string>> | undefined) {
  const n = (k: string) => {
    const v = cells?.[k]
    // Un entero de verdad: con la celda vacía, NaN − NaN «daría» NaN y pasaría.
    expect(v, k).toMatch(/^-?\d+$/)
    return Number(v)
  }
  expect(n('Ingreso ARS') - n('Costo ARS')).toBe(n('Margen ARS'))
  expect(n('Margen ARS') - n('Pauta ARS')).toBe(n('Resultado ARS'))
}

function row(over: Partial<EventMarketingRow> = {}): EventMarketingRow {
  return {
    scheduledEventId: 'x',
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
    updatedAt: '2026-09-24T15:30:00Z',
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

// ─── El 2x1 Burger Martes real, al 30/09/2026 ────────────────────────────────
const BURGER_EDITIONS = [
  ed('b27-10', '2026-10-27'),
  ed('b20-10', '2026-10-20'),
  ed('b13-10', '2026-10-13'),
  ed('b06-10', '2026-10-06', { reservations: 1, guests: 10, billableGuests: 10 }),
  ed('b29-09', '2026-09-29', {
    reservations: 6,
    guests: 15,
    billableGuests: 15,
    attendedGuests: 15,
  }),
  ed('b22-09', '2026-09-22', {
    reservations: 10,
    guests: 26,
    billableGuests: 25,
    attendedGuests: 25,
  }),
  ed('b15-09', '2026-09-15', {
    reservations: 23,
    guests: 62,
    billableGuests: 65,
    attendedGuests: 65,
  }),
  ed('b08-09', '2026-09-08', {
    reservations: 14,
    guests: 56,
    billableGuests: 59,
    attendedGuests: 51,
  }),
  ed('b01-09', '2026-09-01', {
    reservations: 10,
    guests: 28,
    billableGuests: 28,
    attendedGuests: 28,
  }),
]
const B15 = row({
  adSpendUsdCents: 10582,
  messages: 132,
  usdArsRate: 1550,
  revenuePerGuestArsCents: 14_500_00,
  costPerGuestArsCents: 6_500_00,
})
const BURGER_MARKETING: Record<string, EventMarketingRow> = {
  'b22-09': row({ adSpendUsdCents: 4782, messages: 48 }),
  'b15-09': B15,
  'b08-09': row({
    adSpendUsdCents: 5341,
    messages: 56,
    usdArsRate: 1550,
    revenuePerGuestArsCents: 11_500_00,
    costPerGuestArsCents: 6_800_00,
  }),
  'b01-09': row({
    adSpendUsdCents: 14225,
    messages: 86,
    usdArsRate: 1550,
    revenuePerGuestArsCents: 8_500_00,
    costPerGuestArsCents: 5_500_00,
  }),
}
const burger = () =>
  buildEventConsolidated({
    templateName: '2x1 Burger Martes',
    editions: BURGER_EDITIONS,
    marketing: BURGER_MARKETING,
  })

describe('consolidado: el 2x1 Burger Martes real', () => {
  const c = burger()
  if (c === null) throw new Error('tiene que haber consolidado')

  it('una fila por fecha que ya pasó, de la más nueva a la más vieja, con su veredicto', () => {
    expect(c.rows.map((r) => [r.dayMonth, r.verdict])).toEqual([
      ['29/09', 'sin-juzgar'],
      ['22/09', 'sin-juzgar'],
      ['15/09', 'dejo'],
      ['08/09', 'dejo'],
      ['01/09', 'abajo'],
    ])
    expect(c.rows.map((r) => [r.result.text, r.result.suffix, r.result.mark])).toEqual([
      ['sin cargar', null, null],
      ['faltan ingreso, costo y dólar', null, null],
      [nb('$ 355.979'), null, 'dejo'],
      [nb('$ 194.515'), null, 'dejo'],
      [nb('$ 136.488'), 'abajo', 'abajo'],
    ])
    expect(c.rows.map((r) => r.result.sr)).toEqual([
      'Sin juzgar: faltan la pauta, el ingreso y el costo por persona.',
      'Sin juzgar: faltan el ingreso y el costo por persona, y el dólar del día.',
      nb('La noche dejó $ 355.979.'),
      nb('La noche dejó $ 194.515.'),
      nb('La noche quedó $ 136.488 abajo.'),
    ])
    expect(c.rows[4]?.result.tone).toBe('warning')
  })

  it('el titular cuenta solo las juzgadas y nombra las que no', () => {
    expect(c.headline).toEqual({
      before: 'Dejó plata en ',
      value: '2 de 3',
      after: ' fechas con la cuenta cerrada.',
    })
    expect(c.unjudgedNote).toBe('2 fechas sin juzgar.')
    expect(c.counts).toEqual({ rows: 5, judged: 3, positive: 2, negative: 1, even: 0, unjudged: 2 })
  })

  it('las celdas dicen lo cargado; Pers es la gente de la cuenta', () => {
    const [d29, d22, d15] = c.rows
    expect(d15?.cells).toEqual({
      guests: { text: '65', tone: 'default', srText: null },
      spend: { text: nb('US$ 105,82'), tone: 'default', srText: null },
      perGuest: { text: nb('$ 14.500'), tone: 'default', srText: null },
      drinkPerGuest: { text: '—', tone: 'muted', srText: 'bebida sin cargar' },
    })
    expect(d29?.cells.spend).toEqual({ text: '—', tone: 'muted', srText: 'pauta sin cargar' })
    expect(d29?.cells.perGuest).toEqual({ text: '—', tone: 'muted', srText: 'sin cargar' })
    expect(d22?.cells.perGuest).toEqual({
      text: '—',
      tone: 'muted',
      srText: 'ingreso por persona sin cargar',
    })
    expect(c.rows.map((r) => r.cardLine)).toEqual([
      '15 personas · pauta sin cargar',
      nb('25 personas · pauta US$ 47,82'),
      nb('65 personas · pauta US$ 105,82 · $ 14.500 por persona · bebida sin cargar'),
      nb('59 personas · pauta US$ 53,41 · $ 11.500 por persona · bebida sin cargar'),
      nb('28 personas · pauta US$ 142,25 · $ 8.500 por persona · bebida sin cargar'),
    ])
    expect(c.rows.map((r) => r.reasonText)).toEqual([
      'Para juzgarla faltan la pauta, el ingreso y el costo por persona.',
      'Para juzgarla faltan el ingreso y el costo por persona, y el dólar del día.',
      null,
      null,
      null,
    ])
  })

  it('el desglose es la cuenta de la ficha, tal cual', () => {
    const d01 = c.rows[4]
    const ficha = nightResultReport(
      BURGER_EDITIONS[8] as ConsolidatedEditionInput,
      BURGER_MARKETING['b01-09'] as EventMarketingRow,
    )
    expect(d01?.detail.steps).toEqual(ficha?.steps)
    expect(d01?.detail.result).toEqual(ficha?.result)
    expect(d01?.detail.steps.map((s) => `${s.before}${s.value}${s.after}`).join(' · ')).toBe(
      nb('28 personas × $ 8.500 = $ 238.000 · costo $ 154.000 · margen $ 84.000 · pauta $ 220.488'),
    )
    expect(d01?.detail.lines).toEqual([
      nb('Cada persona dejó $ 3.000 y para cubrir la pauta hacían falta 74 personas.'),
      nb('Después de la pauta, cada persona quedó $ 4.875 abajo.'),
    ])
    expect(d01?.detail.howToFix).toBeNull()
    expect(c.rows[1]?.detail).toEqual({
      steps: [],
      result: null,
      lines: [],
      howToFix: 'Se carga desde la ficha de esa noche.',
    })
    // Cada monto juzgado es el titular de su ficha: no hay aritmética propia.
    for (const [i, key] of [
      [2, 'b15-09'],
      [3, 'b08-09'],
      [4, 'b01-09'],
    ] as const) {
      const e = BURGER_EDITIONS.find((x) => x.key === key) as ConsolidatedEditionInput
      const headline = nightResultReport(e, BURGER_MARKETING[key] as EventMarketingRow)?.headline
      expect(headline).toContain(c.rows[i]?.result.text)
    }
  })

  it('las barras comparten un eje: la mejor y la peor de un vistazo', () => {
    expect(c.axis).toBeCloseTo(136_487.5 / 492_466.5, 6)
    expect(c.rows[2]?.bar?.tone).toBe('positive')
    expect(c.rows[2]?.bar?.width).toBeCloseTo(355_979 / 492_466.5, 6)
    expect(c.rows[4]?.bar).toEqual({ left: 0, width: 136_487.5 / 492_466.5, tone: 'negative' })
    expect(c.rows[0]?.bar).toBeNull()
  })

  it('el total: sumas y cocientes de sumas sobre las 3 juzgadas', () => {
    const t = c.total
    expect(t?.base).toBe('3 fechas')
    expect(t?.srLabel).toBe('Total de las 3 fechas con la cuenta cerrada')
    expect(t?.cells.guests.text).toBe('152')
    expect(t?.cells.spend.text).toBe(nb('US$ 301,48'))
    expect(t?.cells.perGuest.text).toBe(nb('$ 12.230'))
    // El lector oye el `srText` EN LUGAR del monto: tiene que traerlo.
    expect(t?.cells.perGuest.srText).toBe(
      nb('$ 12.230, promedio de las 3 fechas, sobre 152 personas'),
    )
    expect(t?.cells.drinkPerGuest).toEqual({
      text: '—',
      tone: 'muted',
      srText: 'ninguna fecha tiene la bebida cargada',
    })
    expect(t?.result).toEqual({
      text: nb('$ 414.006'),
      suffix: null,
      tone: 'default',
      mark: null,
      sr: nb('En total dejó $ 414.006.'),
    })
    expect(t?.perPersonText).toBe(nb('$ 2.724 por persona'))
    expect(t?.sentence).toBe(
      nb('En total dejó $ 414.006 en las 3 fechas con la cuenta cerrada ($ 2.724 por persona).'),
    )
    expect(t?.cardLine).toBe(nb('152 personas · pauta US$ 301,48 · $ 12.230 por persona'))
    expect(t?.csv).toEqual({
      label: 'Total con la cuenta cerrada (3 fechas)',
      verdict: '2 de 3',
      cells: {
        'Personas de la cuenta': '152',
        'Ingreso por persona ARS': '12230',
        'Ingreso de bebida por persona ARS': '',
        'Ingreso ARS': '1859000',
        'Costo ARS': '977700',
        'Margen ARS': '881300',
        'Pauta USD': '301,48',
        'Pauta ARS': '467294',
        'Resultado ARS': '414006',
      },
    })
    // La fila de la planilla cierra: ingreso − costo − pauta = resultado.
    expectCsvTotalCloses(t?.csv.cells)
  })

  it('la fila de total cierra también cuando los medios pesos no se compensan', () => {
    // El 01/09 sin el dólar queda sin juzgar. Quedan el 15/09 y el 08/09: pauta
    // 164.021 + 82.785,5 = 246.806,5 y resultado 550.493,5, que se lee $ 550.494.
    // Redondeadas por separado daban 246.807 y 550.494: un peso de más.
    const c = buildEventConsolidated({
      templateName: '2x1 Burger Martes',
      editions: BURGER_EDITIONS,
      marketing: {
        ...BURGER_MARKETING,
        'b01-09': { ...(BURGER_MARKETING['b01-09'] as EventMarketingRow), usdArsRate: null },
      },
    })
    expect(c?.rows[4]?.result.text).toBe('falta el dólar')
    expect(c?.total?.result.text).toBe(nb('$ 550.494'))
    expect(c?.total?.csv.cells).toMatchObject({
      'Ingreso ARS': '1621000',
      'Costo ARS': '823700',
      'Margen ARS': '797300',
      'Pauta ARS': '246806',
      'Resultado ARS': '550494',
    })
    expectCsvTotalCloses(c?.total?.csv.cells)
  })

  it('notas al pie, en orden y solo las que aplican', () => {
    expect(c.notes).toEqual([
      'Las 4 fechas que vienen se juzgan cuando pasen.',
      CONSOLIDATED_BASIS_NOTE,
      CONSOLIDATED_NO_DRINKS_NOTE,
      NIGHT_RESULT_DISCLAIMER,
    ])
    expect(c.caption).toBe(
      'Rentabilidad de 2x1 Burger Martes: la cuenta de cada fecha que ya pasó, de la más nueva a la más vieja.',
    )
  })

  it('nunca un «-$»', () => {
    expect(JSON.stringify(c)).not.toMatch(/-\$|−\$/)
  })
})

describe('consolidado: la bebida (D3)', () => {
  const with15 = (over: Partial<EventMarketingRow>) =>
    buildEventConsolidated({
      templateName: '2x1 Burger Martes',
      editions: BURGER_EDITIONS,
      marketing: { ...BURGER_MARKETING, 'b15-09': { ...B15, ...over } },
    })

  it('bebida aparte: suma en ingreso y en costo, y la celda la muestra', () => {
    const c = with15({
      drinkRevenuePerGuestArsCents: 6_000_00,
      drinkCostPerGuestArsCents: 2_500_00,
    })
    const d15 = c?.rows[2]
    expect(d15?.result.text).toBe(nb('$ 583.479'))
    expect(d15?.cells.drinkPerGuest).toEqual({ text: nb('$ 6.000'), tone: 'default', srText: null })
    expect(d15?.cardLine).toBe(
      nb('65 personas · pauta US$ 105,82 · $ 14.500 por persona · bebida $ 6.000'),
    )
    // Una con bebida y dos sin: la nota nombra las que van sin.
    expect(c?.notes).toContain(
      'Sin la bebida cargada: 08/09 · 01/09. Ahí el resultado sale solo del ingreso y el costo por persona.',
    )
    expect(c?.total?.cells.drinkPerGuest.srText).toBe(
      'sin promedio: no todas las fechas tienen la bebida cargada',
    )
    expect(c?.total?.result.text).toBe(nb('$ 641.506'))
  })

  it('0 es la bebida incluida', () => {
    const c = with15({ drinkRevenuePerGuestArsCents: 0, drinkCostPerGuestArsCents: 2_500_00 })
    expect(c?.rows[2]?.cells.drinkPerGuest).toEqual({
      text: 'incluida',
      tone: 'default',
      srText: 'bebida incluida',
    })
    expect(c?.rows[2]?.cardLine).toContain('bebida incluida')
    // 65 × (14.500 − 6.500 − 2.500) − 164.021
    expect(c?.rows[2]?.result.text).toBe(nb('$ 193.479'))
  })

  it('media bebida no se juzga, y dice qué falta', () => {
    const c = with15({ drinkCostPerGuestArsCents: 2_500_00 })
    const d15 = c?.rows[2]
    expect(d15?.verdict).toBe('sin-juzgar')
    expect(d15?.result.text).toBe('falta el ingreso de bebida')
    expect(d15?.result.sr).toBe('Sin juzgar: falta el ingreso de bebida por persona.')
    expect(d15?.cells.drinkPerGuest.srText).toBe('ingreso de bebida sin cargar')
    expect(c?.headline.value).toBe('1 de 2')
  })

  it('todas con la bebida cargada: el total la promedia; todas incluida dice «incluida»', () => {
    const drinks = (dr: number, dc: number) => ({
      drinkRevenuePerGuestArsCents: dr,
      drinkCostPerGuestArsCents: dc,
    })
    const c = buildEventConsolidated({
      templateName: '2x1 Burger Martes',
      editions: BURGER_EDITIONS,
      marketing: {
        ...BURGER_MARKETING,
        'b15-09': { ...B15, ...drinks(6_000_00, 2_500_00) },
        'b08-09': { ...(BURGER_MARKETING['b08-09'] as EventMarketingRow), ...drinks(0, 2_000_00) },
        'b01-09': {
          ...(BURGER_MARKETING['b01-09'] as EventMarketingRow),
          ...drinks(3_000_00, 1_000_00),
        },
      },
    })
    // (65 × 6.000 + 59 × 0 + 28 × 3.000) / 152 = 474.000 / 152 = 3.118,4
    expect(c?.total?.cells.drinkPerGuest.text).toBe(nb('$ 3.118'))
    expect(c?.total?.cells.drinkPerGuest.srText).toBe(
      nb('$ 3.118, promedio de las 3 fechas, sobre 152 personas'),
    )
    expect(c?.total?.csv.cells['Ingreso de bebida por persona ARS']).toBe('3118')
    expect(c?.notes).not.toContain(CONSOLIDATED_NO_DRINKS_NOTE)

    const incluida = buildEventConsolidated({
      templateName: '2x1 Burger Martes',
      editions: BURGER_EDITIONS,
      marketing: {
        ...BURGER_MARKETING,
        'b15-09': { ...B15, ...drinks(0, 2_500_00) },
        'b08-09': { ...(BURGER_MARKETING['b08-09'] as EventMarketingRow), ...drinks(0, 2_000_00) },
        'b01-09': { ...(BURGER_MARKETING['b01-09'] as EventMarketingRow), ...drinks(0, 1_000_00) },
      },
    })
    expect(incluida?.total?.cells.drinkPerGuest.text).toBe('incluida')
    expect(incluida?.total?.cells.drinkPerGuest.srText).toBe('bebida incluida en las 3 fechas')
    expect(incluida?.total?.csv.cells['Ingreso de bebida por persona ARS']).toBe('0')
  })

  it('con la bebida en una fecha sin juzgar, la nota no dice «en ninguna fecha»', () => {
    const sinNinguna = (notes: readonly string[] | undefined) =>
      expect(notes).not.toContain(CONSOLIDATED_NO_DRINKS_NOTE)

    // Paso 6 del smoke: el 15/09 con la bebida y el costo de bebida borrado.
    const paso6 = with15({ drinkRevenuePerGuestArsCents: 6_000_00 })
    expect(paso6?.rows[2]?.result.text).toBe('falta el costo de bebida')
    expect(paso6?.rows[2]?.cells.drinkPerGuest.text).toBe(nb('$ 6.000'))
    sinNinguna(paso6?.notes)
    expect(paso6?.notes).toContain(
      'Sin la bebida cargada: 08/09 · 01/09. Ahí el resultado sale solo del ingreso y el costo por persona.',
    )

    // El 22/09 con toda la plata y la bebida, pero sin el dólar.
    const sinDolar = buildEventConsolidated({
      templateName: '2x1 Burger Martes',
      editions: BURGER_EDITIONS,
      marketing: {
        ...BURGER_MARKETING,
        'b22-09': row({
          adSpendUsdCents: 4782,
          messages: 48,
          revenuePerGuestArsCents: 14_500_00,
          costPerGuestArsCents: 6_500_00,
          drinkRevenuePerGuestArsCents: 6_000_00,
          drinkCostPerGuestArsCents: 2_500_00,
        }),
      },
    })
    expect(sinDolar?.rows[1]?.result.text).toBe('falta el dólar')
    expect(sinDolar?.rows[1]?.cells.drinkPerGuest.text).toBe(nb('$ 6.000'))
    sinNinguna(sinDolar?.notes)
    expect(sinDolar?.notes).toContain(
      'Sin la bebida cargada: 15/09 · 08/09 · 01/09. Ahí el resultado sale solo del ingreso y el costo por persona.',
    )

    // Media bebida (solo el costo): su fila dice que falta el ingreso de bebida.
    sinNinguna(with15({ drinkCostPerGuestArsCents: 2_500_00 })?.notes)
  })

  it('manda la caja: «caja» en los dos ingresos, y sin promedio en el total', () => {
    const c = with15({ revenueArsCents: 1_200_000_00 })
    const d15 = c?.rows[2]
    expect(d15?.cells.perGuest).toEqual({
      text: 'caja',
      tone: 'muted',
      srText: 'el ingreso es la facturación real de la caja',
    })
    expect(d15?.cells.drinkPerGuest.text).toBe('caja')
    // 1.200.000 − 65 × 6.500 − 164.021
    expect(d15?.result.text).toBe(nb('$ 613.479'))
    expect(d15?.cardLine).toBe(
      nb('65 personas · pauta US$ 105,82 · ingreso de la caja $ 1.200.000'),
    )
    expect(c?.total?.cells.perGuest).toEqual({
      text: '—',
      tone: 'muted',
      srText: 'sin promedio: en alguna fecha manda la facturación de la caja',
    })
    expect(c?.total?.csv.cells['Ingreso por persona ARS']).toBe('')
    expect(c?.notes).toContain(CONSOLIDATED_CASH_NOTE)
    // La caja ya trae la bebida: esa fecha no entra en la nota de «sin la bebida».
    expect(c?.notes).toContain(
      'Sin la bebida cargada: 08/09 · 01/09. Ahí el resultado sale solo del ingreso y el costo por persona.',
    )
  })
})

describe('consolidado: otros eventos reales', () => {
  it('Ratatuille, dos noches sin pauta: se juzgan y suman', () => {
    const c = buildEventConsolidated({
      templateName: 'Ratatuille',
      editions: [
        ed('r19-10', '2026-10-19'),
        ed('r05-10', '2026-10-05', { reservations: 24, guests: 54, billableGuests: 54 }),
        ed('r22-09', '2026-09-22', {
          reservations: 19,
          guests: 52,
          billableGuests: 52,
          attendedGuests: 52,
        }),
        ed('r14-09', '2026-09-14', {
          reservations: 12,
          guests: 54,
          billableGuests: 48,
          attendedGuests: 48,
        }),
      ],
      marketing: {
        'r22-09': row({ revenuePerGuestArsCents: 25_000_00, costPerGuestArsCents: 7_200_00 }),
        'r14-09': row({ revenuePerGuestArsCents: 28_500_00, costPerGuestArsCents: 9_000_00 }),
      },
    })
    expect(c?.rows.map((r) => [r.dayMonth, r.cells.spend.text, r.result.text])).toEqual([
      ['22/09', 'sin pauta', nb('$ 925.600')],
      ['14/09', 'sin pauta', nb('$ 936.000')],
    ])
    expect(c?.headline).toEqual({
      before: 'Dejó plata en ',
      value: 'las 2',
      after: ' fechas con la cuenta cerrada.',
    })
    expect(c?.unjudgedNote).toBeNull()
    expect(c?.total?.cells.spend.text).toBe('sin pauta')
    expect(c?.total?.cells.perGuest.text).toBe(nb('$ 26.680'))
    expect(c?.total?.sentence).toBe(
      nb('En total dejó $ 1.861.600 en las 2 fechas con la cuenta cerrada ($ 18.616 por persona).'),
    )
    expect(c?.total?.csv.cells['Pauta USD']).toBe('0,00')
    expect(c?.axis).toBe(0)
    expect(c?.notes).toEqual([
      'Las 2 fechas que vienen se juzgan cuando pasen.',
      CONSOLIDATED_BASIS_NOTE,
      CONSOLIDATED_NO_DRINKS_NOTE,
      NIGHT_RESULT_DISCLAIMER,
    ])
  })

  it('Noche Astral: el total se redondea UNA vez', () => {
    const c = buildEventConsolidated({
      templateName: 'Noche Astral',
      editions: [
        ed('a07-10', '2026-10-07', { reservations: 1, guests: 2, billableGuests: 2 }),
        ed('a23-09', '2026-09-23', {
          reservations: 22,
          guests: 44,
          billableGuests: 44,
          attendedGuests: 42,
        }),
        ed('a09-09', '2026-09-09', {
          reservations: 11,
          guests: 29,
          billableGuests: 27,
          attendedGuests: 27,
        }),
        ed('a26-08', '2026-08-26', { reservations: 1, guests: 2, billableGuests: 2 }),
        ed('a05-08', '2026-08-05'),
      ],
      marketing: {
        'a23-09': row({
          adSpendUsdCents: 33900,
          messages: 89,
          usdArsRate: 1600,
          revenuePerGuestArsCents: 40_000_00,
          costPerGuestArsCents: 18_700_00,
        }),
        'a09-09': row({
          adSpendUsdCents: 17527,
          messages: 51,
          usdArsRate: 1550,
          revenuePerGuestArsCents: 40_000_00,
          costPerGuestArsCents: 21_000_00,
        }),
      },
    })
    expect(c?.rows.map((r) => r.result.text)).toEqual([nb('$ 394.800'), nb('$ 241.332')])
    // 394.800 + 241.331,5 = 636.131,5 → $ 636.132, no 394.800 + 241.332 sumados ya redondeados.
    expect(c?.total?.result.text).toBe(nb('$ 636.132'))
    expect(c?.total?.perPersonText).toBe(nb('$ 8.960 por persona'))
    // La planilla dice el mismo resultado y cierra: la pauta (271.668,5 +
    // 542.400 = 814.068,5) sale por diferencia y queda en 814.068. Redondeada
    // sola daba 814.069, y Ingreso − Costo − Pauta, un peso menos que el Resultado.
    expect(c?.total?.csv.cells).toMatchObject({
      'Ingreso ARS': '2840000',
      'Costo ARS': '1389800',
      'Margen ARS': '1450200',
      'Pauta ARS': '814068',
      'Resultado ARS': '636132',
    })
    expectCsvTotalCloses(c?.total?.csv.cells)
    expect(c?.notes.slice(0, 2)).toEqual([
      'La fecha que viene se juzga cuando pase.',
      'Antes del 09/09 no se cargó la plata: 26/08.',
    ])
  })

  it('Fernet: una sola juzgada, sin total ni barras; la orgánica pelada pide ingreso y costo', () => {
    const c = buildEventConsolidated({
      templateName: 'Fernet Libre + Lomo',
      editions: [
        ed('f08-10', '2026-10-08', { reservations: 1, guests: 8, billableGuests: 8 }),
        ed('f01-10', '2026-10-01', { reservations: 3, guests: 6, billableGuests: 6 }),
        ed('f24-09', '2026-09-24', { reservations: 11, guests: 42, billableGuests: 42 }),
        ed('f17-09', '2026-09-17', {
          reservations: 9,
          guests: 25,
          billableGuests: 25,
          attendedGuests: 25,
        }),
        ed('f03-09', '2026-09-03', {
          reservations: 1,
          guests: 2,
          billableGuests: 2,
          attendedGuests: 2,
        }),
        ed('f28-08', '2026-08-28'),
      ],
      marketing: {
        'f17-09': row({
          adSpendUsdCents: 10056,
          messages: 201,
          usdArsRate: 1550,
          revenuePerGuestArsCents: 24_000_00,
          costPerGuestArsCents: 11_000_00,
        }),
        'f03-09': row({}),
      },
    })
    expect(c?.rows.map((r) => [r.dayMonth, r.result.text])).toEqual([
      ['24/09', 'sin cargar'],
      ['17/09', nb('$ 169.132')],
      ['03/09', 'faltan ingreso y costo'],
    ])
    expect(c?.headline).toEqual({
      before: 'Dejó plata en ',
      value: 'la única',
      after: ' fecha con la cuenta cerrada.',
    })
    expect(c?.unjudgedNote).toBe('2 fechas sin juzgar.')
    expect(c?.total).toBeNull()
    expect(c?.axis).toBeNull()
    expect(c?.rows[2]?.result.sr).toBe('Sin juzgar: faltan el ingreso y el costo por persona.')
  })

  it('Merienda y Arte: ninguna juzgada; las viejas sin plata van a una nota', () => {
    const c = buildEventConsolidated({
      templateName: 'Merienda y Arte',
      editions: [
        ed('m24-10', '2026-10-24'),
        ed('m10-10', '2026-10-10'),
        ed('m26-09', '2026-09-26', { reservations: 10, guests: 20, billableGuests: 20 }),
        ed('m12-09', '2026-09-12', {
          reservations: 12,
          guests: 33,
          billableGuests: 33,
          attendedGuests: 33,
        }),
        ed('m29-08', '2026-08-29', { reservations: 6, guests: 15, billableGuests: 15 }),
        ed('m17-08', '2026-08-17'),
        ed('m31-07', '2026-07-31', { reservations: 1, guests: 5, billableGuests: 5 }),
      ],
      marketing: {
        'm12-09': row({
          adSpendUsdCents: 9388,
          messages: 57,
          usdArsRate: 1550,
          revenuePerGuestArsCents: 20_000_00,
        }),
      },
    })
    expect(c?.headline).toEqual({
      before: 'Todavía no hay ninguna fecha con la cuenta cerrada.',
      value: '',
      after: '',
    })
    expect(c?.unjudgedNote).toBeNull()
    expect(c?.rows.map((r) => r.result.text)).toEqual(['sin cargar', 'falta el costo'])
    expect(c?.notes).toEqual([
      'Las 2 fechas que vienen se juzgan cuando pasen.',
      'Antes del 12/09 no se cargó la plata: 29/08 · 31/07.',
    ])
  })

  it('sin ninguna fila de pauta, o solo en lo que viene, no hay consolidado', () => {
    expect(
      buildEventConsolidated({
        templateName: 'Comida Coreana',
        editions: [ed('c1', '2026-09-20', { reservations: 5, guests: 12, billableGuests: 12 })],
        marketing: {},
      }),
    ).toBeNull()
    expect(
      buildEventConsolidated({
        templateName: 'Sushi',
        editions: [
          ed('s2', '2026-10-28'),
          ed('s1', '2026-09-18', { reservations: 24, guests: 60, billableGuests: 60 }),
        ],
        marketing: { s2: row({ revenuePerGuestArsCents: 35_000_00 }) },
      }),
    ).toBeNull()
  })
})

describe('consolidado: los bordes', () => {
  it('hoy va a la nota, no a la tabla', () => {
    const c = buildEventConsolidated({
      templateName: 'Tacos',
      editions: [
        ed('t2', '2026-10-16'),
        ed('t1', HOY, { reservations: 18, guests: 45, billableGuests: 45 }),
        ed('t0', '2026-09-16', {
          reservations: 22,
          guests: 54,
          billableGuests: 54,
          attendedGuests: 54,
        }),
      ],
      marketing: {
        t0: row({
          adSpendUsdCents: 29060,
          messages: 137,
          usdArsRate: 1550,
          revenuePerGuestArsCents: 25_500_00,
          costPerGuestArsCents: 10_500_00,
        }),
      },
    })
    expect(c?.rows.map((r) => r.dayMonth)).toEqual(['16/09'])
    expect(c?.notes[0]).toBe('La de esta noche y la que viene se juzgan cuando pasen.')
    // 54 × 15.000 − 290,60 × 1.550 = 810.000 − 450.430
    expect(c?.rows[0]?.result.text).toBe(nb('$ 359.570'))
  })

  it('en cero: ni ✓ ni ✗, también con −$ 0,40', () => {
    for (const [r, c] of [
      [100_040, 100_000],
      [100_000, 100_040],
    ] as const) {
      const v = editionVerdict(
        ed('z', '2026-09-10', { reservations: 1, guests: 1, billableGuests: 1 }),
        row({ revenuePerGuestArsCents: r, costPerGuestArsCents: c }),
      )
      expect(v.kind).toBe('cero')
      expect(editionVerdictCsv(v, 1)).toBe('quedó en cero')
    }
  })

  it('pauta y nadie: sin juzgar, con las palabras de la ficha', () => {
    const e = ed('p', '2026-09-10', { reservations: 0, guests: 0, billableGuests: 0 })
    const r = row({
      adSpendUsdCents: 5_000,
      messages: 20,
      usdArsRate: 1550,
      revenuePerGuestArsCents: 10_000_00,
      costPerGuestArsCents: 5_000_00,
    })
    const c = buildEventConsolidated({ templateName: 'X', editions: [e], marketing: { p: r } })
    expect(c?.rows[0]?.result.text).toBe('ninguna reserva')
    expect(c?.rows[0]?.result.sr).toBe('Sin juzgar: ninguna reserva en pie.')
    expect(c?.rows[0]?.reasonText).toBe(
      'No quedó ninguna reserva en pie: no hay gente con la que hacer la cuenta.',
    )
    expect(c?.rows[0]?.detail.howToFix).toBeNull()
    expect(nightResultReason(e, r)).toBe('ninguna reserva en pie')
    // Hubo reservas, pero todas las mesas se cerraron con 0.
    const cero = ed('p', '2026-09-10', {
      reservations: 2,
      guests: 6,
      billableGuests: 0,
      attendedGuests: 0,
    })
    expect(nightResultReason(cero, r)).toBe('se contaron 0 personas')
    expect(editionVerdictCsv(editionVerdict(cero, r), 2)).toBe('sin juzgar: sin gente')
  })

  it('todo abajo: el titular y el total lo dicen en palabras', () => {
    const c = buildEventConsolidated({
      templateName: 'X',
      editions: [
        ed('a', '2026-09-20', { reservations: 5, guests: 10, billableGuests: 10 }),
        ed('b', '2026-09-13', { reservations: 5, guests: 10, billableGuests: 10 }),
      ],
      marketing: {
        a: row({
          adSpendUsdCents: 10_000,
          messages: 5,
          usdArsRate: 1500,
          revenuePerGuestArsCents: 10_000_00,
          costPerGuestArsCents: 8_000_00,
        }),
        b: row({
          adSpendUsdCents: 20_000,
          messages: 5,
          usdArsRate: 1500,
          revenuePerGuestArsCents: 10_000_00,
          costPerGuestArsCents: 8_000_00,
        }),
      },
    })
    expect(c?.headline.before + (c?.headline.value ?? '') + c?.headline.after).toBe(
      'Quedó abajo en las 2 fechas con la cuenta cerrada.',
    )
    // a: 20.000 − 150.000 = −130.000 · b: 20.000 − 300.000 = −280.000
    expect(c?.total?.result).toEqual({
      text: nb('$ 410.000'),
      suffix: 'abajo',
      tone: 'warning',
      mark: null,
      sr: nb('En total quedó $ 410.000 abajo.'),
    })
    expect(c?.total?.sentence).toBe(
      nb(
        'En total quedó $ 410.000 abajo en las 2 fechas con la cuenta cerrada ($ 20.500 abajo por persona).',
      ),
    )
    expect(c?.total?.csv.cells['Resultado ARS']).toBe('-410000')
    expect(c?.total?.csv.verdict).toBe('0 de 2')
    expectCsvTotalCloses(c?.total?.csv.cells)
    expect(JSON.stringify(c)).not.toMatch(/-\$|−\$/)
  })

  it('sin pauta y con centavos, la fila de total cierra con la pauta en 0 justo', () => {
    const c = buildEventConsolidated({
      templateName: 'X',
      editions: [
        ed('a', '2026-09-22', { reservations: 9, guests: 27, billableGuests: 27 }),
        ed('b', '2026-09-15', { reservations: 9, guests: 27, billableGuests: 27 }),
      ],
      marketing: {
        a: row({ revenuePerGuestArsCents: 16_500_50, costPerGuestArsCents: 6_500_20 }),
        b: row({ revenuePerGuestArsCents: 16_500_00, costPerGuestArsCents: 6_500_00 }),
      },
    })
    // Ingreso 891.013,5 · costo 351.005,4 · margen = resultado = 540.008,1.
    // Con «ingreso − costo» redondeados por separado el margen daba 540.009 y
    // la pauta, 1 peso que no hubo. El peso lo absorbe el costo (351.006).
    expect(c?.total?.result.text).toBe(nb('$ 540.008'))
    expect(c?.total?.csv.cells).toMatchObject({
      'Pauta USD': '0,00',
      'Ingreso ARS': '891014',
      'Costo ARS': '351006',
      'Margen ARS': '540008',
      'Pauta ARS': '0',
      'Resultado ARS': '540008',
    })
    expectCsvTotalCloses(c?.total?.csv.cells)
  })

  it('missingShort: las palabras de la celda', () => {
    expect(missingShort(['costPerGuest'], false)).toBe('falta el costo')
    expect(missingShort([], true)).toBe('falta el dólar')
    expect(missingShort(['revenuePerGuest', 'costPerGuest'], false)).toBe('faltan ingreso y costo')
    expect(missingShort(['revenuePerGuest', 'costPerGuest'], true)).toBe(
      'faltan ingreso, costo y dólar',
    )
    expect(missingShort(['drinkCostPerGuest'], true)).toBe('faltan costo de bebida y dólar')
  })

  it('nightResultReason nombra TODO lo que falta, dólar incluido', () => {
    const e = ed('q', '2026-09-10', { reservations: 3, guests: 8, billableGuests: 8 })
    expect(nightResultReason(e, row({ adSpendUsdCents: 1_000, messages: 3 }))).toBe(
      'faltan el ingreso y el costo por persona, y el dólar del día',
    )
    expect(
      nightResultReason(
        e,
        row({ adSpendUsdCents: 1_000, messages: 3, revenuePerGuestArsCents: 1_000_00 }),
      ),
    ).toBe('faltan el costo por persona y el dólar del día')
    expect(
      nightResultReason(
        e,
        row({
          adSpendUsdCents: 1_000,
          messages: 3,
          revenuePerGuestArsCents: 1_000_00,
          costPerGuestArsCents: 500_00,
        }),
      ),
    ).toBe('falta el dólar del día')
    // Una fecha vieja: facturación y dólar, sin los por persona.
    expect(
      nightResultReason(
        e,
        row({ adSpendUsdCents: 1_000, messages: 3, revenueArsCents: 900_000_00, usdArsRate: 1450 }),
      ),
    ).toBe('falta el costo por persona')
  })
})

describe('planilla de «Rentabilidad» (02/10: exactamente el cuadro)', () => {
  const lines = eventProfitabilityToCsv({
    templateName: '2x1 Burger Martes',
    editions: BURGER_EDITIONS,
    marketing: BURGER_MARKETING,
  })
    .replace('\ufeff', '')
    .split('\r\n')

  it('«¿Dejó plata?» por fila y la fila de total, iguales a la pantalla', () => {
    const at = PROFITABILITY_EXPORT_HEADERS.indexOf('¿Dejó plata?')
    expect(lines[0]?.split(';')[at]).toBe('¿Dejó plata?')
    // Las mismas cinco filas del cuadro: ni las que vienen ni las vacías.
    expect(lines.slice(1, 6).map((l) => l.split(';')[at])).toEqual([
      'sin juzgar: sin cargar',
      'sin juzgar: faltan ingreso, costo y dólar',
      'sí',
      'sí',
      'no',
    ])
    expect(lines[6]).toBe(
      'Total con la cuenta cerrada (3 fechas);152;12230;;;;1859000;977700;881300;301,48;;467294;414006;2 de 3',
    )
    expect(lines[6]?.split(';')).toHaveLength(PROFITABILITY_EXPORT_HEADERS.length)
  })

  it('el resultado negativo va con signo (en pantalla, «abajo»)', () => {
    expect(lines[5]?.split(';')[PROFITABILITY_EXPORT_HEADERS.indexOf('Resultado ARS')]).toBe(
      '-136488',
    )
  })

  it('después del total, un renglón vacío y las notas del cuadro, en su orden', () => {
    expect(lines.slice(7).map((l) => l.split(';')[0])).toEqual([
      '',
      'Las 4 fechas que vienen se juzgan cuando pasen.',
      CONSOLIDATED_BASIS_NOTE,
      CONSOLIDATED_NO_DRINKS_NOTE,
      NIGHT_RESULT_DISCLAIMER,
    ])
  })
})
