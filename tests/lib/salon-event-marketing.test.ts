import { describe, expect, it } from 'vitest'
import {
  buildMonthMarketingReport,
  canonicalInput,
  computeMarketingKpis,
  csvFormulaGuard,
  type EventMarketingRow,
  editionMarketingLine,
  fichaItems,
  formatArs,
  formatCount,
  formatLoadedAt,
  formatPercent,
  formatPerThousand,
  formatPesosRate,
  formatUsd,
  hasNightAccount,
  howItsCalculated,
  isPendingMarketing,
  type Kpi,
  kpiHint,
  loadedBeforeEventLine,
  loadedByLabel,
  MARKETING_EXPORT_HEADERS,
  MONTH_EXPORT_HEADERS,
  MONTH_FOOTNOTES,
  MONTH_RESULT_BASIS_FOOTNOTE,
  MONTH_RESULT_FOOTNOTE,
  marketingCsvCells,
  marketingSentence,
  marketingStatus,
  marketingStatusChip,
  monthMarketingToCsv,
  NIGHT_RESULT_DISCLAIMER,
  nightResultReport,
  noAdsResultLabel,
  type PoolItem,
  parseLocaleNumber,
  phaseOf,
  pooledStripSummary,
  poolMarketing,
  previewLines,
  returnDetails,
  returnSentence,
  shortName,
} from '@/lib/salon/event-marketing'
import type { EditionSummary } from '@/lib/salon/events-report'
import { ARSFormat } from '@/lib/salon/format'

/**
 * Los textos de la spec se escriben con espacios comunes; la pantalla lleva
 * espacio duro después de `$`/`US$` y antes de `%`. Esto los pone donde van,
 * así los casos se leen igual que en la spec y el test sigue siendo exacto.
 */
function nb(text: string): string {
  return text.replace(/\$ /g, '$\u00A0').replace(/ %/g, '\u00A0%')
}

function row(over: Partial<EventMarketingRow> = {}): EventMarketingRow {
  return {
    scheduledEventId: 'ev-astral',
    adSpendUsdCents: 17526,
    messages: 51,
    reach: null,
    revenueArsCents: null,
    usdArsRate: null,
    revenuePerGuestArsCents: null,
    costPerGuestArsCents: null,
    notes: null,
    updatedAt: '2026-09-10T17:32:00Z',
    updatedByName: 'Nacho B.',
    ...over,
  }
}

/** El ejemplo del dueño completo: Noche Astral 09/09. */
const ASTRAL = { reservations: 11, guests: 29, billableGuests: 29, attendedGuests: 27 }
const ASTRAL_FULL = row({ reach: 8420, revenueArsCents: 2_480_000_00, usdArsRate: 1450 })

/**
 * El otro ejemplo del dueño, el de la ganancia: «una noche de ramen que ponele
 * sale 27 mil pesos por persona y capaz el costo por persona es de 15 mil».
 *
 * Reservaron 31 personas pero la cuenta se hace con 29: 27 contadas al cerrar
 * mesas y 2 de las que quedaron sin cerrar.
 */
const RAMEN = { reservations: 12, guests: 31, billableGuests: 29, attendedGuests: 27 }
const RAMEN_ROW = row({
  scheduledEventId: 'ev-ramen',
  usdArsRate: 1450,
  revenuePerGuestArsCents: 27_000_00,
  costPerGuestArsCents: 15_000_00,
})

/**
 * Ratatouille (22/09/2026): «fue todo orgánico». Sin pauta, con la plata de la
 * noche: 48 personas a $ 25.000 de ingreso y $ 7.200 de costo.
 */
const RATATOUILLE = { reservations: 18, guests: 54, billableGuests: 48, attendedGuests: 48 }
const ORGANIC_ROW = row({
  scheduledEventId: 'ev-ratatouille',
  adSpendUsdCents: 0,
  messages: null,
  revenuePerGuestArsCents: 25_000_00,
  costPerGuestArsCents: 7_200_00,
})

function value(k: Kpi): number {
  if (!k.ok) throw new Error(`KPI no calculable: ${k.reason}`)
  return k.value
}

function reason(k: Kpi): string | null {
  return k.ok ? null : k.reason
}

// ─── Formato ─────────────────────────────────────────────────────────────────

describe('formato a mano', () => {
  it('el ejemplo del dueño da exactamente lo de la spec, con espacio duro', () => {
    const k = computeMarketingKpis(ASTRAL, ASTRAL_FULL)
    expect(formatUsd(value(k.costPerMessageUsd))).toBe('US$\u00A03,44')
    expect(formatPercent(value(k.closingRate))).toBe('21,6\u00A0%')
    expect(formatUsd(value(k.costPerReservationUsd))).toBe('US$\u00A015,93')
    expect(formatUsd(value(k.costPerGuestUsd))).toBe('US$\u00A06,04')
  })

  it('con alcance 8.420: US$ 20,81 / 0,6 % / 6 de cada 1.000', () => {
    const k = computeMarketingKpis(ASTRAL, ASTRAL_FULL)
    expect(formatUsd(value(k.costPerThousandReachedUsd))).toBe('US$\u00A020,81')
    expect(formatPercent(value(k.replyRate))).toBe('0,6\u00A0%')
    expect(formatPerThousand(value(k.replyRate))).toBe('6 de cada 1.000')
  })

  it('con facturación 2.480.000 a 1.450: US$ 9,76 / $ 254.127 / 10,2 % / $ 85.517', () => {
    const k = computeMarketingKpis(ASTRAL, ASTRAL_FULL)
    expect(formatUsd(value(k.returnPerDollar))).toBe('US$\u00A09,76')
    expect(formatArs(value(k.spendArs))).toBe('$\u00A0254.127')
    expect(formatPercent(value(k.adShareOfRevenue))).toBe('10,2\u00A0%')
    expect(formatArs(value(k.revenuePerGuestArs))).toBe('$\u00A085.517')
  })

  it('formatUsd agrupa miles y redondea como una persona (1,005 → 1,01)', () => {
    expect(formatUsd(175.26)).toBe(nb('US$ 175,26'))
    expect(formatUsd(1240.5)).toBe(nb('US$ 1.240,50'))
    expect(formatUsd(45)).toBe(nb('US$ 45,00'))
    expect(formatUsd(0)).toBe(nb('US$ 0,00'))
    expect(formatUsd(1.005)).toBe(nb('US$ 1,01'))
    expect(formatUsd(1234567.891)).toBe(nb('US$ 1.234.567,89'))
  })

  it('formatArs da lo mismo que ARSFormat (que recibe centavos)', () => {
    for (const pesos of [0, 7, 999, 1234, 254127, 2_480_000, 85517.24, 1_000_000_000]) {
      expect(formatArs(pesos)).toBe(ARSFormat(Math.round(pesos * 100)))
    }
  })

  it('formatPesosRate: entero si es redondo, dos decimales si los tiene', () => {
    expect(formatPesosRate(1450)).toBe(nb('$ 1.450'))
    expect(formatPesosRate(1450.5)).toBe(nb('$ 1.450,50'))
    expect(formatPesosRate(14.5)).toBe(nb('$ 14,50'))
  })

  it('formatPercent: cero exacto, casi cero y un cociente común', () => {
    expect(formatPercent(0)).toBe(nb('0 %'))
    expect(formatPercent(0.0004)).toBe(nb('menos de 0,1 %'))
    expect(formatPercent(11 / 51)).toBe(nb('21,6 %'))
    expect(formatPercent(1)).toBe(nb('100,0 %'))
    expect(formatPercent(12.345)).toBe(nb('1.234,5 %'))
  })

  it('formatCount coincide con Intl es-AR y formatPerThousand nombra el casi cero', () => {
    const intl = new Intl.NumberFormat('es-AR')
    for (const n of [0, 7, 51, 1234, 8420, 1_000_000]) expect(formatCount(n)).toBe(intl.format(n))
    expect(formatPerThousand(0)).toBe('0 de cada 1.000')
    expect(formatPerThousand(0.0004)).toBe('menos de 1 de cada 1.000')
    expect(formatPerThousand(51 / 8420)).toBe('6 de cada 1.000')
  })

  it('formatLoadedAt: dd/MM HH:mm en hora de Córdoba', () => {
    expect(formatLoadedAt('2026-09-10T17:32:00Z')).toBe('10/09 14:32')
    // Medianoche de Córdoba: nunca "24:00".
    expect(formatLoadedAt('2026-09-10T03:00:00Z')).toBe('10/09 00:00')
    // 01:00 UTC del 10 todavía es el 9 en Córdoba.
    expect(formatLoadedAt('2026-09-10T01:00:00+00:00')).toBe('09/09 22:00')
    expect(formatLoadedAt('no es una fecha')).toBe('')
  })

  it('shortName: nombre + inicial del último apellido', () => {
    expect(shortName('Nacho Badra')).toBe('Nacho B.')
    expect(shortName('  Nacho   badra ')).toBe('Nacho B.')
    expect(shortName('María José Pérez')).toBe('María P.')
    expect(shortName('Luz')).toBe('Luz')
    expect(shortName('   ')).toBeNull()
    expect(shortName(null)).toBeNull()
  })
})

// ─── Fase, estado, pendientes ────────────────────────────────────────────────

describe('fase y estado', () => {
  it('phaseOf compara strings', () => {
    expect(phaseOf('2026-09-09', '2026-09-15')).toBe('past')
    expect(phaseOf('2026-09-15', '2026-09-15')).toBe('tonight')
    expect(phaseOf('2026-09-26', '2026-09-15')).toBe('future')
  })

  it('los cuatro estados', () => {
    expect(marketingStatus(null)).toBe('sin-cargar')
    expect(marketingStatus(row({ adSpendUsdCents: 0, messages: null }))).toBe('sin-pauta')
    expect(marketingStatus(row({ messages: null }))).toBe('incompleta')
    expect(marketingStatus(row())).toBe('completa')
    // Cero mensajes es un dato cargado, no una pauta incompleta.
    expect(marketingStatus(row({ messages: 0 }))).toBe('completa')
  })

  it('isPendingMarketing: solo fechas pasadas sin fila o con gasto y sin mensajes', () => {
    expect(isPendingMarketing(null, 'past')).toBe(true)
    expect(isPendingMarketing(row({ messages: null }), 'past')).toBe(true)
    expect(isPendingMarketing(row(), 'past')).toBe(false)
    expect(isPendingMarketing(row({ adSpendUsdCents: 0, messages: null }), 'past')).toBe(false)
    expect(isPendingMarketing(null, 'tonight')).toBe(false)
    expect(isPendingMarketing(null, 'future')).toBe(false)
    expect(isPendingMarketing(row({ messages: null }), 'future')).toBe(false)
  })

  it('chip de estado', () => {
    expect(marketingStatusChip(row({ messages: null }), 'past')).toEqual({
      text: 'Incompleta',
      tone: 'warning',
    })
    expect(marketingStatusChip(row(), 'future')).toEqual({ text: 'Por ahora', tone: 'muted' })
    expect(marketingStatusChip(row(), 'past')).toBeNull()
    expect(marketingStatusChip(null, 'past')).toBeNull()
  })

  it('quién cargó y cuándo', () => {
    expect(loadedByLabel(row())).toBe('Cargó Nacho B. · 10/09 14:32')
    expect(loadedByLabel(row({ updatedByName: null }))).toBe('Cargada el 10/09 14:32')
  })

  it('carga anterior al evento: compara el día de Córdoba, no el de UTC', () => {
    expect(
      loadedBeforeEventLine(row({ updatedAt: '2026-09-05T15:00:00Z' }), '2026-09-09', 'past'),
    ).toBe(
      'Se cargó el 05/09, antes del evento. Si la campaña siguió, actualizá con los números finales de Meta.',
    )
    // 02:30 UTC del 10 = 23:30 del 9 en Córdoba: se cargó la noche del evento.
    expect(
      loadedBeforeEventLine(row({ updatedAt: '2026-09-10T02:30:00Z' }), '2026-09-09', 'past'),
    ).toBeNull()
    // 01:00 UTC del 9 = 22:00 del 8 en Córdoba: sí es antes.
    expect(
      loadedBeforeEventLine(row({ updatedAt: '2026-09-09T01:00:00Z' }), '2026-09-09', 'past'),
    ).toMatch(/^Se cargó el 08\/09/)
    expect(
      loadedBeforeEventLine(row({ updatedAt: '2026-09-05T15:00:00Z' }), '2026-09-20', 'future'),
    ).toBeNull()
    expect(loadedBeforeEventLine(null, '2026-09-09', 'past')).toBeNull()
  })
})

// ─── KPIs de una edición ─────────────────────────────────────────────────────

