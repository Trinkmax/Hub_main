import { describe, expect, it } from 'vitest'
import {
  buildMonthMarketingReport,
  computeMarketingKpis,
  type EventMarketingRow,
  hasDrinks,
  hasNightAccount,
  howItsCalculated,
  MARKETING_EXPORT_HEADERS,
  MONTH_EXPORT_HEADERS,
  MONTH_FOOTNOTES,
  MONTH_RESULT_BASIS_FOOTNOTE,
  MONTH_RESULT_DRINKS_FOOTNOTE,
  MONTH_RESULT_FOOTNOTE,
  marketingCsvCells,
  missingNightInputs,
  monthMarketingToCsv,
  nightResultReason,
  nightResultReport,
  noAdsResultLabel,
  previewLines,
} from '@/lib/salon/event-marketing'

function nb(text: string): string {
  return text.replace(/\$ /g, '$ ').replace(/ %/g, ' %')
}

function row(over: Partial<EventMarketingRow> = {}): EventMarketingRow {
  return {
    scheduledEventId: 'ev',
    adSpendUsdCents: 17526,
    messages: 51,
    reach: null,
    revenueArsCents: null,
    usdArsRate: null,
    revenuePerGuestArsCents: null,
    costPerGuestArsCents: null,
    drinkRevenuePerGuestArsCents: null,
    drinkCostPerGuestArsCents: null,
    notes: null,
    updatedAt: '2026-09-10T17:32:00Z',
    updatedByName: 'Nacho B.',
    ...over,
  }
}

const RAMEN = { reservations: 12, guests: 31, billableGuests: 29, attendedGuests: 27 }
const RAMEN_ROW = row({
  usdArsRate: 1450,
  revenuePerGuestArsCents: 27_000_00,
  costPerGuestArsCents: 15_000_00,
})

/**
 * El 2x1 Burger del 15/09 con la bebida aparte (el ejemplo del pedido): 65
 * personas contadas, cubierto $ 18.000 + $ 6.000 de bebida, costo $ 7.000 +
 * $ 2.500 de bebida, US$ 105,82 a $ 1.550.
 */
const BURGER = { reservations: 23, guests: 62, billableGuests: 65, attendedGuests: 65 }
const BURGER_ROW = row({
  adSpendUsdCents: 10582,
  messages: 132,
  usdArsRate: 1550,
  revenuePerGuestArsCents: 18_000_00,
  costPerGuestArsCents: 7_000_00,
  drinkRevenuePerGuestArsCents: 6_000_00,
  drinkCostPerGuestArsCents: 2_500_00,
})

/** Tapeo y Malbec del 04/09: el vino va incluido en los $ 27.000 (bebida 0), y cuesta $ 4.000. */
const TAPEO = { reservations: 24, guests: 62, billableGuests: 60, attendedGuests: 60 }
const TAPEO_ROW = row({
  adSpendUsdCents: 19022,
  messages: 94,
  usdArsRate: 1600,
  revenuePerGuestArsCents: 27_000_00,
  costPerGuestArsCents: 13_000_00,
  drinkRevenuePerGuestArsCents: 0,
  drinkCostPerGuestArsCents: 4_000_00,
})

const RATATOUILLE = { reservations: 18, guests: 54, billableGuests: 48, attendedGuests: 48 }
const ORGANIC_DRINKS = row({
  adSpendUsdCents: 0,
  messages: null,
  revenuePerGuestArsCents: 25_000_00,
  costPerGuestArsCents: 7_200_00,
  drinkRevenuePerGuestArsCents: 5_000_00,
  drinkCostPerGuestArsCents: 1_800_00,
})

const at = (cells: string[], header: string) => cells[MARKETING_EXPORT_HEADERS.indexOf(header)]