describe('computeMarketingKpis: cada motivo', () => {
  it('sin-pauta: gasto 0 no calcula nada', () => {
    const k = computeMarketingKpis(ASTRAL, row({ adSpendUsdCents: 0, messages: null }))
    expect(k.spendUsd).toBe(0)
    for (const key of [
      'costPerMessageUsd',
      'closingRate',
      'costPerReservationUsd',
      'costPerGuestUsd',
      'costPerThousandReachedUsd',
      'replyRate',
      'spendArs',
      'revenueUsd',
      'returnPerDollar',
      'adShareOfRevenue',
      'revenuePerGuestArs',
    ] as const) {
      expect(reason(k[key])).toBe('sin-pauta')
    }
  })

  it('sin-mensajes: mensajes sin cargar', () => {
    const k = computeMarketingKpis(ASTRAL, row({ messages: null, reach: 8420 }))
    expect(reason(k.costPerMessageUsd)).toBe('sin-mensajes')
    expect(reason(k.closingRate)).toBe('sin-mensajes')
    expect(reason(k.replyRate)).toBe('sin-mensajes')
    // Lo que no depende de los mensajes sigue saliendo.
    expect(k.costPerReservationUsd.ok).toBe(true)
  })

  it('cero-mensajes: no escribió nadie', () => {
    const k = computeMarketingKpis(ASTRAL, row({ messages: 0 }))
    expect(reason(k.costPerMessageUsd)).toBe('cero-mensajes')
    expect(reason(k.closingRate)).toBe('cero-mensajes')
  })

  it('mas-reservas-que-mensajes: el cierre nunca pasa de 100 %', () => {
    const k = computeMarketingKpis(
      { reservations: 14, guests: 30, billableGuests: 30 },
      row({ adSpendUsdCents: 8000, messages: 9 }),
    )
    expect(reason(k.closingRate)).toBe('mas-reservas-que-mensajes')
    expect(formatUsd(value(k.costPerReservationUsd))).toBe(nb('US$ 5,71'))
  })

  it('cero-reservas: cierre 0 %, por reserva no se calcula', () => {
    const k = computeMarketingKpis(
      { reservations: 0, guests: 0, billableGuests: 0 },
      row({ adSpendUsdCents: 4500, messages: 9 }),
    )
    expect(reason(k.costPerReservationUsd)).toBe('cero-reservas')
    expect(value(k.closingRate)).toBe(0)
  })

  it('cero-personas: por persona y facturación por persona', () => {
    const k = computeMarketingKpis(
      { reservations: 0, guests: 0, billableGuests: 0 },
      row({ revenueArsCents: 100_000_00, usdArsRate: 1000 }),
    )
    expect(reason(k.costPerGuestUsd)).toBe('cero-personas')
    expect(reason(k.revenuePerGuestArs)).toBe('cero-personas')
  })

  it('el «por persona» del retorno se divide por la gente del cálculo', () => {
    // Si se dividiera por lo reservado, la misma ficha diría "$ 27.000 por
    // persona" arriba y "$ 25.258 por persona" abajo.
    const k = computeMarketingKpis(RAMEN, { ...RAMEN_ROW, revenueArsCents: 783_000_00 })
    expect(formatArs(value(k.revenuePerGuestArs))).toBe(nb('$ 27.000'))
    expect(formatArs(value(k.revenuePerGuestArs))).toBe(formatArs(783_000 / RAMEN.billableGuests))
  })

  it('sin-alcance: alcance null o 0', () => {
    for (const reach of [null, 0]) {
      const k = computeMarketingKpis(ASTRAL, row({ reach }))
      expect(reason(k.costPerThousandReachedUsd)).toBe('sin-alcance')
      expect(reason(k.replyRate)).toBe('sin-alcance')
    }
  })

  it('sin-facturacion: sin facturación cargada', () => {
    const k = computeMarketingKpis(ASTRAL, row())
    for (const key of [
      'spendArs',
      'revenueUsd',
      'returnPerDollar',
      'adShareOfRevenue',
      'revenuePerGuestArs',
    ] as const) {
      expect(reason(k[key])).toBe('sin-facturacion')
    }
  })
})

// ─── La cuenta de la noche ───────────────────────────────────────────────────

describe('computeMarketingKpis: la cuenta de la noche', () => {
  it('el ejemplo del dueño, número por número', () => {
    // 29 personas a $ 27.000 de ingreso y $ 15.000 de costo, con US$ 175,26 de
    // pauta a $ 1.450.
    const k = computeMarketingKpis(RAMEN, RAMEN_ROW)
    expect(formatArs(value(k.revenueArs))).toBe(nb('$ 783.000'))
    expect(formatArs(value(k.costArs))).toBe(nb('$ 435.000'))
    expect(formatArs(value(k.grossMarginArs))).toBe(nb('$ 348.000'))
    expect(formatArs(value(k.adSpendArs))).toBe(nb('$ 254.127'))
    expect(formatArs(value(k.nightResultArs))).toBe(nb('$ 93.873'))
    expect(formatArs(value(k.marginPerGuestArs))).toBe(nb('$ 12.000'))
    expect(formatArs(value(k.resultPerGuestArs))).toBe(nb('$ 3.237'))
    expect(value(k.guestsToCoverAds)).toBe(22)
  })

  it('multiplica por la gente del cálculo, no por lo reservado', () => {
    // Reservaron 31 y la cuenta va con 29: $ 783.000, no $ 837.000.
    const k = computeMarketingKpis(RAMEN, RAMEN_ROW)
    expect(value(k.revenueArs)).toBe(29 * 27_000)
    expect(value(k.revenueArs)).not.toBe(RAMEN.guests * 27_000)
  })

  it('la facturación real manda sobre el estimado por persona', () => {
    const k = computeMarketingKpis(RAMEN, { ...RAMEN_ROW, revenueArsCents: 900_000_00 })
    expect(formatArs(value(k.revenueArs))).toBe(nb('$ 900.000'))
    expect(formatArs(value(k.grossMarginArs))).toBe(nb('$ 465.000'))
    expect(formatArs(value(k.nightResultArs))).toBe(nb('$ 210.873'))
  })

  it('sin pauta el resultado es el margen bruto, y el dólar no hace falta', () => {
    const k = computeMarketingKpis(RAMEN, {
      ...RAMEN_ROW,
      adSpendUsdCents: 0,
      usdArsRate: null,
    })
    expect(value(k.adSpendArs)).toBe(0)
    expect(formatArs(value(k.nightResultArs))).toBe(nb('$ 348.000'))
    // Nada que cubrir: no se pide gente para cubrir una pauta que no existe.
    expect(reason(k.guestsToCoverAds)).toBe('sin-pauta')
  })

  it('sin dólar no se puede descontar la pauta, pero el margen sale igual', () => {
    const k = computeMarketingKpis(RAMEN, { ...RAMEN_ROW, usdArsRate: null })
    expect(formatArs(value(k.grossMarginArs))).toBe(nb('$ 348.000'))
    expect(reason(k.adSpendArs)).toBe('sin-dolar')
    expect(reason(k.nightResultArs)).toBe('sin-dolar')
    expect(reason(k.resultPerGuestArs)).toBe('sin-dolar')
    expect(reason(k.guestsToCoverAds)).toBe('sin-dolar')
    // El margen por persona no depende de la pauta: sigue saliendo.
    expect(formatArs(value(k.marginPerGuestArs))).toBe(nb('$ 12.000'))
  })

  it('sin ingreso por persona y sin costo por persona, cada uno con su motivo', () => {
    const sinIngreso = computeMarketingKpis(RAMEN, {
      ...RAMEN_ROW,
      revenuePerGuestArsCents: null,
    })
    expect(reason(sinIngreso.revenueArs)).toBe('sin-ingreso-por-persona')
    expect(reason(sinIngreso.grossMarginArs)).toBe('sin-ingreso-por-persona')
    expect(reason(sinIngreso.nightResultArs)).toBe('sin-ingreso-por-persona')
    expect(formatArs(value(sinIngreso.costArs))).toBe(nb('$ 435.000'))

    const sinCosto = computeMarketingKpis(RAMEN, { ...RAMEN_ROW, costPerGuestArsCents: null })
    expect(reason(sinCosto.costArs)).toBe('sin-costo-por-persona')
    expect(reason(sinCosto.grossMarginArs)).toBe('sin-costo-por-persona')
    expect(formatArs(value(sinCosto.revenueArs))).toBe(nb('$ 783.000'))
  })

  it('sin nadie sentado no hay cuenta que hacer', () => {
    const k = computeMarketingKpis({ reservations: 0, guests: 0, billableGuests: 0 }, RAMEN_ROW)
    expect(reason(k.revenueArs)).toBe('cero-personas')
    expect(reason(k.costArs)).toBe('cero-personas')
    expect(reason(k.marginPerGuestArs)).toBe('cero-personas')
  })

  it('un margen que no alcanza: no hay cantidad de gente que cubra la pauta', () => {
    const k = computeMarketingKpis(RAMEN, {
      ...RAMEN_ROW,
      revenuePerGuestArsCents: 15_000_00,
    })
    expect(value(k.grossMarginArs)).toBe(0)
    expect(reason(k.guestsToCoverAds)).toBe('sin-margen')
    expect(value(k.nightResultArs)).toBeCloseTo(-254_127, 6)
  })

  it('la gente para cubrir la pauta se redondea hacia arriba', () => {
    // Con 21,2 personas la pauta todavía no está cubierta: son 22.
    expect(value(computeMarketingKpis(RAMEN, RAMEN_ROW).guestsToCoverAds)).toBe(22)
    // Y un cociente exacto no se pasa de rosca: $ 240.000 ÷ $ 12.000 son 20.
    const exacto = computeMarketingKpis(RAMEN, { ...RAMEN_ROW, adSpendUsdCents: 165_51 })
    expect(formatArs(value(exacto.adSpendArs))).toBe(nb('$ 239.990'))
    expect(value(exacto.guestsToCoverAds)).toBe(20)
  })

  it('«no tuvo pauta» sigue sin calcular nada de la pauta', () => {
    const k = computeMarketingKpis(RAMEN, {
      ...RAMEN_ROW,
      adSpendUsdCents: 0,
      messages: null,
    })
    expect(reason(k.costPerReservationUsd)).toBe('sin-pauta')
    expect(reason(k.closingRate)).toBe('sin-pauta')
    // Pero la plata de la noche sí: no la manda la pauta.
    expect(value(k.grossMarginArs)).toBe(348_000)
  })
})

describe('nightResultReport', () => {
  it('el ejemplo del dueño, leído como reporte', () => {
    const r = nightResultReport(RAMEN, RAMEN_ROW)
    expect(r?.math).toBe(
      nb(
        '29 personas × $ 27.000 = $ 783.000 · costo $ 435.000 · margen $ 348.000 · pauta $ 254.127 → quedan $ 93.873',
      ),
    )
    expect(r?.headline).toBe(nb('La noche dejó $ 93.873.'))
    expect(r?.negative).toBe(false)
    expect(r?.perGuest).toBe(nb('Cada persona dejó $ 12.000 y la pauta se cubrió con 22 personas.'))
    expect(r?.perGuestAfterAds).toBe(nb('Después de la pauta quedaron $ 3.237 por persona.'))
    expect(r?.basis).toBe('Se calculó con 29 personas: 27 contadas y 2 de mesas sin cerrar.')
    expect(r?.missing).toBeNull()
    expect(r?.revenueNote).toBeNull()
    expect(r?.disclaimer).toBe(NIGHT_RESULT_DISCLAIMER)
  })

  it('la cuenta viene en pedazos, para poder resaltar los números', () => {
    const r = nightResultReport(RAMEN, RAMEN_ROW)
    expect(r?.steps).toEqual([
      { before: nb('29 personas × $ 27.000 = '), value: nb('$ 783.000'), after: '' },
      { before: 'costo ', value: nb('$ 435.000'), after: '' },
      { before: 'margen ', value: nb('$ 348.000'), after: '' },
      { before: 'pauta ', value: nb('$ 254.127'), after: '' },
    ])
    expect(r?.result).toEqual({ before: 'quedan ', value: nb('$ 93.873'), after: '' })
  })

  it('el disclaimer no es negociable', () => {
    expect(NIGHT_RESULT_DISCLAIMER).toBe(
      'No es la ganancia del bar: no descuenta sueldos, alquiler ni impuestos.',
    )
  })

  it('si da negativo se dice en palabras, nunca un número en rojo suelto', () => {
    const perdida = nightResultReport(RAMEN, {
      ...RAMEN_ROW,
      revenuePerGuestArsCents: 12_000_00,
    })
    // Margen: 29 × ($ 12.000 − $ 15.000) = $ 87.000 abajo. Menos la pauta,
    // $ 341.127 abajo.
    expect(perdida?.headline).toBe(nb('La noche quedó $ 341.127 abajo.'))
    expect(perdida?.negative).toBe(true)
    expect(perdida?.math).toBe(
      nb(
        '29 personas × $ 12.000 = $ 348.000 · costo $ 435.000 · margen $ 87.000 abajo · pauta $ 254.127 → la noche quedó $ 341.127 abajo',
      ),
    )
    expect(perdida?.perGuest).toBe(nb('Cada persona costó $ 3.000 más de lo que dejó.'))
    expect(perdida?.perGuestAfterAds).toBe(
      nb('Después de la pauta, cada persona quedó $ 11.763 abajo.'),
    )
    // Ni un solo número con signo menos adelante.
    expect(`${perdida?.headline} ${perdida?.math}`).not.toMatch(/-\s?\$/)
  })

  it('la pauta que no se cubrió se dice al revés', () => {
    const r = nightResultReport(RAMEN, { ...RAMEN_ROW, revenuePerGuestArsCents: 17_000_00 })
    // $ 2.000 de margen por persona contra $ 254.127 de pauta: 128 personas.
    expect(r?.perGuest).toBe(
      nb('Cada persona dejó $ 2.000 y para cubrir la pauta hacían falta 128 personas.'),
    )
  })

  it('la facturación real manda como ingreso, y el texto lo dice', () => {
    const r = nightResultReport(RAMEN, { ...RAMEN_ROW, revenueArsCents: 900_000_00 })
    expect(r?.steps[0]).toEqual({ before: 'facturación ', value: nb('$ 900.000'), after: '' })
    expect(r?.revenueNote).toBe(
      nb(
        'El ingreso es la facturación real de la caja: manda sobre los $ 27.000 por persona, que daban $ 783.000.',
      ),
    )
    expect(r?.headline).toBe(nb('La noche dejó $ 210.873.'))
  })

  it('el ingreso por persona con centavos se muestra con centavos: el «=» tiene que cerrar', () => {
    // $ 27.500,50 es un valor que el campo acepta y le devuelve escrito al
    // dueño. Redondeado a pesos, la pantalla decía «× $ 27.501» al lado de un
    // total calculado con los centavos: 29 × 27.501 no es $ 797.515.
    const r = nightResultReport(RAMEN, { ...RAMEN_ROW, revenuePerGuestArsCents: 2_750_050 })
    expect(r?.steps[0]).toEqual({
      before: nb('29 personas × $ 27.500,50 = '),
      value: nb('$ 797.515'),
      after: '',
    })
    const conFacturacion = nightResultReport(RAMEN, {
      ...RAMEN_ROW,
      revenuePerGuestArsCents: 2_750_050,
      revenueArsCents: 900_000_00,
    })
    expect(conFacturacion?.revenueNote).toBe(
      nb(
        'El ingreso es la facturación real de la caja: manda sobre los $ 27.500,50 por persona, que daban $ 797.515.',
      ),
    )
  })

  it('sin gente, el estimado por persona no «daba $ 0»: no daba nada', () => {
    // Una fecha cuyas reservas se cayeron todas pero que igual facturó por la
    // gente que entró sin reservar. El motor dice `cero-personas` en vez de
    // calcular; el aviso no puede publicar un cero que el motor no calcula.
    const r = nightResultReport(
      { reservations: 0, guests: 0, billableGuests: 0, attendedGuests: 0 },
      { ...RAMEN_ROW, revenueArsCents: 900_000_00 },
    )
    expect(r?.headline).toBe(nb('El ingreso de la noche fue $ 900.000.'))
    expect(r?.revenueNote).toBe('El ingreso es la facturación real de la caja.')
  })

  it('con facturación y sin ingreso por persona, el aviso es más corto', () => {
    const r = nightResultReport(RAMEN, {
      ...RAMEN_ROW,
      revenueArsCents: 900_000_00,
      revenuePerGuestArsCents: null,
    })
    expect(r?.revenueNote).toBe('El ingreso es la facturación real de la caja.')
  })

  it('sin dólar muestra el margen bruto y avisa que falta', () => {
    const r = nightResultReport(RAMEN, { ...RAMEN_ROW, usdArsRate: null })
    expect(r?.math).toBe(
      nb('29 personas × $ 27.000 = $ 783.000 · costo $ 435.000 · margen $ 348.000'),
    )
    expect(r?.result).toBeNull()
    expect(r?.headline).toBe(nb('El margen de la noche fue $ 348.000.'))
    expect(r?.missing).toBe(
      'Falta el dólar del día para pasar la pauta a pesos: por ahora, esto es el margen bruto.',
    )
    expect(r?.perGuest).toBe(nb('Cada persona dejó $ 12.000.'))
    expect(r?.perGuestAfterAds).toBeNull()
  })

  it('sin pauta no hay nada que descontar: el resultado es el margen, y lo dice', () => {
    const r = nightResultReport(RAMEN, {
      ...RAMEN_ROW,
      adSpendUsdCents: 0,
      messages: null,
      usdArsRate: null,
    })
    // «sin pauta» en palabras: si no, «margen $ X → quedan $ X» parece una
    // resta a la que le falta un número.
    expect(r?.math).toBe(
      nb(
        '29 personas × $ 27.000 = $ 783.000 · costo $ 435.000 · margen $ 348.000 · sin pauta → quedan $ 348.000',
      ),
    )
    expect(r?.headline).toBe(nb('La noche dejó $ 348.000.'))
    expect(r?.missing).toBeNull()
    expect(r?.perGuest).toBe(nb('Cada persona dejó $ 12.000.'))
    // No hay «después de la pauta»: no hubo pauta.
    expect(r?.perGuestAfterAds).toBeNull()
  })

  it('Ratatouille, la noche orgánica del dueño: dejó $ 854.400', () => {
    const r = nightResultReport(RATATOUILLE, ORGANIC_ROW)
    expect(r?.headline).toBe(nb('La noche dejó $ 854.400.'))
    expect(r?.math).toBe(
      nb(
        '48 personas × $ 25.000 = $ 1.200.000 · costo $ 345.600 · margen $ 854.400 · sin pauta → quedan $ 854.400',
      ),
    )
    expect(r?.perGuest).toBe(nb('Cada persona dejó $ 17.800.'))
    // 48 contadas al cerrar las mesas, no las 54 reservadas: se dice.
    expect(r?.basis).toBe(
      'Se calculó con 48 personas contadas al cerrar las mesas, no con las 54 reservadas.',
    )
    // Una noche orgánica que todavía no pasó habla en «por ahora».
    expect(nightResultReport(RATATOUILLE, ORGANIC_ROW, 'future')?.headline).toBe(
      nb('Por ahora la noche va dejando $ 854.400.'),
    )
  })

  it('sin pauta, la facturación sola ya abre la cuenta (no hay «Retorno» que la muestre)', () => {
    const soloCaja = row({ adSpendUsdCents: 0, messages: null, revenueArsCents: 1_000_000_00 })
    expect(hasNightAccount(soloCaja)).toBe(true)
    const r = nightResultReport(RATATOUILLE, soloCaja)
    expect(r?.headline).toBe(nb('El ingreso de la noche fue $ 1.000.000.'))
    expect(r?.missing).toBe('Falta el costo por persona para sacar el resultado de la noche.')
    // Con pauta, la facturación sola sigue siendo del «Retorno» (las fechas viejas no cambian).
    expect(hasNightAccount(row({ revenueArsCents: 1_000_000_00, usdArsRate: 1450 }))).toBe(false)
    // Marcada «No tuvo pauta» y nada más: no hay cuenta.
    expect(hasNightAccount(row({ adSpendUsdCents: 0, messages: null }))).toBe(false)
  })

  it('a medio cargar: dice lo que ya da y qué falta', () => {
    const sinCosto = nightResultReport(RAMEN, { ...RAMEN_ROW, costPerGuestArsCents: null })
    expect(sinCosto?.headline).toBe(nb('El ingreso de la noche fue $ 783.000.'))
    expect(sinCosto?.math).toBe(nb('29 personas × $ 27.000 = $ 783.000'))
    expect(sinCosto?.missing).toBe(
      'Falta el costo por persona para sacar el resultado de la noche.',
    )

    const sinIngreso = nightResultReport(RAMEN, { ...RAMEN_ROW, revenuePerGuestArsCents: null })
    expect(sinIngreso?.headline).toBe(nb('El costo de la noche fue $ 435.000.'))
    expect(sinIngreso?.missing).toBe(
      'Falta el ingreso por persona para sacar el resultado de la noche.',
    )
  })

  it('la cuenta existe si hay ingreso o costo por persona, y no antes', () => {
    expect(nightResultReport(RAMEN, row())).toBeNull()
    // Basta uno de los dos: la cuenta se dibuja a medio hacer y dice qué falta.
    expect(nightResultReport(RAMEN, row({ revenuePerGuestArsCents: 27_000_00 }))).not.toBeNull()
    expect(nightResultReport(RAMEN, row({ costPerGuestArsCents: 15_000_00 }))).not.toBeNull()
  })

  it('una fecha vieja —facturación y dólar— se sigue viendo como se veía', () => {
    // Las doce fechas que ya estaban cargadas cuando llegó esta pantalla no
    // tienen ingreso ni costo por persona. Si la facturación sola prendiera la
    // sección, a las doce les aparecería una cuenta que repite la facturación
    // que «Retorno» ya muestra y que encima reclama en ámbar un dato que nadie
    // les pidió.
    expect(nightResultReport(ASTRAL, ASTRAL_FULL)).toBeNull()
    expect(howItsCalculated(ASTRAL_FULL).some((b) => b.startsWith('Resultado de la noche'))).toBe(
      false,
    )
    // Y en cuanto el dueño carga el costo, la misma fecha sí tiene cuenta: la
    // facturación real manda como ingreso.
    const conCosto = nightResultReport(ASTRAL, {
      ...ASTRAL_FULL,
      costPerGuestArsCents: 15_000_00,
    })
    expect(conCosto?.headline).toBe(nb('La noche dejó $ 1.790.873.'))
  })

  it('sin nadie sentado, la cuenta no se inventa', () => {
    const r = nightResultReport({ reservations: 0, guests: 0, billableGuests: 0 }, RAMEN_ROW)
    expect(r?.headline).toBeNull()
    expect(r?.steps).toEqual([])
    expect(r?.math).toBe('')
    expect(r?.basis).toBeNull()
    expect(r?.missing).toBe(
      'No quedó ninguna reserva en pie: no hay gente con la que hacer la cuenta.',
    )
  })

  it('cuando la gente del cálculo es la reservada, no hace falta explicar nada', () => {
    const r = nightResultReport(
      { reservations: 12, guests: 29, billableGuests: 29, attendedGuests: 29 },
      RAMEN_ROW,
    )
    expect(r?.basis).toBeNull()
  })

  it('las otras formas de explicar con qué gente se calculó', () => {
    const todasCerradas = nightResultReport(
      { reservations: 12, guests: 31, billableGuests: 29, attendedGuests: 29 },
      RAMEN_ROW,
    )
    expect(todasCerradas?.basis).toBe(
      'Se calculó con 29 personas contadas al cerrar las mesas, no con las 31 reservadas.',
    )
    // Sin saber cuántas se contaron (el bloque no lo trae), se explica largo.
    const sinDato = nightResultReport(
      { reservations: 12, guests: 31, billableGuests: 29 },
      RAMEN_ROW,
    )
    expect(sinDato?.basis).toBe(
      'Se calculó con 29 personas: lo contado al cerrar cada mesa y lo reservado en las que quedaron sin cerrar.',
    )
  })

  it('una noche chica también concuerda en singular', () => {
    // Una mesa cerrada con 1 y otra sin cerrar de 1.
    const mixta = nightResultReport(
      { reservations: 2, guests: 3, billableGuests: 2, attendedGuests: 1 },
      RAMEN_ROW,
    )
    expect(mixta?.basis).toBe('Se calculó con 2 personas: 1 contada y 1 de mesas sin cerrar.')
    // Dos reservas de 1, las dos cerradas, una sin nadie sentado.
    const unaSola = nightResultReport(
      { reservations: 2, guests: 2, billableGuests: 1, attendedGuests: 1 },
      RAMEN_ROW,
    )
    expect(unaSola?.basis).toBe(
      'Se calculó con 1 persona contada al cerrar las mesas, no con las 2 reservadas.',
    )
    // Una reserva de 1 que cerró con 3.
    const crecio = nightResultReport(
      { reservations: 1, guests: 1, billableGuests: 3, attendedGuests: 3 },
      RAMEN_ROW,
    )
    expect(crecio?.basis).toBe(
      'Se calculó con 3 personas contadas al cerrar las mesas, no con la 1 reservada.',
    )
  })

  it('hoy y lo futuro hablan en presente: nada "quedó" todavía', () => {
    const hoy = nightResultReport(RAMEN, RAMEN_ROW, 'tonight')
    expect(hoy?.headline).toBe(nb('Por ahora la noche va dejando $ 93.873.'))
    expect(hoy?.math).toMatch(/→ por ahora quedan/)
    const futura = nightResultReport(
      RAMEN,
      { ...RAMEN_ROW, revenuePerGuestArsCents: 12_000_00 },
      'future',
    )
    expect(futura?.headline).toBe(nb('Por ahora la noche va $ 341.127 abajo.'))
  })

  it('«¿Cómo se calcula?» explica la cuenta solo cuando hay algo que explicar', () => {
    expect(howItsCalculated(row()).some((b) => b.startsWith('Resultado de la noche'))).toBe(false)
    const bullets = howItsCalculated(RAMEN_ROW)
    expect(bullets.some((b) => b.startsWith('Resultado de la noche'))).toBe(true)
    expect(bullets).toContain(NIGHT_RESULT_DISCLAIMER)
    // Y avisa que la gente de la cuenta no es la que divide la pauta.
    expect(bullets.some((b) => b.includes('puede no coincidir con las personas reservadas'))).toBe(
      true,
    )
  })
})

// ─── Textos de la ficha ──────────────────────────────────────────────────────

describe('marketingSentence', () => {
  it('base', () => {
    expect(marketingSentence(ASTRAL, row(), 'past')).toBe(
      nb(
        'Pusimos US$ 175,26 en pauta, llegaron 51 mensajes y quedaron 11 reservas en pie (29 personas).',
      ),
    )
  })

  it('mensajes sin cargar', () => {
    expect(marketingSentence(ASTRAL, row({ messages: null }), 'past')).toBe(
      nb('Pusimos US$ 175,26 en pauta. Faltan cargar los mensajes.'),
    )
  })

  it('cero mensajes, con y sin reservas', () => {
    const r = row({ adSpendUsdCents: 4500, messages: 0 })
    expect(marketingSentence({ reservations: 3, guests: 8, billableGuests: 8 }, r, 'past')).toBe(
      nb(
        'Pusimos US$ 45,00 en pauta y no escribió nadie. Quedaron 3 reservas en pie (8 personas).',
      ),
    )
    expect(marketingSentence({ reservations: 0, guests: 0, billableGuests: 0 }, r, 'past')).toBe(
      nb('Pusimos US$ 45,00 en pauta, no escribió nadie y no quedó ninguna reserva en pie.'),
    )
  })

  it('mensajes y ninguna reserva', () => {
    expect(
      marketingSentence(
        { reservations: 0, guests: 0, billableGuests: 0 },
        row({ adSpendUsdCents: 4500, messages: 9 }),
        'past',
      ),
    ).toBe(nb('Pusimos US$ 45,00 en pauta, llegaron 9 mensajes y no quedó ninguna reserva en pie.'))
  })

  it('singulares', () => {
    expect(
      marketingSentence(
        { reservations: 1, guests: 1, billableGuests: 1 },
        row({ adSpendUsdCents: 4500, messages: 1 }),
        'past',
      ),
    ).toBe(nb('Pusimos US$ 45,00 en pauta, llegó 1 mensaje y quedó 1 reserva en pie (1 persona).'))
  })

  it('Por ahora: hoy y lo futuro cambian «quedaron» por «hay»', () => {
    expect(
      marketingSentence(
        { reservations: 3, guests: 8, billableGuests: 8 },
        row({ adSpendUsdCents: 6000, messages: 12 }),
        'future',
      ),
    ).toBe(
      nb(
        'Por ahora: pusimos US$ 60,00 en pauta, llegaron 12 mensajes y hay 3 reservas en pie (8 personas).',
      ),
    )
    expect(
      marketingSentence(
        { reservations: 0, guests: 0, billableGuests: 0 },
        row({ adSpendUsdCents: 4500, messages: 9 }),
        'tonight',
      ),
    ).toBe(
      nb(
        'Por ahora: pusimos US$ 45,00 en pauta, llegaron 9 mensajes y no hay ninguna reserva en pie.',
      ),
    )
    expect(
      marketingSentence(
        { reservations: 3, guests: 8, billableGuests: 8 },
        row({ adSpendUsdCents: 4500, messages: 0 }),
        'tonight',
      ),
    ).toBe(
      nb(
        'Por ahora: pusimos US$ 45,00 en pauta y no escribió nadie. Hay 3 reservas en pie (8 personas).',
      ),
    )
    expect(marketingSentence(ASTRAL, row({ messages: null }), 'future')).toBe(
      nb('Por ahora: pusimos US$ 175,26 en pauta. Faltan cargar los mensajes.'),
    )
  })
})