describe('la bebida en la cuenta de la noche', () => {
  it('personas × (cubierto + bebida) − personas × (costo + costo de bebida) − pauta', () => {
    const k = computeMarketingKpis(BURGER, BURGER_ROW)
    expect(k.revenueArs).toEqual({ ok: true, value: 1_560_000 })
    expect(k.costArs).toEqual({ ok: true, value: 617_500 })
    expect(k.grossMarginArs).toEqual({ ok: true, value: 942_500 })
    expect(k.adSpendArs).toEqual({ ok: true, value: 164_021 })
    expect(k.nightResultArs).toEqual({ ok: true, value: 778_479 })
    expect(k.marginPerGuestArs).toEqual({ ok: true, value: 14_500 })
    expect(k.guestsToCoverAds).toEqual({ ok: true, value: 12 })
  })

  it('la cuenta nombra la bebida en cada paso, con los números a la vista', () => {
    const r = nightResultReport(BURGER, BURGER_ROW)
    expect(r?.steps).toEqual([
      {
        before: nb('65 personas × ($ 18.000 + $ 6.000 de bebida) = '),
        value: nb('$ 1.560.000'),
        after: '',
      },
      {
        before: nb('costo 65 × ($ 7.000 + $ 2.500 de bebida) = '),
        value: nb('$ 617.500'),
        after: '',
      },
      { before: 'margen ', value: nb('$ 942.500'), after: '' },
      { before: 'pauta ', value: nb('$ 164.021'), after: '' },
    ])
    expect(r?.math).toBe(
      nb(
        '65 personas × ($ 18.000 + $ 6.000 de bebida) = $ 1.560.000 · costo 65 × ($ 7.000 + $ 2.500 de bebida) = $ 617.500 · margen $ 942.500 · pauta $ 164.021 → quedan $ 778.479',
      ),
    )
    expect(r?.headline).toBe(nb('La noche dejó $ 778.479.'))
    expect(r?.perGuest).toBe(
      nb('Cada persona dejó $ 14.500 con la bebida y la pauta se cubrió con 12 personas.'),
    )
    expect(r?.perGuestAfterAds).toBe(nb('Después de la pauta quedaron $ 11.977 por persona.'))
    // La bebida se multiplica por la MISMA gente que el cubierto.
    expect(r?.basis).toBe(
      'Se calculó con 65 personas contadas al cerrar las mesas, no con las 62 reservadas.',
    )
  })

  it('la bebida incluida (0) se dice «bebida incluida», y su costo se suma igual', () => {
    const r = nightResultReport(TAPEO, TAPEO_ROW)
    expect(r?.math).toBe(
      nb(
        '60 personas × $ 27.000 (bebida incluida) = $ 1.620.000 · costo 60 × ($ 13.000 + $ 4.000 de bebida) = $ 1.020.000 · margen $ 600.000 · pauta $ 304.352 → quedan $ 295.648',
      ),
    )
    expect(r?.perGuest).toBe(
      nb('Cada persona dejó $ 10.000 con la bebida y la pauta se cubrió con 31 personas.'),
    )
    // Un 0 de costo de bebida también es un número: se muestra como tal.
    expect(
      nightResultReport(BURGER, { ...BURGER_ROW, drinkCostPerGuestArsCents: 0 })?.steps[1],
    ).toEqual({
      before: nb('costo 65 × ($ 7.000 + $ 0 de bebida) = '),
      value: nb('$ 455.000'),
      after: '',
    })
  })

  it('en negativo, en palabras y con la bebida nombrada', () => {
    const r = nightResultReport(BURGER, { ...BURGER_ROW, revenuePerGuestArsCents: 2_000_00 })
    expect(r?.headline).toBe(nb('La noche quedó $ 261.521 abajo.'))
    expect(r?.perGuest).toBe(nb('Cada persona costó $ 1.500 más de lo que dejó, con la bebida.'))
    expect(`${r?.headline} ${r?.math}`).not.toMatch(/-\s?\$/)
  })

  it('con la bebida a medio cargar la cuenta no cierra, y dice qué falta', () => {
    const sinCosto = nightResultReport(BURGER, { ...BURGER_ROW, drinkCostPerGuestArsCents: null })
    expect(sinCosto?.headline).toBe(nb('El ingreso de la noche fue $ 1.560.000.'))
    expect(sinCosto?.missing).toBe(
      'Falta el costo de bebida por persona para sacar el resultado de la noche.',
    )
    expect(
      computeMarketingKpis(BURGER, { ...BURGER_ROW, drinkCostPerGuestArsCents: null }).costArs,
    ).toEqual({
      ok: false,
      reason: 'sin-costo-de-bebida',
    })

    const sinIngreso = nightResultReport(BURGER, {
      ...BURGER_ROW,
      drinkRevenuePerGuestArsCents: null,
    })
    expect(sinIngreso?.headline).toBe(nb('El costo de la noche fue $ 617.500.'))
    expect(sinIngreso?.missing).toBe(
      'Falta el ingreso de bebida por persona para sacar el resultado de la noche. Si la bebida está incluida, poné 0.',
    )
  })

  it('lo que falta se dice todo junto, en el orden del formulario', () => {
    const soloBebida = nightResultReport(BURGER, {
      ...BURGER_ROW,
      revenuePerGuestArsCents: null,
      costPerGuestArsCents: null,
    })
    // El mismo texto de siempre cuando faltan los dos del cubierto.
    expect(soloBebida?.missing).toBe(
      'Faltan el ingreso y el costo por persona para sacar el resultado de la noche.',
    )
    expect(missingNightInputs(row({ drinkRevenuePerGuestArsCents: 6_000_00 }))).toEqual([
      'revenuePerGuest',
      'costPerGuest',
      'drinkCostPerGuest',
    ])
    expect(
      nightResultReport(BURGER, row({ drinkRevenuePerGuestArsCents: 6_000_00, usdArsRate: 1550 }))
        ?.missing,
    ).toBe(
      'Faltan el ingreso, el costo y el costo de bebida por persona para sacar el resultado de la noche.',
    )
  })

  it('la facturación real ya trae la bebida: manda sobre cubierto + bebida', () => {
    const r = nightResultReport(BURGER, { ...BURGER_ROW, revenueArsCents: 1_500_000_00 })
    expect(r?.steps[0]).toEqual({ before: 'facturación ', value: nb('$ 1.500.000'), after: '' })
    // El costo de la bebida sigue: la caja no sabe de costos.
    expect(r?.steps[1]?.before).toBe(nb('costo 65 × ($ 7.000 + $ 2.500 de bebida) = '))
    expect(r?.headline).toBe(nb('La noche dejó $ 718.479.'))
    expect(r?.revenueNote).toBe(
      nb(
        'El ingreso es la facturación real de la caja, que ya trae la bebida: manda sobre los $ 18.000 + $ 6.000 de bebida por persona, que daban $ 1.560.000.',
      ),
    )
    // Con facturación, el ingreso de bebida no hace falta para cerrar.
    const sinIngresoDeBebida = nightResultReport(BURGER, {
      ...BURGER_ROW,
      revenueArsCents: 1_500_000_00,
      drinkRevenuePerGuestArsCents: null,
    })
    expect(sinIngresoDeBebida?.headline).toBe(nb('La noche dejó $ 718.479.'))
    expect(sinIngresoDeBebida?.revenueNote).toBe(
      'El ingreso es la facturación real de la caja, que ya trae la bebida.',
    )
    // El costo de bebida sí.
    expect(
      nightResultReport(BURGER, {
        ...BURGER_ROW,
        revenueArsCents: 1_500_000_00,
        drinkCostPerGuestArsCents: null,
      })?.missing,
    ).toBe('Falta el costo de bebida por persona para sacar el resultado de la noche.')
    expect(
      nightResultReport(BURGER, {
        ...BURGER_ROW,
        revenueArsCents: 1_500_000_00,
        drinkRevenuePerGuestArsCents: 0,
      })?.revenueNote,
    ).toBe(
      nb(
        'El ingreso es la facturación real de la caja, que ya trae la bebida: manda sobre los $ 18.000 por persona (bebida incluida), que daban $ 1.170.000.',
      ),
    )
  })

  it('una noche sin pauta lleva su bebida igual (regla 14)', () => {
    const r = nightResultReport(RATATOUILLE, ORGANIC_DRINKS)
    expect(r?.math).toBe(
      nb(
        '48 personas × ($ 25.000 + $ 5.000 de bebida) = $ 1.440.000 · costo 48 × ($ 7.200 + $ 1.800 de bebida) = $ 432.000 · margen $ 1.008.000 · sin pauta → quedan $ 1.008.000',
      ),
    )
    expect(r?.perGuest).toBe(nb('Cada persona dejó $ 21.000 con la bebida.'))
    expect(noAdsResultLabel({ ...RATATOUILLE, phase: 'past', row: ORGANIC_DRINKS })).toEqual({
      text: nb('dejó $ 1.008.000'),
      negative: false,
    })
  })

  it('una fecha que todavía no pasó habla en «por ahora», con la bebida', () => {
    expect(nightResultReport(BURGER, BURGER_ROW, 'future')?.headline).toBe(
      nb('Por ahora la noche va dejando $ 778.479.'),
    )
  })

  it('regla 13: la bebida sola abre la cuenta; sin bebida, nada cambia', () => {
    expect(hasNightAccount(row({ drinkRevenuePerGuestArsCents: 0 }))).toBe(true)
    expect(hasNightAccount(row({ drinkCostPerGuestArsCents: 2_500_00 }))).toBe(true)
    expect(hasNightAccount(row({ revenueArsCents: 2_480_000_00, usdArsRate: 1450 }))).toBe(false)
    expect(hasDrinks(RAMEN_ROW)).toBe(false)
    // La fecha del ramen se lee EXACTAMENTE como antes: ni un «bebida» en ningún texto.
    const r = nightResultReport(RAMEN, RAMEN_ROW)
    expect(JSON.stringify(r)).not.toMatch(/bebida/)
    expect(howItsCalculated(RAMEN_ROW).join(' ')).not.toMatch(/bebida/)
  })

  it('«¿Cómo se calcula?» nombra la bebida solo cuando está cargada', () => {
    expect(howItsCalculated(BURGER_ROW)).toContain(
      'Resultado de la noche: la gente por el ingreso por persona más el de bebida (o la facturación real, si está cargada, que ya trae la bebida), menos esa misma gente por el costo por persona más el de bebida, menos la pauta pasada a pesos con el dólar del día.',
    )
    expect(howItsCalculated(ORGANIC_DRINKS)).toContain(
      'Resultado de la noche: la gente por el ingreso por persona más el de bebida (o la facturación real, si está cargada, que ya trae la bebida), menos esa misma gente por el costo por persona más el de bebida. Sin pauta no hay nada más que restar.',
    )
  })
})