describe('returnSentence y returnDetails', () => {
  it('el ejemplo del dueño', () => {
    expect(returnSentence(computeMarketingKpis(ASTRAL, ASTRAL_FULL))).toEqual({
      lead: nb('Por cada US$ 1 de pauta, el evento facturó US$ 9,76.'),
      warning: null,
    })
    expect(returnDetails(ASTRAL, ASTRAL_FULL)).toEqual([
      { before: 'Facturación ', value: nb('$ 2.480.000'), after: '' },
      { before: 'Pauta en pesos ', value: nb('$ 254.127'), after: nb(' (dólar $ 1.450)') },
      { before: 'La pauta fue el ', value: nb('10,2 %'), after: ' de lo facturado' },
      { before: '', value: nb('$ 85.517'), after: ' por persona' },
    ])
  })

  it('facturó menos de lo que costó: la única alerta es aritmética', () => {
    const r = row({ adSpendUsdCents: 10000, revenueArsCents: 80_000_00, usdArsRate: 1000 })
    expect(returnSentence(computeMarketingKpis(ASTRAL, r))).toEqual({
      lead: nb('Por cada US$ 1 de pauta, el evento facturó US$ 0,80:'),
      warning: 'menos de lo que costó la pauta.',
    })
  })

  it('se decide con lo que se lee: US$ 0,999 dice US$ 1,00 y no alerta', () => {
    const r = row({ adSpendUsdCents: 10000, revenueArsCents: 99_900_00, usdArsRate: 1000 })
    expect(returnSentence(computeMarketingKpis(ASTRAL, r))).toEqual({
      lead: nb('Por cada US$ 1 de pauta, el evento facturó US$ 1,00.'),
      warning: null,
    })
  })

  it('sin facturación no hay recuadro', () => {
    expect(returnSentence(computeMarketingKpis(ASTRAL, row()))).toBeNull()
    expect(returnDetails(ASTRAL, row())).toEqual([])
  })

  it('cuando la gente del cálculo no es la reservada, el «por persona» dice cuál es', () => {
    // 09/09 de verdad: 29 reservadas y 27 contadas al cerrar las once mesas. La
    // oración de arriba de la ficha muestra las 29; sin nombrar la base, el
    // dueño divide 2.480.000 ÷ 29 y no le da. Y con la facturación sola no hay
    // «cuenta de la noche» que lo explique en otra línea.
    const real = { reservations: 11, guests: 29, billableGuests: 27, attendedGuests: 27 }
    expect(returnDetails(real, ASTRAL_FULL).at(-1)).toEqual({
      before: '',
      value: nb('$ 91.852'),
      after: ' por cada una de las 27 personas que consumieron',
    })
    // Y el bullet que explica qué gente es aparece aunque no haya cuenta.
    expect(
      howItsCalculated(ASTRAL_FULL).some((b) =>
        b.includes('puede no coincidir con las personas reservadas'),
      ),
    ).toBe(true)
  })

  it('una sola persona no se dice «cada una de las 1»', () => {
    const solo = { reservations: 2, guests: 4, billableGuests: 1, attendedGuests: 1 }
    expect(returnDetails(solo, ASTRAL_FULL).at(-1)).toEqual({
      before: '',
      value: nb('$ 2.480.000'),
      after: ' por la única persona que consumió',
    })
  })
})

describe('kpiHint (§8.4)', () => {
  const NO = 'No se puede calcular:'

  it('las tres fichas del ejemplo', () => {
    expect(kpiHint('costPerMessage', ASTRAL, row())).toEqual({
      value: nb('US$ 3,44'),
      hint: nb('US$ 175,26 ÷ 51 mensajes'),
      srReason: null,
    })
    expect(kpiHint('closingRate', ASTRAL, row())).toEqual({
      value: nb('21,6 %'),
      hint: '11 reservas en pie de 51 mensajes',
      srReason: null,
    })
    expect(kpiHint('costPerReservation', ASTRAL, row())).toEqual({
      value: nb('US$ 15,93'),
      hint: nb('US$ 175,26 ÷ 11 reservas en pie'),
      srReason: null,
    })
  })

  it('mensajes sin cargar y en cero', () => {
    const missing = row({ messages: null })
    expect(kpiHint('costPerMessage', ASTRAL, missing)).toEqual({
      value: null,
      hint: 'faltan cargar los mensajes',
      srReason: NO,
    })
    expect(kpiHint('closingRate', ASTRAL, missing)).toEqual({
      value: null,
      hint: 'faltan cargar los mensajes',
      srReason: NO,
    })
    const zero = row({ messages: 0 })
    expect(kpiHint('costPerMessage', ASTRAL, zero)).toEqual({
      value: null,
      hint: 'no escribió nadie',
      srReason: NO,
    })
    expect(kpiHint('closingRate', ASTRAL, zero)).toEqual({
      value: null,
      hint: 'sin mensajes no hay cierre',
      srReason: NO,
    })
  })

  it('ninguna reserva: 0 % de cierre y por reserva no se calcula', () => {
    const empty = { reservations: 0, guests: 0, billableGuests: 0 }
    expect(kpiHint('closingRate', empty, row())).toEqual({
      value: nb('0 %'),
      hint: 'ninguna reserva en pie de 51 mensajes',
      srReason: null,
    })
    expect(kpiHint('costPerReservation', empty, row())).toEqual({
      value: null,
      hint: 'no quedó ninguna reserva en pie',
      srReason: NO,
    })
  })

  it('más reservas que mensajes', () => {
    expect(
      kpiHint(
        'closingRate',
        { reservations: 14, guests: 30, billableGuests: 30 },
        row({ messages: 9 }),
      ),
    ).toEqual({
      value: null,
      hint: '14 reservas en pie y 9 mensajes: parte llegó por otro lado',
      srReason: NO,
    })
  })

  it('singulares', () => {
    const one = { reservations: 1, guests: 1, billableGuests: 1 }
    const r = row({ adSpendUsdCents: 4500, messages: 1 })
    expect(kpiHint('costPerMessage', one, r).hint).toBe(nb('US$ 45,00 ÷ 1 mensaje'))
    expect(kpiHint('closingRate', one, r).hint).toBe('1 reserva en pie de 1 mensaje')
    expect(kpiHint('costPerReservation', one, r).hint).toBe(nb('US$ 45,00 ÷ 1 reserva en pie'))
  })
})

describe('fichaItems', () => {
  it('con todo: por persona, alcance, cada 1.000 y escribió', () => {
    expect(fichaItems(ASTRAL, ASTRAL_FULL)).toEqual([
      { label: 'Por persona', value: nb('US$ 6,04') },
      { label: 'Alcance', value: '8.420' },
      { label: 'Cada 1.000 alcanzados', value: nb('US$ 20,81') },
      { label: 'Escribió', value: nb('0,6 % (6 de cada 1.000)') },
    ])
  })

  it('sin alcance no va nada del alcance; sin gente no va por persona', () => {
    expect(fichaItems(ASTRAL, row())).toEqual([{ label: 'Por persona', value: nb('US$ 6,04') }])
    expect(fichaItems({ reservations: 0, guests: 0, billableGuests: 0 }, row())).toEqual([])
  })

  it('con alcance y sin mensajes, no hay «Escribió»', () => {
    expect(fichaItems(ASTRAL, row({ reach: 8420, messages: null })).map((i) => i.label)).toEqual([
      'Por persona',
      'Alcance',
      'Cada 1.000 alcanzados',
    ])
  })
})

describe('previewLines', () => {
  it('el ejemplo del dueño, como en el smoke', () => {
    expect(
      previewLines(ASTRAL, {
        adSpendUsd: 175.26,
        messages: 51,
        reach: null,
        revenueArs: null,
        usdArsRate: null,
      }),
    ).toEqual([
      { text: nb('US$ 3,44 por mensaje · Comparalo con «Costo por resultado» en Meta.') },
      { text: nb('21,6 % de cierre · 11 reservas en pie de 51 mensajes') },
      { text: nb('US$ 15,93 por reserva · US$ 6,04 por persona') },
    ])
  })

  it('lo que falta se ve como —, nunca como 0', () => {
    const lines = previewLines(ASTRAL, {
      adSpendUsd: null,
      messages: null,
      reach: null,
      revenueArs: null,
      usdArsRate: null,
    }).map((l) => l.text)
    expect(lines[0]).toBe('— por mensaje · Comparalo con «Costo por resultado» en Meta.')
    expect(lines[1]).toMatch(/^— de cierre/)
    expect(lines[2]).toBe('— por reserva · — por persona')
  })

  it('más reservas que mensajes, en palabras', () => {
    const lines = previewLines(
      { reservations: 14, guests: 30, billableGuests: 30 },
      { adSpendUsd: 80, messages: 9, reach: null, revenueArs: null, usdArsRate: null },
    )
    expect(lines[1]?.text).toBe(
      '— de cierre · 14 reservas en pie y 9 mensajes: parte llegó por otro lado',
    )
  })

  it('la cuenta de la noche aparece recién cuando se toca uno de los dos campos', () => {
    const sinTocar = previewLines(RAMEN, {
      adSpendUsd: 175.26,
      messages: 51,
      reach: null,
      revenueArs: null,
      usdArsRate: 1450,
    })
    expect(sinTocar).toHaveLength(3)

    // Ni siquiera con la facturación cargada: es la regla 13, y la decide
    // `nightResultReport`, no una copia de la condición acá adentro.
    const conFacturacion = previewLines(RAMEN, {
      adSpendUsd: 175.26,
      messages: 51,
      reach: null,
      revenueArs: 2_480_000,
      usdArsRate: 1450,
    })
    expect(conFacturacion).toHaveLength(3)

    const completa = previewLines(RAMEN, {
      adSpendUsd: 175.26,
      messages: 51,
      reach: null,
      revenueArs: null,
      usdArsRate: 1450,
      revenuePerGuestArs: 27_000,
      costPerGuestArs: 15_000,
    })
    expect(completa).toHaveLength(4)
    // Lo mismo que va a decir la ficha después de guardar: el preview no tiene
    // aritmética propia.
    expect(completa[3]?.text).toBe(nightResultReport(RAMEN, RAMEN_ROW)?.math)
  })

  it('a medio cargar, el preview dice lo que ya da y qué falta', () => {
    const lines = previewLines(RAMEN, {
      adSpendUsd: 175.26,
      messages: 51,
      reach: null,
      revenueArs: null,
      usdArsRate: 1450,
      revenuePerGuestArs: 27_000,
      costPerGuestArs: null,
    })
    expect(lines[3]?.text).toBe(
      nb(
        '29 personas × $ 27.000 = $ 783.000 · Falta el costo por persona para sacar el resultado de la noche.',
      ),
    )
  })

  it('con la pauta todavía vacía no se muestra un resultado que la ignora', () => {
    const lines = previewLines(RAMEN, {
      adSpendUsd: null,
      messages: null,
      reach: null,
      revenueArs: null,
      usdArsRate: 1450,
      revenuePerGuestArs: 27_000,
      costPerGuestArs: 15_000,
    })
    expect(lines[3]?.text).toBe(
      nb(
        '29 personas × $ 27.000 = $ 783.000 · costo $ 435.000 · margen $ 348.000 · falta la pauta para cerrar la cuenta',
      ),
    )
  })

  it('un 0 en Gastado es «no hubo pauta»: cierra la cuenta con «sin pauta» dicho', () => {
    // Antes el 0 lo rechazaba el schema y la previa lo trataba como vacío. Desde
    // que una noche orgánica guarda su plata, el 0 es un dato: la previa tiene
    // que decir lo mismo que la ficha va a decir después de guardar.
    const base = {
      messages: null,
      reach: null,
      revenueArs: null,
      usdArsRate: null,
      revenuePerGuestArs: 27_000,
      costPerGuestArs: 15_000,
    }
    const esperado = [
      'Sin pauta · no hay costo por mensaje, cierre ni costo por reserva.',
      nb(
        '29 personas × $ 27.000 = $ 783.000 · costo $ 435.000 · margen $ 348.000 · sin pauta → quedan $ 348.000',
      ),
    ]
    expect(previewLines(RAMEN, { ...base, adSpendUsd: 0 }).map((l) => l.text)).toEqual(esperado)
    // Menos de un centavo redondea a 0 centavos, como en la DB: también es sin pauta.
    expect(previewLines(RAMEN, { ...base, adSpendUsd: 0.004 }).map((l) => l.text)).toEqual(esperado)
  })

  it('sin pauta y sin plata, un solo renglón: nada de guiones de mensajes', () => {
    const lines = previewLines(RAMEN, {
      adSpendUsd: 0,
      messages: null,
      reach: null,
      revenueArs: null,
      usdArsRate: null,
    })
    expect(lines.map((l) => l.text)).toEqual([
      'Sin pauta · no hay costo por mensaje, cierre ni costo por reserva.',
    ])
  })

  it('con Gastado vacío, la facturación sola no abre la cuenta (no se sabe si hubo pauta)', () => {
    const lines = previewLines(RAMEN, {
      adSpendUsd: null,
      messages: null,
      reach: null,
      revenueArs: 2_480_000,
      usdArsRate: null,
    })
    expect(lines).toHaveLength(3)
  })

  it('en una fecha que todavía no pasó, la previa habla como la ficha', () => {
    const base = {
      adSpendUsd: 175.26,
      messages: 51,
      reach: null,
      revenueArs: null,
      usdArsRate: 1450,
      revenuePerGuestArs: 27_000,
      costPerGuestArs: 15_000,
    }
    const futura = previewLines(RAMEN, base, 'future')[3]?.text
    expect(futura).toBe(nightResultReport(RAMEN, RAMEN_ROW, 'future')?.math)
    expect(futura).toMatch(/→ por ahora quedan/)
    // La rama negativa era la que afirmaba en pasado una noche que no pasó.
    const perdida = previewLines(RAMEN, { ...base, revenuePerGuestArs: 12_000 }, 'tonight')
    expect(perdida[3]?.text).toMatch(/→ por ahora va /)
    expect(perdida[3]?.text).not.toMatch(/la noche quedó/)
  })

  it('sin gente sentada, el resultado es un guion con su motivo', () => {
    const lines = previewLines(
      { reservations: 0, guests: 0, billableGuests: 0 },
      {
        adSpendUsd: 175.26,
        messages: 51,
        reach: null,
        revenueArs: null,
        usdArsRate: 1450,
        revenuePerGuestArs: 27_000,
        costPerGuestArs: 15_000,
      },
    )
    expect(lines[3]?.text).toBe(
      '— de resultado · No quedó ninguna reserva en pie: no hay gente con la que hacer la cuenta.',
    )
  })
})