describe('previewLines con la bebida', () => {
  const base = {
    adSpendUsd: 105.82,
    messages: 132,
    reach: null,
    revenueArs: null,
    usdArsRate: 1550,
  }
  const plata = {
    revenuePerGuestArs: 18_000,
    costPerGuestArs: 7_000,
    drinkRevenuePerGuestArs: 6_000,
    drinkCostPerGuestArs: 2_500,
  }

  it('dice lo mismo que la ficha va a decir al guardar', () => {
    const lines = previewLines(BURGER, { ...base, ...plata })
    expect(lines[3]?.text).toBe(nightResultReport(BURGER, BURGER_ROW)?.math)
  })

  it('a medio cargar, lo que ya da y qué falta', () => {
    const lines = previewLines(BURGER, { ...base, ...plata, drinkCostPerGuestArs: null })
    expect(lines[3]?.text).toBe(
      nb(
        '65 personas × ($ 18.000 + $ 6.000 de bebida) = $ 1.560.000 · Falta el costo de bebida por persona para sacar el resultado de la noche.',
      ),
    )
  })

  it('con Gastado vacío, primero la plata que falta y recién después la pauta', () => {
    const soloBebida = previewLines(BURGER, {
      adSpendUsd: null,
      messages: null,
      reach: null,
      revenueArs: null,
      usdArsRate: null,
      drinkRevenuePerGuestArs: 6_000,
    })
    expect(soloBebida[3]?.text).toBe(
      '— de resultado · Faltan el ingreso, el costo y el costo de bebida por persona para sacar el resultado de la noche.',
    )
    const todo = previewLines(BURGER, { ...base, adSpendUsd: null, messages: null, ...plata })
    expect(todo[3]?.text).toBe(
      nb(
        '65 personas × ($ 18.000 + $ 6.000 de bebida) = $ 1.560.000 · costo 65 × ($ 7.000 + $ 2.500 de bebida) = $ 617.500 · margen $ 942.500 · falta la pauta para cerrar la cuenta',
      ),
    )
  })

  it('sin tocar la bebida, la previa es la de siempre', () => {
    const lines = previewLines(RAMEN, {
      adSpendUsd: 175.26,
      messages: 51,
      reach: null,
      revenueArs: null,
      usdArsRate: 1450,
      revenuePerGuestArs: 27_000,
      costPerGuestArs: 15_000,
    })
    expect(lines[3]?.text).toBe(nightResultReport(RAMEN, RAMEN_ROW)?.math)
  })
})

describe('CSV con la bebida', () => {
  it('las dos columnas nuevas van después del cubierto y su costo, antes del total', () => {
    const cells = marketingCsvCells(BURGER, BURGER_ROW)
    expect(at(cells, 'Ingreso por persona ARS')).toBe('18000')
    expect(at(cells, 'Costo por persona ARS')).toBe('7000')
    expect(at(cells, 'Ingreso de bebida por persona ARS')).toBe('6000')
    expect(at(cells, 'Costo de bebida por persona ARS')).toBe('2500')
    expect(at(cells, 'Ingreso ARS')).toBe('1560000')
    expect(at(cells, 'Costo ARS')).toBe('617500')
    expect(at(cells, 'Resultado ARS')).toBe('778479')
    expect(MARKETING_EXPORT_HEADERS.at(-1)).toBe('Nota')
  })

  it('la bebida incluida es un 0; la que no se cargó, vacío', () => {
    expect(at(marketingCsvCells(TAPEO, TAPEO_ROW), 'Ingreso de bebida por persona ARS')).toBe('0')
    expect(at(marketingCsvCells(RAMEN, RAMEN_ROW), 'Ingreso de bebida por persona ARS')).toBe('')
    expect(at(marketingCsvCells(RAMEN, RAMEN_ROW), 'Costo de bebida por persona ARS')).toBe('')
  })

  it('con centavos si los tiene, como el cubierto', () => {
    const cells = marketingCsvCells(BURGER, {
      ...BURGER_ROW,
      drinkRevenuePerGuestArsCents: 6_000_50,
    })
    expect(at(cells, 'Ingreso de bebida por persona ARS')).toBe('6000,50')
  })

  it('una fecha que no pasó lleva lo tipeado (también la bebida), no lo calculado', () => {
    const mes = buildMonthMarketingReport({
      ym: '2026-10',
      today: '2026-09-30',
      editions: [
        {
          key: 'f1',
          eventId: 'f1',
          date: '2026-10-06',
          title: '2x1 Burger Martes',
          colorHex: null,
          startsAtLocal: '21:00:00',
          ...BURGER,
        },
      ],
      marketing: { f1: { ...BURGER_ROW, scheduledEventId: 'f1' } },
      truncated: false,
    })
    const cells = (monthMarketingToCsv(mes).replace(/^﻿/, '').split('\r\n')[1] ?? '').split(';')
    const col = (h: string) => cells[MONTH_EXPORT_HEADERS.indexOf(h)]
    expect(col('Ingreso de bebida por persona ARS')).toBe('6000')
    expect(col('Costo de bebida por persona ARS')).toBe('2500')
    expect(col('Ingreso ARS')).toBe('')
    expect(col('Resultado ARS')).toBe('')
  })
})