describe('editionMarketingLine (§9)', () => {
  it('cada estado de la tabla', () => {
    expect(editionMarketingLine(ASTRAL, row(), 'past')).toEqual({
      text: nb('Pauta US$ 175,26 · 51 mensajes · 21,6 % de cierre · US$ 15,93 por reserva'),
      tone: 'muted',
    })
    expect(
      editionMarketingLine(
        { reservations: 14, guests: 30, billableGuests: 30 },
        row({ adSpendUsdCents: 8000, messages: 9 }),
        'past',
      ),
    ).toEqual({
      text: nb('Pauta US$ 80,00 · 9 mensajes · más reservas que mensajes · US$ 5,71 por reserva'),
      tone: 'muted',
    })
    expect(
      editionMarketingLine(
        { reservations: 0, guests: 0, billableGuests: 0 },
        row({ adSpendUsdCents: 4500, messages: 9 }),
        'past',
      ),
    ).toEqual({ text: nb('Pauta US$ 45,00 · 9 mensajes · ninguna reserva en pie'), tone: 'muted' })
    expect(editionMarketingLine(ASTRAL, row({ messages: null }), 'past')?.text).toBe(
      nb('Pauta US$ 175,26 · faltan los mensajes'),
    )
    expect(
      editionMarketingLine(ASTRAL, row({ adSpendUsdCents: 4500, messages: 0 }), 'past')?.text,
    ).toBe(nb('Pauta US$ 45,00 · no escribió nadie'))
    expect(
      editionMarketingLine(ASTRAL, row({ adSpendUsdCents: 0, messages: null }), 'past'),
    ).toEqual({
      text: 'Sin pauta',
      tone: 'muted',
    })
    expect(editionMarketingLine(ASTRAL, null, 'past')).toEqual({
      text: 'Pauta sin cargar',
      tone: 'warning',
    })
    expect(
      editionMarketingLine(ASTRAL, row({ adSpendUsdCents: 6000, messages: 12 }), 'future'),
    ).toEqual({
      text: nb('Por ahora: pauta US$ 60,00 · 12 mensajes'),
      tone: 'muted',
    })
  })

  it('hoy y lo futuro sin fila no dicen nada', () => {
    expect(editionMarketingLine(ASTRAL, null, 'future')).toBeNull()
    expect(editionMarketingLine(ASTRAL, null, 'tonight')).toBeNull()
  })
})

// ─── Totales ─────────────────────────────────────────────────────────────────

describe('poolMarketing', () => {
  it('cociente de sumas, no promedio de cocientes (11,82, no 20,00)', () => {
    const items: PoolItem[] = [
      {
        phase: 'past',
        reservations: 10,
        guests: 20,
        billableGuests: 20,
        row: row({ adSpendUsdCents: 10000, messages: 50 }),
      },
      {
        phase: 'past',
        reservations: 1,
        guests: 2,
        billableGuests: 2,
        row: row({ adSpendUsdCents: 3000, messages: 10 }),
      },
    ]
    const pool = poolMarketing(items)
    expect(formatUsd(value(pool.P.costPerReservationUsd))).toBe(nb('US$ 11,82'))
    expect(formatUsd(value(pool.P.costPerReservationUsd))).not.toBe(nb('US$ 20,00'))
  })

  it('hoy y lo futuro quedan fuera de P/Q/R pero suman en lo invertido', () => {
    const items: PoolItem[] = [
      { phase: 'past', reservations: 11, guests: 29, billableGuests: 29, row: ASTRAL_FULL },
      {
        phase: 'tonight',
        reservations: 3,
        guests: 8,
        billableGuests: 8,
        row: row({
          adSpendUsdCents: 6000,
          messages: 12,
          revenueArsCents: 50_000_00,
          usdArsRate: 1400,
        }),
      },
      {
        phase: 'future',
        reservations: 0,
        guests: 0,
        billableGuests: 0,
        row: row({ adSpendUsdCents: 2000, messages: null }),
      },
      { phase: 'past', reservations: 5, guests: 10, billableGuests: 10, row: null },
      {
        phase: 'past',
        reservations: 5,
        guests: 10,
        billableGuests: 10,
        row: row({ adSpendUsdCents: 0, messages: null }),
      },
    ]
    const pool = poolMarketing(items)
    expect(pool.all).toEqual({ spendUsd: 255.26, dates: 3, notYet: 2, notYetSpendUsd: 80 })
    expect(pool.P.dates).toBe(1)
    expect(pool.P.spendUsd).toBe(175.26)
    expect(pool.P.reservations).toBe(11)
    expect(pool.Q.dates).toBe(1)
    expect(pool.Q.messages).toBe(51)
    expect(pool.R?.dates).toBe(1)
    expect(pool.R?.revenueArs).toBe(2_480_000)
  })

  it('más reservas que mensajes también agrupado, aunque una fecha sola no lo tenga', () => {
    const pool = poolMarketing([
      {
        phase: 'past',
        reservations: 14,
        guests: 30,
        billableGuests: 30,
        row: row({ adSpendUsdCents: 8000, messages: 9 }),
      },
      {
        phase: 'past',
        reservations: 1,
        guests: 2,
        billableGuests: 2,
        row: row({ adSpendUsdCents: 1000, messages: 1 }),
      },
    ])
    expect(reason(pool.Q.closingRate)).toBe('mas-reservas-que-mensajes')
    // Y al revés: una fecha con más reservas no arrastra el total si la suma no las tiene.
    const ok = poolMarketing([
      {
        phase: 'past',
        reservations: 14,
        guests: 30,
        billableGuests: 30,
        row: row({ adSpendUsdCents: 8000, messages: 9 }),
      },
      {
        phase: 'past',
        reservations: 2,
        guests: 4,
        billableGuests: 4,
        row: row({ adSpendUsdCents: 1000, messages: 20 }),
      },
    ])
    expect(formatPercent(value(ok.Q.closingRate))).toBe(nb('55,2 %'))
  })

  it('Q cuenta solo las fechas con mensajes; P las cuenta a todas', () => {
    const pool = poolMarketing([
      { phase: 'past', reservations: 11, guests: 29, billableGuests: 29, row: row() },
      {
        phase: 'past',
        reservations: 5,
        guests: 12,
        billableGuests: 12,
        row: row({ adSpendUsdCents: 5000, messages: null }),
      },
    ])
    expect(pool.P).toMatchObject({
      dates: 2,
      spendUsd: 225.26,
      reservations: 16,
      missingMessages: 1,
    })
    expect(pool.Q).toMatchObject({ dates: 1, spendUsd: 175.26, messages: 51, reservations: 11 })
    expect(formatPercent(value(pool.Q.closingRate))).toBe(nb('21,6 %'))
  })

  it('el retorno agrupado pasa cada fecha a dólares con SU dólar', () => {
    const pool = poolMarketing([
      // US$ 100 de pauta, $ 150.000 a $ 1.000 = US$ 150.
      {
        phase: 'past',
        reservations: 10,
        guests: 20,
        billableGuests: 20,
        row: row({ adSpendUsdCents: 10000, revenueArsCents: 150_000_00, usdArsRate: 1000 }),
      },
      // US$ 50 de pauta, $ 130.000 a $ 1.300 = US$ 100.
      {
        phase: 'past',
        reservations: 5,
        guests: 10,
        billableGuests: 10,
        row: row({ adSpendUsdCents: 5000, revenueArsCents: 130_000_00, usdArsRate: 1300 }),
      },
      // Sin facturación: no entra en R.
      {
        phase: 'past',
        reservations: 5,
        guests: 10,
        billableGuests: 10,
        row: row({ adSpendUsdCents: 9900 }),
      },
    ])
    expect(pool.R).not.toBeNull()
    expect(
      formatUsd(value(pool.R?.returnPerDollar ?? { ok: false, reason: 'sin-facturacion' })),
    ).toBe(nb('US$ 1,67'))
    expect(pool.R?.spendArs).toBe(165_000)
    expect(
      formatPercent(value(pool.R?.adShareOfRevenue ?? { ok: false, reason: 'sin-facturacion' })),
    ).toBe(nb('58,9 %'))
  })

  it('S suma la cuenta de la noche solo donde cierra entera', () => {
    const pool = poolMarketing([
      // La del ejemplo: 29 personas, $ 783.000 − $ 435.000 − $ 254.127.
      { phase: 'past', reservations: 12, guests: 31, billableGuests: 29, row: RAMEN_ROW },
      // 20 personas a $ 20.000 con costo $ 12.000, pauta US$ 50 a $ 1.500.
      {
        phase: 'past',
        reservations: 10,
        guests: 20,
        billableGuests: 20,
        row: row({
          adSpendUsdCents: 5000,
          usdArsRate: 1500,
          revenuePerGuestArsCents: 20_000_00,
          costPerGuestArsCents: 12_000_00,
        }),
      },
      // Sin dólar: queda AFUERA entera. Sumar su margen sin poder restarle su
      // pauta inflaría el resultado del mes.
      {
        phase: 'past',
        reservations: 4,
        guests: 9,
        billableGuests: 9,
        row: row({ revenuePerGuestArsCents: 20_000_00, costPerGuestArsCents: 12_000_00 }),
      },
      // Hoy no cuenta, aunque tenga todo cargado (regla 6).
      { phase: 'tonight', reservations: 3, guests: 8, billableGuests: 8, row: RAMEN_ROW },
      // Sin ingreso ni costo: no entra.
      { phase: 'past', reservations: 11, guests: 29, billableGuests: 29, row: ASTRAL_FULL },
    ])
    expect(pool.S?.dates).toBe(2)
    expect(pool.S?.guests).toBe(49)
    expect(pool.S?.revenueArs).toBe(1_183_000)
    expect(pool.S?.costArs).toBe(675_000)
    expect(pool.S?.grossMarginArs).toBe(508_000)
    expect(formatArs(pool.S?.adSpendArs ?? 0)).toBe(nb('$ 329.127'))
    expect(formatArs(pool.S?.resultArs ?? 0)).toBe(nb('$ 178.873'))
    expect(formatArs(value(pool.S?.resultPerGuestArs ?? { ok: false, reason: 'sin-pauta' }))).toBe(
      nb('$ 3.650'),
    )
  })

  it('sin ninguna fecha con la cuenta completa, S es null', () => {
    expect(poolMarketing([{ phase: 'past', ...ASTRAL, row: ASTRAL_FULL }]).S).toBeNull()
  })

  it('sin fechas pasadas con pauta, R es null y P no calcula', () => {
    const pool = poolMarketing([
      { phase: 'future', reservations: 3, guests: 8, billableGuests: 8, row: row() },
    ])
    expect(pool.R).toBeNull()
    expect(reason(pool.P.costPerReservationUsd)).toBe('sin-pauta')
    expect(reason(pool.Q.closingRate)).toBe('sin-mensajes')
  })
})

describe('pooledStripSummary', () => {
  const X: PoolItem = {
    phase: 'past',
    reservations: 11,
    guests: 29,
    billableGuests: 29,
    row: row(),
  }
  const Y: PoolItem = {
    phase: 'past',
    reservations: 8,
    guests: 20,
    billableGuests: 20,
    row: row({ adSpendUsdCents: 10000, messages: 30 }),
  }

  it('necesita 2 fechas con mensajes', () => {
    expect(pooledStripSummary([X])).toBeNull()
    expect(
      pooledStripSummary([X, { ...Y, row: row({ adSpendUsdCents: 10000, messages: null }) }]),
    ).toBeNull()
  })

  it('todos los cocientes sobre Q, con pendientes aparte', () => {
    expect(
      pooledStripSummary([
        X,
        Y,
        { phase: 'past', reservations: 4, guests: 9, billableGuests: 9, row: null },
        {
          phase: 'tonight',
          reservations: 3,
          guests: 8,
          billableGuests: 8,
          row: row({ adSpendUsdCents: 99900, messages: 1 }),
        },
      ]),
    ).toEqual({
      text: nb(
        'Pauta en 2 fechas: US$ 275,26 · US$ 3,40 por mensaje · 23,5 % de cierre · US$ 14,49 por reserva',
      ),
      pendingText: 'falta cargar 1',
    })
  })

  it('omite el cierre cuando hay más reservas que mensajes', () => {
    const summary = pooledStripSummary([
      {
        phase: 'past',
        reservations: 14,
        guests: 30,
        billableGuests: 30,
        row: row({ adSpendUsdCents: 8000, messages: 9 }),
      },
      {
        phase: 'past',
        reservations: 2,
        guests: 4,
        billableGuests: 4,
        row: row({ adSpendUsdCents: 1000, messages: 1 }),
      },
    ])
    expect(summary?.text).toBe(
      nb('Pauta en 2 fechas: US$ 90,00 · US$ 9,00 por mensaje · US$ 5,63 por reserva'),
    )
    expect(summary?.pendingText).toBeNull()
  })
})

// ─── Parser ──────────────────────────────────────────────────────────────────

describe('parseLocaleNumber', () => {
  const cases: Array<[string, 'money' | 'count' | 'rate', number | string]> = [
    ['175,26', 'money', 175.26],
    ['175.26', 'money', 175.26],
    ['US$175,26', 'money', 175.26],
    ['USD 175,26', 'money', 175.26],
    ['175,26 USD', 'money', 175.26],
    ['US$\u00A0175,26', 'money', 175.26],
    ['1.234,5', 'money', 1234.5],
    ['1,234.50', 'money', 1234.5],
    ['1.234', 'money', 1234],
    ['1,234', 'money', 1234],
    ['$ 1.500.000', 'money', 1_500_000],
    ['2.480.000,50', 'money', 2_480_000.5],
    ['51', 'count', 51],
    ['51 conversaciones', 'count', 51],
    ['8.420', 'count', 8420],
    ['8,420', 'count', 8420],
    ['8 420', 'count', 8420],
    ['51,5', 'count', 'con-decimales'],
    ['1.450', 'rate', 1450],
    ['1450,50', 'rate', 1450.5],
    ['-3', 'money', 'negativo'],
    ['-3', 'count', 'negativo'],
    ['US$ -3', 'rate', 'negativo'],
    ['1.234.5', 'money', 'ilegible'],
    ['12,34,567', 'count', 'ilegible'],
    ['abc', 'rate', 'ilegible'],
    ['1.234,', 'money', 'ilegible'],
    ['1234.567', 'money', 'ilegible'],
    ['', 'money', 'vacio'],
    ['   ', 'count', 'vacio'],
  ]

  it.each(cases)('%j (%s) → %s', (raw, kind, expected) => {
    const result = parseLocaleNumber(raw, kind)
    if (typeof expected === 'number') expect(result).toEqual({ ok: true, value: expected })
    else expect(result).toEqual({ ok: false, reason: expected })
  })

  it('canonicalInput reescribe al formato de acá y vuelve a leerse igual', () => {
    expect(canonicalInput(1234.5, 'money')).toBe('1.234,50')
    expect(canonicalInput(175.26, 'money')).toBe('175,26')
    expect(canonicalInput(2_480_000, 'money')).toBe('2.480.000')
    expect(canonicalInput(1450, 'rate')).toBe('1.450')
    expect(canonicalInput(1450.5, 'rate')).toBe('1.450,50')
    expect(canonicalInput(8420, 'count')).toBe('8.420')
    for (const [v, kind] of [
      [175.26, 'money'],
      [1234.5, 'money'],
      [0.5, 'money'],
      [2_480_000.5, 'money'],
      [1450, 'rate'],
      [8420, 'count'],
      [1_000_000, 'count'],
    ] as const) {
      expect(parseLocaleNumber(canonicalInput(v, kind), kind)).toEqual({ ok: true, value: v })
    }
  })
})

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('CSV', () => {
  it('los encabezados de §13, con la cuenta de la noche antes de la nota', () => {
    expect(MARKETING_EXPORT_HEADERS.join('; ')).toBe(
      'Pauta USD; Mensajes; Alcance; Costo por mensaje USD; % de cierre; Costo por reserva USD; Costo por persona USD; Facturación ARS; Dólar; Retorno (USD facturados por USD de pauta); Pauta sobre facturación %; Personas del cálculo; Ingreso por persona ARS; Costo por persona ARS; Ingreso ARS; Costo ARS; Margen ARS; Pauta ARS; Resultado ARS; Nota',
    )
    // La nota es lo último: es texto largo escrito a mano y correría el resto.
    expect(MARKETING_EXPORT_HEADERS.at(-1)).toBe('Nota')
  })

  it('las celdas del ejemplo del dueño', () => {
    expect(
      marketingCsvCells(ASTRAL, { ...ASTRAL_FULL, notes: 'Campaña de reels del 1/9 al 9/9' }),
    ).toEqual([
      '175,26',
      '51',
      '8420',
      '3,44',
      '21,6',
      '15,93',
      '6,04',
      '2480000',
      '1450',
      '9,76',
      '10,2',
      // Sin ingreso ni costo por persona, esta fecha no tiene cuenta de la
      // noche: las ocho columnas van vacías. Escribir «Personas del cálculo» y
      // «Pauta ARS» al lado de un «Margen ARS» vacío era invitar a restar en
      // Excel dos celdas que no son la cuenta.
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Campaña de reels del 1/9 al 9/9',
    ])
  })

  it('las ocho columnas de la cuenta salen juntas o no sale ninguna', () => {
    const night = (r: EventMarketingRow) => marketingCsvCells(ASTRAL, r).slice(11, 19)
    const vacias = ['', '', '', '', '', '', '', '']
    // Una fecha de las que ya estaban cargadas: facturación y dólar, nada más.
    expect(night(ASTRAL_FULL)).toEqual(vacias)
    // Y una pelada, que además tenía «Personas del cálculo» colgada sola.
    expect(night(row())).toEqual(vacias)
    // Con un solo número por persona ya hay cuenta, aunque quede a medio hacer.
    expect(night(row({ revenuePerGuestArsCents: 27_000_00 }))).not.toEqual(vacias)
    expect(night(row({ costPerGuestArsCents: 15_000_00 }))).not.toEqual(vacias)
  })

  it('las celdas de la cuenta de la noche, con el ejemplo del ramen', () => {
    const cells = marketingCsvCells(RAMEN, RAMEN_ROW)
    expect(cells.slice(11, 19)).toEqual([
      '29', // personas del cálculo: 27 contadas + 2 de mesas sin cerrar
      '27000',
      '15000',
      '783000',
      '435000',
      '348000',
      '254127',
      '93873',
    ])
  })

  it('pantalla = CSV en la cuenta de la noche: mismo redondeo', () => {
    const k = computeMarketingKpis(RAMEN, RAMEN_ROW)
    const cells = marketingCsvCells(RAMEN, RAMEN_ROW)
    const bare = (screen: string) => screen.replace(/^\$ /, '').replace(/\./g, '')
    expect(cells[14]).toBe(bare(formatArs(value(k.revenueArs))))
    expect(cells[15]).toBe(bare(formatArs(value(k.costArs))))
    expect(cells[16]).toBe(bare(formatArs(value(k.grossMarginArs))))
    expect(cells[17]).toBe(bare(formatArs(value(k.adSpendArs))))
    expect(cells[18]).toBe(bare(formatArs(value(k.nightResultArs))))
  })

  it('un resultado negativo va con signo en la planilla (Excel lo lee como número)', () => {
    const perdida = marketingCsvCells(
      RAMEN,
      row({
        usdArsRate: 1450,
        revenuePerGuestArsCents: 15_000_00,
        costPerGuestArsCents: 15_000_00,
      }),
    )
    // Margen 0, pauta $ 254.127: la noche quedó $ 254.127 abajo.
    expect(perdida[16]).toBe('0')
    expect(perdida[18]).toBe('-254127')
  })

  it('lo que no se pudo calcular queda vacío, no en cero', () => {
    const sinDolar = marketingCsvCells(RAMEN, { ...RAMEN_ROW, usdArsRate: null })
    expect(sinDolar[16]).toBe('348000')
    expect(sinDolar[17]).toBe('')
    expect(sinDolar[18]).toBe('')
    const sinCosto = marketingCsvCells(RAMEN, { ...RAMEN_ROW, costPerGuestArsCents: null })
    expect(sinCosto[14]).toBe('783000')
    expect(sinCosto[15]).toBe('')
    expect(sinCosto[16]).toBe('')
    // Sin margen tampoco se escribe la pauta: al lado de un «Margen ARS» vacío
    // es una resta en Excel que no es la cuenta. Misma reja que la ficha.
    expect(sinCosto[17]).toBe('')
    expect(sinCosto[18]).toBe('')
  })

  it('los dos precios por persona se exportan con sus centavos', () => {
    // Son los únicos que en Excel se multiplican por la gente de al lado:
    // redondeados a pesos, A × B no daría C.
    const conCentavos = marketingCsvCells(RAMEN, {
      ...RAMEN_ROW,
      revenuePerGuestArsCents: 2_750_050,
      costPerGuestArsCents: 1_500_025,
    })
    expect(conCentavos[12]).toBe('27500,50')
    expect(conCentavos[13]).toBe('15000,25')
    // Un precio redondo sigue saliendo entero, como el dólar.
    expect(marketingCsvCells(RAMEN, RAMEN_ROW)[12]).toBe('27000')
  })

  it('la facturación y el dólar se escriben cada uno por su cuenta', () => {
    // Desde que el dólar no se exige de a pares con la facturación, pedirlos
    // juntos dejaría fuera de la planilla un número que el dueño sí cargó.
    const soloFacturacion = marketingCsvCells(
      ASTRAL,
      row({ revenueArsCents: 2_480_000_00, usdArsRate: null }),
    )
    expect(soloFacturacion[7]).toBe('2480000')
    expect(soloFacturacion[8]).toBe('')
    expect(soloFacturacion[9]).toBe('')
    const soloDolar = marketingCsvCells(ASTRAL, row({ usdArsRate: 1450 }))
    expect(soloDolar[7]).toBe('')
    expect(soloDolar[8]).toBe('1450')
  })

  it('pantalla = CSV: mismo redondeo, sin prefijo ni puntos de miles', () => {
    const k = computeMarketingKpis(ASTRAL, ASTRAL_FULL)
    const cells = marketingCsvCells(ASTRAL, ASTRAL_FULL)
    const bare = (screen: string) =>
      screen
        .replace(/^US\$\u00A0|^\$\u00A0/, '')
        .replace(/\u00A0%$/, '')
        .replace(/\./g, '')
    expect(cells[3]).toBe(bare(formatUsd(value(k.costPerMessageUsd))))
    expect(cells[4]).toBe(bare(formatPercent(value(k.closingRate))))
    expect(cells[5]).toBe(bare(formatUsd(value(k.costPerReservationUsd))))
    expect(cells[6]).toBe(bare(formatUsd(value(k.costPerGuestUsd))))
    expect(cells[7]).toBe(bare(formatArs(2_480_000)))
    expect(cells[8]).toBe(bare(formatPesosRate(1450)))
    expect(cells[9]).toBe(bare(formatUsd(value(k.returnPerDollar))))
    expect(cells[10]).toBe(bare(formatPercent(value(k.adShareOfRevenue))))
  })

  it('celda vacía donde la pantalla muestra —', () => {
    const more = marketingCsvCells(
      { reservations: 14, guests: 30, billableGuests: 30 },
      row({ adSpendUsdCents: 8000, messages: 9 }),
    )
    expect(more[4]).toBe('')
    expect(more[5]).toBe('5,71')
    const none = marketingCsvCells(
      { reservations: 0, guests: 0, billableGuests: 0 },
      row({ adSpendUsdCents: 4500, messages: 9 }),
    )
    expect(none[4]).toBe('0')
    expect(none[5]).toBe('')
    expect(none[6]).toBe('')
    expect(marketingCsvCells(ASTRAL, row({ revenueArsCents: 100_00, usdArsRate: 1450.5 }))[8]).toBe(
      '1450,50',
    )
  })

  it('pantalla = CSV: un porcentaje que la pantalla dice «menos de 0,1 %» no se exporta como 0,0', () => {
    // 1 reserva de 1.000.000 mensajes; US$ 10 a $ 1.450 contra $ 40.000.000 facturados.
    const block = { reservations: 1, guests: 2, billableGuests: 2 }
    const tiny = row({
      adSpendUsdCents: 1000,
      messages: 1_000_000,
      revenueArsCents: 40_000_000_00,
      usdArsRate: 1450,
    })
    const k = computeMarketingKpis(block, tiny)
    const cells = marketingCsvCells(block, tiny)
    expect(formatPercent(value(k.closingRate))).toBe(nb('menos de 0,1 %'))
    expect(formatPercent(value(k.adShareOfRevenue))).toBe(nb('menos de 0,1 %'))
    expect(cells[4]).toBe('menos de 0,1')
    expect(cells[10]).toBe('menos de 0,1')
    // El cero exacto sigue siendo un cero de verdad.
    expect(marketingCsvCells({ reservations: 0, guests: 0, billableGuests: 0 }, tiny)[4]).toBe('0')
  })

  it('«No tuvo pauta» escribe 0,00; sin fila o "Sin evento", todo vacío', () => {
    const columnas = MARKETING_EXPORT_HEADERS.length
    expect(marketingCsvCells(ASTRAL, row({ adSpendUsdCents: 0, messages: null }))).toEqual([
      '0,00',
      ...Array(columnas - 1).fill(''),
    ])
    expect(marketingCsvCells(ASTRAL, null)).toEqual(Array(columnas).fill(''))
    expect(marketingCsvCells(null, row())).toEqual(Array(columnas).fill(''))
  })

  it('una noche orgánica escribe su cuenta, con la pauta en $ 0 (pantalla = CSV)', () => {
    const cells = marketingCsvCells(RATATOUILLE, { ...ORGANIC_ROW, notes: 'todo orgánico' })
    const at = (header: string) => cells[MARKETING_EXPORT_HEADERS.indexOf(header)]
    expect(at('Pauta USD')).toBe('0,00')
    // Nada de Meta: sin anuncio no hay mensajes, cierre ni costo por reserva.
    for (const header of [
      'Mensajes',
      'Alcance',
      'Costo por mensaje USD',
      '% de cierre',
      'Costo por reserva USD',
      'Costo por persona USD',
      'Dólar',
      'Retorno (USD facturados por USD de pauta)',
    ]) {
      expect(at(header), header).toBe('')
    }
    expect(at('Personas del cálculo')).toBe('48')
    expect(at('Ingreso por persona ARS')).toBe('25000')
    expect(at('Costo por persona ARS')).toBe('7200')
    expect(at('Ingreso ARS')).toBe('1200000')
    expect(at('Costo ARS')).toBe('345600')
    expect(at('Margen ARS')).toBe('854400')
    expect(at('Pauta ARS')).toBe('0')
    expect(at('Resultado ARS')).toBe('854400')
    expect(at('Nota')).toBe('todo orgánico')
  })

  it('la nota lleva apóstrofo si Excel la leería como fórmula', () => {
    for (const note of ['=SUMA(A1)', '+54 351 555', '-3 días', '@campaña', '\tTab', '\rCR']) {
      expect(marketingCsvCells(ASTRAL, row({ notes: note })).at(-1)).toBe(`'${note}`)
    }
    expect(marketingCsvCells(ASTRAL, row({ notes: 'Campaña de reels' })).at(-1)).toBe(
      'Campaña de reels',
    )
    expect(csvFormulaGuard('Reels 1/9')).toBe('Reels 1/9')
  })
})

// ─── Pestaña del mes ─────────────────────────────────────────────────────────

function edition(
  over: Partial<EditionSummary> & { key: string; date: string; title: string },
): EditionSummary {
  return {
    kind: 'event',
    colorHex: '#ed4094',
    startsAtLocal: '21:00:00',
    capacity: 70,
    eventId: over.key,
    templateId: `tpl-${over.key}`,
    guests: over.guests ?? 0,
    reservations: 0,
    avg: null,
    minParty: null,
    maxParty: null,
    attendedGuests: 0,
    // Por defecto toda la gente reservada se sentó: las fechas que quieran
    // separar lo contado de lo reservado lo pasan explícito.
    billableGuests: over.guests ?? 0,
    countedTables: 0,
    cancelled: 0,
    noShow: 0,
    fallenGuests: 0,
    tables: [],
    isFuture: false,
    isTonight: false,
    ...over,
  }
}

const TODAY = '2026-09-15'

const MONTH_EDITIONS: EditionSummary[] = [
  edition({ key: 'e8', date: '2026-10-01', title: 'Octubre', isFuture: true }),
  edition({ key: 'e7', date: '2026-09-26', title: 'Karaoke', isFuture: true }),
  edition({
    key: 'e6',
    date: '2026-09-15',
    title: 'Merienda y Arte',
    reservations: 3,
    guests: 8,
    isTonight: true,
  }),
  edition({ key: 'e5', date: '2026-09-13', title: 'Jazz', reservations: 5, guests: 12 }),
  edition({ key: 'e4', date: '2026-09-12', title: 'Tapeo', reservations: 14, guests: 30 }),
  edition({ key: 'e3', date: '2026-09-10', title: 'Pizza libre', reservations: 20, guests: 50 }),
  edition({ key: 'e2', date: '2026-09-09', title: 'Noche Astral', reservations: 11, guests: 29 }),
  edition({ key: 'e1', date: '2026-09-07', title: 'Ramen' }),
]