describe('el mes con la bebida', () => {
  const ed = (key: string, date: string, title: string, b: typeof RAMEN) => ({
    key,
    eventId: key,
    date,
    title,
    colorHex: null,
    startsAtLocal: '21:00:00',
    ...b,
  })
  const EDICIONES = [
    ed('r1', '2026-09-07', 'Ramen', RAMEN),
    ed('b1', '2026-09-15', '2x1 Burger Martes', BURGER),
  ]

  it('suma la bebida donde está y lo dice en la base', () => {
    const mes = buildMonthMarketingReport({
      ym: '2026-09',
      today: '2026-09-30',
      editions: EDICIONES,
      marketing: {
        r1: { ...RAMEN_ROW, scheduledEventId: 'r1' },
        b1: { ...BURGER_ROW, scheduledEventId: 'b1' },
      },
      truncated: false,
    })
    expect(mes.result?.math).toBe(
      nb(
        '94 personas · ingreso $ 2.343.000 · costo $ 1.052.500 · margen $ 1.290.500 · pauta $ 418.148 → quedan $ 872.352',
      ),
    )
    expect(mes.result?.base).toBe('en 2 de 2 fechas con ingreso y costo cargados (1 con bebida)')
    expect(mes.footnotes).toEqual([
      ...MONTH_FOOTNOTES,
      MONTH_RESULT_FOOTNOTE,
      MONTH_RESULT_BASIS_FOOTNOTE,
      MONTH_RESULT_DRINKS_FOOTNOTE,
    ])
    const total = monthMarketingToCsv(mes)
      .split('\r\n')
      .find((l) => l.startsWith('Total con pauta que ya pasó, con ingreso'))
      ?.split(';')
    expect(total?.[0]).toBe(
      'Total con pauta que ya pasó, con ingreso y costo cargados (2 fechas, 1 con bebida)',
    )
    expect(total?.[MONTH_EXPORT_HEADERS.indexOf('Ingreso ARS')]).toBe('2343000')
    expect(total?.[MONTH_EXPORT_HEADERS.indexOf('Resultado ARS')]).toBe('872352')
  })

  it('una fecha con la bebida a medio cargar no suma, y su celda dice qué falta', () => {
    const mes = buildMonthMarketingReport({
      ym: '2026-09',
      today: '2026-09-30',
      editions: EDICIONES,
      marketing: {
        r1: { ...RAMEN_ROW, scheduledEventId: 'r1' },
        b1: { ...BURGER_ROW, scheduledEventId: 'b1', drinkCostPerGuestArsCents: null },
      },
      truncated: false,
    })
    expect(mes.result?.base).toBe('en 1 de 2 fechas con ingreso y costo cargados')
    expect(mes.rows[1]?.cells.nightResult).toEqual({
      text: '—',
      tone: 'muted',
      srText: 'falta el costo de bebida por persona',
    })
    expect(mes.footnotes.at(-1)).toBe(MONTH_RESULT_DRINKS_FOOTNOTE)
  })

  it('sin bebida en ninguna fecha, el mes se lee como antes', () => {
    const mes = buildMonthMarketingReport({
      ym: '2026-09',
      today: '2026-09-30',
      editions: EDICIONES,
      marketing: {
        r1: { ...RAMEN_ROW, scheduledEventId: 'r1' },
        b1: {
          ...BURGER_ROW,
          scheduledEventId: 'b1',
          drinkRevenuePerGuestArsCents: null,
          drinkCostPerGuestArsCents: null,
        },
      },
      truncated: false,
    })
    expect(mes.result?.base).toBe('en 2 de 2 fechas con ingreso y costo cargados')
    expect(mes.footnotes).not.toContain(MONTH_RESULT_DRINKS_FOOTNOTE)
  })
})

describe('la razón de una fecha sin resultado (celda del mes y consolidado)', () => {
  it('la misma razón en la celda del mes y en el consolidado', () => {
    expect(nightResultReason(RAMEN, row({ revenueArsCents: 2_480_000_00, usdArsRate: 1450 }))).toBe(
      'falta el costo por persona',
    )
    expect(nightResultReason(RAMEN, RAMEN_ROW)).toBeNull()
    expect(nightResultReason(BURGER, { ...BURGER_ROW, drinkCostPerGuestArsCents: null })).toBe(
      'falta el costo de bebida por persona',
    )
    expect(
      nightResultReason(BURGER, {
        ...BURGER_ROW,
        drinkCostPerGuestArsCents: null,
        usdArsRate: null,
      }),
    ).toBe('faltan el costo de bebida por persona y el dólar del día')
  })
})