const MONTH_MARKETING: Record<string, EventMarketingRow> = {
  e2: { ...ASTRAL_FULL, scheduledEventId: 'e2', notes: 'Campaña de reels del 1/9 al 9/9' },
  e3: row({ scheduledEventId: 'e3', adSpendUsdCents: 0, messages: null }),
  e4: row({ scheduledEventId: 'e4', adSpendUsdCents: 8000, messages: 9 }),
  e5: row({ scheduledEventId: 'e5', adSpendUsdCents: 5000, messages: null }),
  e6: row({ scheduledEventId: 'e6', adSpendUsdCents: 6000, messages: 12 }),
  e8: row({ scheduledEventId: 'e8', adSpendUsdCents: 99999 }),
}

describe('buildMonthMarketingReport', () => {
  const report = buildMonthMarketingReport({
    ym: '2026-09',
    today: TODAY,
    editions: MONTH_EDITIONS,
    marketing: MONTH_MARKETING,
    truncated: false,
  })

  it('nombre del mes y ediciones del mes, en orden ascendente', () => {
    expect(report.monthLabel).toBe('Septiembre de 2026')
    expect(report.monthName).toBe('septiembre')
    expect(report.editions.map((e) => e.eventId)).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
      'e6',
      'e7',
    ])
    expect(report.emptyState).toBeNull()
    expect(report.notice).toBeNull()
  })

  it('pendientes: fechas pasadas sin cargar o incompletas, nunca hoy ni lo futuro', () => {
    expect(report.pending?.title).toBe('Faltan cargar 2 fechas que ya pasaron')
    expect(report.pending?.subtitle).toBe('Hasta que estén, los totales del mes quedan cortos.')
    expect(report.pending?.rows.map((r) => r.eventId)).toEqual(['e1', 'e5'])
    expect(report.pending?.rows[0]).toMatchObject({
      weekdayLabel: 'lun 07/09',
      reservationsLabel: 'sin reservas en pie',
      incomplete: false,
      cargarAriaLabel: 'Cargar la pauta de Ramen del 07/09',
    })
    expect(report.pending?.rows[1]).toMatchObject({
      weekdayLabel: 'dom 13/09',
      reservationsLabel: '5 reservas en pie',
      incomplete: true,
      reservations: 5,
      guests: 12,
    })
  })

  it('las oraciones del resumen', () => {
    expect(report.summary).toEqual([
      nb('En septiembre pusimos US$ 365,26 de pauta en 4 fechas (1 todavía no pasó).'),
      'En las 3 que ya pasaron llegaron 60 mensajes y quedaron 30 reservas en pie (71 personas).',
      'Faltan los mensajes de 1 fecha.',
    ])
  })

  it('las fichas nombran su base', () => {
    expect(report.tiles).toEqual([
      {
        key: 'invested',
        label: 'Invertido',
        value: nb('US$ 365,26'),
        hint: 'en 4 fechas (1 todavía no pasó)',
        tone: 'default',
      },
      {
        key: 'costPerReservation',
        label: 'Por reserva',
        value: nb('US$ 10,18'),
        hint: nb('US$ 305,26 ÷ 30 reservas en pie'),
        tone: 'default',
      },
      {
        key: 'closingRate',
        label: 'De cierre',
        value: nb('41,7 %'),
        hint: '25 reservas en pie de 60 mensajes',
        tone: 'default',
      },
      {
        key: 'returnPerDollar',
        label: nb('Facturó por cada US$ 1'),
        value: nb('US$ 9,76'),
        hint: 'en 1 de 3 fechas con facturación · Es facturación, no ganancia.',
        tone: 'default',
      },
    ])
  })

  it('la lista: solo fechas con gasto, con los estados de cada celda', () => {
    expect(report.rows.map((r) => r.eventId)).toEqual(['e2', 'e4', 'e5', 'e6'])
    expect(report.showReturnColumn).toBe(true)

    const [astral, tapeo, jazz, merienda] = report.rows
    expect(astral?.cardLine).toBe(
      nb('Pauta US$ 175,26 · 51 mensajes · 21,6 % de cierre · 29 personas · retorno US$ 9,76'),
    )
    expect(astral?.cardHeadline).toBe(nb('US$ 15,93'))
    expect(astral?.weekdayLabel).toBe('mié 09/09')
    expect(astral?.phaseLabel).toBeNull()

    expect(tapeo?.cells.closingRate).toEqual({
      text: '—',
      tone: 'muted',
      srText: 'más reservas que mensajes',
    })
    expect(tapeo?.cells.costPerReservation.text).toBe(nb('US$ 5,71'))

    expect(jazz?.cells.messages).toMatchObject({ text: 'falta', tone: 'warning' })

    expect(merienda?.phaseLabel).toBe('es hoy')
    expect(merienda?.cells.spend.text).toBe(nb('US$ 60,00'))
    expect(merienda?.cells.messages.text).toBe('12')
    expect(merienda?.cells.closingRate.text).toBe('')
    expect(merienda?.cells.costPerReservation.text).toBe('')
    expect(merienda?.cardHeadline).toBeNull()
    expect(merienda?.cardLine).toBe(nb('Pauta US$ 60,00 · 12 mensajes'))
  })

  it('«Sin pauta» y las notas al pie', () => {
    expect(report.noAdsText).toBe('Sin pauta: Pizza libre 10/09')
    expect(report.footnotes).toEqual([
      'El mes lo da la fecha del evento, no el día en que se pagó Meta.',
      'Solo suma la pauta cargada en fechas de eventos: la pauta general del bar no está acá.',
      'Por reserva y de cierre cuentan solo fechas que ya pasaron.',
    ])
  })

  it('una fecha futura con pauta figura como "todavía no pasó"', () => {
    const r = buildMonthMarketingReport({
      ym: '2026-09',
      today: TODAY,
      editions: MONTH_EDITIONS,
      marketing: {
        ...MONTH_MARKETING,
        e7: row({ scheduledEventId: 'e7', adSpendUsdCents: 6000, messages: 12 }),
      },
      truncated: false,
    })
    expect(r.rows.at(-1)?.phaseLabel).toBe('todavía no pasó')
    expect(r.tiles[0]?.hint).toBe('en 5 fechas (2 todavía no pasaron)')
    // No toca los cocientes: por reserva sigue sobre las mismas 3 fechas.
    expect(r.tiles[1]?.value).toBe(nb('US$ 10,18'))
  })

  it('estados vacíos', () => {
    const past = buildMonthMarketingReport({
      ym: '2026-08',
      today: TODAY,
      editions: [],
      marketing: {},
      truncated: false,
    })
    expect(past.emptyState).toEqual({
      title: 'No hubo eventos en agosto',
      description: 'La pauta se carga por fecha de evento.',
    })
    const next = buildMonthMarketingReport({
      ym: '2026-10',
      today: TODAY,
      editions: [],
      marketing: {},
      truncated: false,
    })
    expect(next.emptyState?.title).toBe('No hay eventos programados en octubre')

    const nothingPast = buildMonthMarketingReport({
      ym: '2026-09',
      today: '2026-09-01',
      editions: MONTH_EDITIONS,
      marketing: {},
      truncated: false,
    })
    expect(nothingPast.notice).toBe(
      'Todavía no pasó ninguna fecha de septiembre. Si ya estás pautando, cargala desde la ficha de cada evento.',
    )
    expect(nothingPast.pending).toBeNull()

    // Sin fechas pasadas pero con pauta ya cargada: no se pide cargar lo que el
    // resumen y la lista de abajo ya muestran.
    const loadedNothingPast = buildMonthMarketingReport({
      ym: '2026-09',
      today: '2026-09-01',
      editions: MONTH_EDITIONS,
      marketing: MONTH_MARKETING,
      truncated: false,
    })
    expect(loadedNothingPast.notice).toBeNull()
    expect(loadedNothingPast.summary).toEqual([
      nb('En septiembre pusimos US$ 365,26 de pauta en 4 fechas (4 todavía no pasaron).'),
    ])
    expect(loadedNothingPast.tiles[1]).toMatchObject({
      key: 'costPerReservation',
      value: null,
      hint: 'todavía no pasó ninguna fecha con pauta',
    })
    expect(loadedNothingPast.rows).toHaveLength(4)

    const noRows = buildMonthMarketingReport({
      ym: '2026-09',
      today: TODAY,
      editions: MONTH_EDITIONS,
      marketing: {},
      truncated: true,
    })
    expect(noRows.notice).toBe('Todavía no hay pauta cargada en septiembre.')
    expect(noRows.tiles).toEqual([])
    expect(noRows.summary).toEqual([])
    expect(noRows.pending?.rows).toHaveLength(5)
    expect(noRows.truncated).toBe(true)
  })

  it('una sola fecha pendiente va en singular', () => {
    const r = buildMonthMarketingReport({
      ym: '2026-09',
      today: TODAY,
      editions: [edition({ key: 'e1', date: '2026-09-07', title: 'Ramen' })],
      marketing: {},
      truncated: false,
    })
    expect(r.pending?.title).toBe('Falta cargar 1 fecha que ya pasó')
  })

  it('la planilla: una fila por edición y un total por conjunto', () => {
    const lines = monthMarketingToCsv(report).replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(1 + 7 + 4)
    expect(lines[0]).toBe(
      'Fecha;Evento;Estado;Personas;Reservas;Pauta USD;Mensajes;Alcance;Costo por mensaje USD;% de cierre;Costo por reserva USD;Costo por persona USD;Facturación ARS;Dólar;Retorno (USD facturados por USD de pauta);Pauta sobre facturación %;Personas del cálculo;Ingreso por persona ARS;Costo por persona ARS;Ingreso ARS;Costo ARS;Margen ARS;Pauta ARS;Resultado ARS;Nota',
    )
    expect(lines[1]).toBe('2026-09-07;Ramen;sin cargar;0;0;;;;;;;;;;;;;;;;;;;;')
    // Ninguna fecha de este mes tiene ingreso ni costo por persona, así que las
    // ocho columnas de la cuenta de la noche van vacías en todas las filas.
    expect(lines[2]).toBe(
      '2026-09-09;Noche Astral;completa;29;11;175,26;51;8420;3,44;21,6;15,93;6,04;2480000;1450;9,76;10,2;;;;;;;;;Campaña de reels del 1/9 al 9/9',
    )
    expect(lines[3]).toBe('2026-09-10;Pizza libre;sin pauta;50;20;0,00;;;;;;;;;;;;;;;;;;;')
    expect(lines[4]).toBe('2026-09-12;Tapeo;completa;30;14;80,00;9;;8,89;;5,71;2,67;;;;;;;;;;;;;')
    expect(lines[5]).toBe('2026-09-13;Jazz;incompleta;12;5;50,00;;;;;10,00;4,17;;;;;;;;;;;;;')
    // Hoy: lo cargado sí, los cocientes no (igual que la lista de la pantalla).
    expect(lines[6]).toBe('2026-09-15;Merienda y Arte;es hoy;8;3;60,00;12;;;;;;;;;;;;;;;;;;')
    expect(lines[7]).toBe('2026-09-26;Karaoke;todavía no pasó;0;0;;;;;;;;;;;;;;;;;;;;')
    // Antes era una sola fila que mezclaba P, Q y R (305,26 ÷ 60 no daba 4,25).
    // Cada total lleva solo las sumas de sus cocientes: se rehace con su fila.
    // P: 305,26 ÷ 30 = 10,18 · 305,26 ÷ 71 = 4,30.
    expect(lines[8]).toBe(
      'Total con pauta que ya pasó (3 fechas);;;71;30;305,26;;;;;10,18;4,30;;;;;;;;;;;;;',
    )
    // Q (sin Jazz): 255,26 ÷ 60 = 4,25 · 25 ÷ 60 = 41,7 % · 255,26 ÷ 25 = 10,21.
    expect(lines[9]).toBe(
      'Total con pauta que ya pasó, con mensajes cargados (2 fechas);;;;25;255,26;60;;4,25;41,7;10,21;;;;;;;;;;;;;;',
    )
    // R (solo Noche Astral): cada fecha pasa a dólares con SU dólar.
    expect(lines[10]).toBe(
      'Total con pauta que ya pasó, con facturación (1 fecha);;;;;175,26;;;;;;;2480000;;9,76;10,2;;;;;;;;;',
    )
    expect(lines[11]).toBe('Pauta de fechas que todavía no pasaron;;;;;60,00;;;;;;;;;;;;;;;;;;;')
  })

  it('la planilla: cada total sale solo si su conjunto tiene fechas', () => {
    const nothingPast = buildMonthMarketingReport({
      ym: '2026-09',
      today: '2026-09-01',
      editions: MONTH_EDITIONS,
      marketing: MONTH_MARKETING,
      truncated: false,
    })
    const futureLines = monthMarketingToCsv(nothingPast).replace(/^﻿/, '').split('\r\n')
    expect(futureLines).toHaveLength(1 + 7 + 1)
    expect(futureLines.some((l) => l.startsWith('Total'))).toBe(false)
    expect(futureLines.at(-1)).toBe(
      'Pauta de fechas que todavía no pasaron;;;;;365,26;;;;;;;;;;;;;;;;;;;',
    )

    // Una sola fecha pasada, sin facturación: P y Q, sin la fila de R. El cierre
    // agrupado sigue la regla de la pantalla (1 de 1.000.000 no es 0,0).
    const oneDate = buildMonthMarketingReport({
      ym: '2026-09',
      today: TODAY,
      editions: [
        edition({ key: 'x', date: '2026-09-07', title: 'Ramen', reservations: 1, guests: 2 }),
      ],
      marketing: { x: row({ scheduledEventId: 'x', adSpendUsdCents: 1000, messages: 1_000_000 }) },
      truncated: false,
    })
    const lines = monthMarketingToCsv(oneDate).replace(/^﻿/, '').split('\r\n')
    expect(lines.map((l) => l.split(';')[0])).toEqual([
      'Fecha',
      '2026-09-07',
      'Total con pauta que ya pasó (1 fecha)',
      'Total con pauta que ya pasó, con mensajes cargados (1 fecha)',
      'Pauta de fechas que todavía no pasaron',
    ])
    expect(lines[3]?.split(';')[9]).toBe('menos de 0,1')
  })

  it('una fecha que todavía no pasó lleva los dos por persona, no los seis calculados', () => {
    // Los dos por persona son lo que tipeó el dueño —el cubierto se sabe de
    // antemano—, igual que «Pauta USD» o el dólar: esconderlos sería borrar de
    // la planilla un número que él cargó. Los cocientes de una noche que no
    // terminó, no (regla 6).
    const r = buildMonthMarketingReport({
      ym: '2026-09',
      today: TODAY,
      editions: [
        edition({
          key: 'f',
          date: '2026-09-26',
          title: 'Karaoke',
          reservations: 10,
          guests: 30,
          isFuture: true,
        }),
      ],
      marketing: {
        f: row({
          scheduledEventId: 'f',
          adSpendUsdCents: 6000,
          messages: 12,
          usdArsRate: 1450,
          revenuePerGuestArsCents: 27_000_00,
          costPerGuestArsCents: 15_000_00,
        }),
      },
      truncated: false,
    })
    const cells = (monthMarketingToCsv(r).replace(/^﻿/, '').split('\r\n')[1] ?? '').split(';')
    const col = (header: string) => cells[MONTH_EXPORT_HEADERS.indexOf(header)]
    expect(col('Ingreso por persona ARS')).toBe('27000')
    expect(col('Costo por persona ARS')).toBe('15000')
    for (const header of [
      'Personas del cálculo',
      'Ingreso ARS',
      'Costo ARS',
      'Margen ARS',
      'Pauta ARS',
      'Resultado ARS',
    ]) {
      expect(col(header)).toBe('')
    }
  })

  it('sin ingreso ni costo cargados en ninguna fecha, el mes no habla de resultado', () => {
    expect(report.result).toBeNull()
    expect(report.showResultColumn).toBe(false)
    expect(report.footnotes).toEqual([...MONTH_FOOTNOTES])
    expect(report.tiles.some((t) => t.key === 'monthResult')).toBe(false)
  })

  it('la planilla pone apóstrofo a un nombre de evento que Excel leería como fórmula', () => {
    const r = buildMonthMarketingReport({
      ym: '2026-09',
      today: TODAY,
      editions: [edition({ key: 'e1', date: '2026-09-07', title: '=HYPERLINK("x")' })],
      marketing: {},
      truncated: false,
    })
    expect(monthMarketingToCsv(r)).toContain(`'=HYPERLINK`)
  })
})

// ─── El resultado del mes ────────────────────────────────────────────────────

describe('el resultado del mes', () => {
  const FIN_DE_MES = '2026-09-30'

  const EDICIONES: EditionSummary[] = [
    edition({
      key: 'r1',
      date: '2026-09-07',
      title: 'Ramen',
      reservations: 12,
      guests: 31,
      billableGuests: 29,
      attendedGuests: 27,
    }),
    edition({ key: 'r2', date: '2026-09-14', title: 'Ramen', reservations: 10, guests: 20 }),
    edition({ key: 'r3', date: '2026-09-21', title: 'Jazz', reservations: 4, guests: 9 }),
  ]

  const MARKETING: Record<string, EventMarketingRow> = {
    r1: { ...RAMEN_ROW, scheduledEventId: 'r1' },
    r2: row({
      scheduledEventId: 'r2',
      adSpendUsdCents: 5000,
      messages: 20,
      usdArsRate: 1500,
      revenuePerGuestArsCents: 20_000_00,
      costPerGuestArsCents: 12_000_00,
    }),
    // Sin dólar: queda fuera del resultado del mes, pero su margen se ve igual
    // en su propia fila.
    r3: row({
      scheduledEventId: 'r3',
      adSpendUsdCents: 3000,
      messages: 10,
      revenuePerGuestArsCents: 20_000_00,
      costPerGuestArsCents: 12_000_00,
    }),
  }

  const mes = buildMonthMarketingReport({
    ym: '2026-09',
    today: FIN_DE_MES,
    editions: EDICIONES,
    marketing: MARKETING,
    truncated: false,
  })

  it('la cuenta del mes, con la base nombrada', () => {
    expect(mes.result).toEqual({
      sentence: nb(
        'En 2 fechas con ingreso y costo cargados quedaron $ 178.873 después de la pauta.',
      ),
      math: nb(
        '49 personas · ingreso $ 1.183.000 · costo $ 675.000 · margen $ 508.000 · pauta $ 329.127 → quedan $ 178.873',
      ),
      negative: false,
      base: 'en 2 de 3 fechas con ingreso y costo cargados',
      disclaimer: NIGHT_RESULT_DISCLAIMER,
    })
    expect(mes.summary.at(-1)).toBe(mes.result?.sentence)
  })

  it('la ficha del resultado nombra su base y aclara que no es la ganancia', () => {
    expect(mes.tiles.at(-1)).toEqual({
      key: 'monthResult',
      label: 'Resultado',
      value: nb('$ 178.873'),
      hint: `en 2 de 3 fechas con ingreso y costo cargados · ${NIGHT_RESULT_DISCLAIMER}`,
      tone: 'default',
    })
  })

  it('la nota al pie del resultado aparece solo cuando hay resultado', () => {
    expect(mes.footnotes).toEqual([
      ...MONTH_FOOTNOTES,
      MONTH_RESULT_FOOTNOTE,
      // La tabla pone «Personas» (31 reservadas) al lado de «Resultado»
      // (calculado con 29): en la ficha eso lo explica `basis`, y acá, donde en
      // una celda no entra, se dice una vez al pie.
      MONTH_RESULT_BASIS_FOOTNOTE,
    ])
    expect(mes.showResultColumn).toBe(true)
  })

  it('cada fila dice lo suyo, y la que no puede dice por qué', () => {
    const [ramen, ramen2, jazz] = mes.rows
    expect(ramen?.cells.nightResult).toEqual({
      text: nb('$ 93.873'),
      tone: 'default',
      srText: null,
    })
    expect(ramen?.cardLine).toContain(nb('quedan $ 93.873'))
    expect(ramen2?.cells.nightResult.text).toBe(nb('$ 85.000'))
    expect(jazz?.cells.nightResult).toEqual({
      text: '—',
      tone: 'muted',
      srText: 'falta el dólar del día',
    })
  })

  it('un mes en rojo se dice en palabras, también en la ficha', () => {
    const enRojo = buildMonthMarketingReport({
      ym: '2026-09',
      today: FIN_DE_MES,
      editions: EDICIONES,
      marketing: {
        ...MARKETING,
        r1: { ...RAMEN_ROW, scheduledEventId: 'r1', revenuePerGuestArsCents: 10_000_00 },
      },
      truncated: false,
    })
    // Ramen: 29 × ($ 10.000 − $ 15.000) = $ 145.000 abajo, menos $ 254.127.
    // Con los $ 85.000 de la otra fecha, el mes queda $ 314.127 abajo.
    expect(enRojo.result?.negative).toBe(true)
    expect(enRojo.result?.sentence).toBe(
      nb(
        'En 2 fechas con ingreso y costo cargados la cuenta quedó $ 314.127 abajo después de la pauta.',
      ),
    )
    expect(enRojo.result?.math).toMatch(/→ quedó \$ 314\.127 abajo$/)
    expect(enRojo.tiles.at(-1)).toMatchObject({
      key: 'monthResult',
      value: nb('$ 314.127 abajo'),
      tone: 'warning',
    })
  })

  it('la planilla del mes suma su propio total, con la gente del cálculo', () => {
    const lines = monthMarketingToCsv(mes).replace(/^﻿/, '').split('\r\n')
    const total = lines.find((l) => l.startsWith('Total con pauta que ya pasó, con ingreso'))
    expect(total?.split(';')[0]).toBe(
      'Total con pauta que ya pasó, con ingreso y costo cargados (2 fechas)',
    )
    const cells = total?.split(';') ?? []
    const at = (header: string) => cells[5 + MARKETING_EXPORT_HEADERS.indexOf(header)]
    expect(at('Personas del cálculo')).toBe('49')
    expect(at('Ingreso ARS')).toBe('1183000')
    expect(at('Costo ARS')).toBe('675000')
    expect(at('Margen ARS')).toBe('508000')
    expect(at('Pauta ARS')).toBe('329127')
    expect(at('Resultado ARS')).toBe('178873')
    // Las columnas de la pauta en dólares no se mezclan en esta fila.
    expect(at('Pauta USD')).toBe('')
  })

  it('pantalla = planilla: la fila de una fecha dice lo mismo que su celda', () => {
    const lines = monthMarketingToCsv(mes).replace(/^﻿/, '').split('\r\n')
    const ramen = lines[1]?.split(';') ?? []
    const at = (header: string) => ramen[5 + MARKETING_EXPORT_HEADERS.indexOf(header)]
    expect(at('Personas del cálculo')).toBe('29')
    expect(at('Ingreso por persona ARS')).toBe('27000')
    expect(at('Costo por persona ARS')).toBe('15000')
    expect(at('Resultado ARS')).toBe('93873')
    // En la pantalla el mismo número se lee con formato; en la planilla, pelado.
    expect(mes.rows[0]?.cells.nightResult.text).toBe(nb('$ 93.873'))
  })

  /**
   * La misma fecha se lee en tres lados —la ficha de la noche, la fila del mes
   * y la planilla— y los tres tienen que decir el MISMO número. Cada uno arma
   * su bloque por su cuenta (la ficha desde el reporte del día, el mes desde
   * `aggregateEditions`), así que nada impide que mañana uno divida por otra
   * gente: esto lo agarra.
   */
  it('ficha, mes y planilla dicen el mismo número para la misma fecha', () => {
    const bloque = { reservations: 12, guests: 31, billableGuests: 29, attendedGuests: 27 }
    const fila = { ...RAMEN_ROW, scheduledEventId: 'r1' }

    const ficha = nightResultReport(bloque, fila)
    const filaDelMes = mes.rows.find((r) => r.eventId === 'r1')
    const planilla = marketingCsvCells(bloque, fila)
    const at = (header: string) => planilla[MARKETING_EXPORT_HEADERS.indexOf(header)]

    // El resultado, con las palabras de cada lado y el mismo número adentro.
    expect(ficha?.result).toEqual({ before: 'quedan ', value: nb('$ 93.873'), after: '' })
    expect(filaDelMes?.cells.nightResult.text).toBe(nb('$ 93.873'))
    expect(at('Resultado ARS')).toBe('93873')

    // Y los cuatro pasos de la cuenta, que es donde un denominador distinto se
    // notaría antes que en el total.
    expect(ficha?.steps.map((s) => s.value)).toEqual([
      nb('$ 783.000'),
      nb('$ 435.000'),
      nb('$ 348.000'),
      nb('$ 254.127'),
    ])
    expect([
      at('Ingreso ARS'),
      at('Costo ARS'),
      at('Margen ARS'),
      at('Pauta ARS'),
      at('Personas del cálculo'),
    ]).toEqual(['783000', '435000', '348000', '254127', '29'])
    // 29, no las 31 reservadas: la gente de la plata es la de `billableGuests`.
    expect(ficha?.steps[0]?.before).toBe(nb('29 personas × $ 27.000 = '))
  })
})

describe('la noche orgánica en el mes (regla 14)', () => {
  const EDICIONES: EditionSummary[] = [
    edition({ key: 'o1', date: '2026-09-07', title: 'Ramen', reservations: 12, guests: 31 }),
    edition({
      key: 'o2',
      date: '2026-09-12',
      title: 'Ratatouille',
      reservations: 18,
      guests: 54,
      billableGuests: 48,
      attendedGuests: 48,
    }),
    edition({ key: 'o3', date: '2026-09-14', title: 'Pizza libre', reservations: 20, guests: 50 }),
    edition({ key: 'o4', date: '2026-09-20', title: 'Karaoke', isFuture: true }),
  ]
  const MARKETING: Record<string, EventMarketingRow> = {
    o1: { ...RAMEN_ROW, scheduledEventId: 'o1' },
    o2: { ...ORGANIC_ROW, scheduledEventId: 'o2' },
    // «No tuvo pauta» pelada: sigue siendo solo un nombre en la lista.
    o3: row({ scheduledEventId: 'o3', adSpendUsdCents: 0, messages: null }),
    // Futura, sin pauta y con el cubierto estimado: todavía no «dejó» nada.
    o4: { ...ORGANIC_ROW, scheduledEventId: 'o4' },
  }
  const mes = buildMonthMarketingReport({
    ym: '2026-09',
    today: '2026-09-15',
    editions: EDICIONES,
    marketing: MARKETING,
    truncated: false,
  })

  it('dice cuánto dejó en su renglón de «Sin pauta»', () => {
    expect(mes.noAdsText).toBe(
      nb('Sin pauta: Ratatouille 12/09 (dejó $ 854.400) · Pizza libre 14/09 · Karaoke 20/09'),
    )
    const [ratatouille, pizza, karaoke] = mes.editions.filter((e) => e.status === 'sin-pauta')
    expect(ratatouille && noAdsResultLabel(ratatouille)).toEqual({
      text: nb('dejó $ 854.400'),
      negative: false,
    })
    expect(pizza && noAdsResultLabel(pizza)).toBeNull()
    expect(karaoke && noAdsResultLabel(karaoke)).toBeNull()
  })

  it('una noche orgánica que quedó abajo lo dice en palabras', () => {
    const cara = { ...ORGANIC_ROW, costPerGuestArsCents: 26_000_00 }
    expect(noAdsResultLabel({ ...RATATOUILLE, phase: 'past', row: cara })).toEqual({
      text: nb('quedó $ 48.000 abajo'),
      negative: true,
    })
  })

  it('no entra en los totales de la pestaña Pauta: son de las fechas CON pauta', () => {
    // Solo el ramen: ni fila en la tabla ni suma en el resultado del mes.
    expect(mes.rows.map((r) => r.eventId)).toEqual(['o1'])
    expect(mes.pool.S?.dates).toBe(1)
    expect(mes.pool.all.dates).toBe(1)
    // Tampoco es una fecha pendiente: se cargó, sin pauta.
    expect(mes.pending).toBeNull()
  })

  it('en la planilla del mes sí va con su cuenta, como en su ficha', () => {
    const csv = monthMarketingToCsv(mes)
    const linea = csv.split('\r\n').find((l) => l.includes('Ratatouille'))
    expect(linea?.split(';').slice(0, 5)).toEqual([
      '2026-09-12',
      'Ratatouille',
      'sin pauta',
      '54',
      '18',
    ])
    expect(linea).toContain(';854400;')
  })

  it('«¿Cómo se calcula?» no habla de Meta en una noche sin pauta', () => {
    const bullets = howItsCalculated(ORGANIC_ROW)
    expect(bullets.some((b) => b.includes('mensaje'))).toBe(false)
    expect(bullets).toContain(
      'Resultado de la noche: la gente por el ingreso por persona (o la facturación real, si está cargada), menos esa misma gente por el costo por persona. Sin pauta no hay nada más que restar.',
    )
    expect(bullets).toContain(NIGHT_RESULT_DISCLAIMER)
  })
})
