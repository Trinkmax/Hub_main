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
  isPendingMarketing,
  type Kpi,
  kpiHint,
  loadedBeforeEventLine,
  loadedByLabel,
  MARKETING_EXPORT_HEADERS,
  marketingCsvCells,
  marketingSentence,
  marketingStatus,
  marketingStatusChip,
  monthMarketingToCsv,
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
    notes: null,
    updatedAt: '2026-09-10T17:32:00Z',
    updatedByName: 'Nacho B.',
    ...over,
  }
}

/** El ejemplo del dueño completo: Noche Astral 09/09. */
const ASTRAL = { reservations: 11, guests: 29 }
const ASTRAL_FULL = row({ reach: 8420, revenueArsCents: 2_480_000_00, usdArsRate: 1450 })

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
      { reservations: 14, guests: 30 },
      row({ adSpendUsdCents: 8000, messages: 9 }),
    )
    expect(reason(k.closingRate)).toBe('mas-reservas-que-mensajes')
    expect(formatUsd(value(k.costPerReservationUsd))).toBe(nb('US$ 5,71'))
  })

  it('cero-reservas: cierre 0 %, por reserva no se calcula', () => {
    const k = computeMarketingKpis(
      { reservations: 0, guests: 0 },
      row({ adSpendUsdCents: 4500, messages: 9 }),
    )
    expect(reason(k.costPerReservationUsd)).toBe('cero-reservas')
    expect(value(k.closingRate)).toBe(0)
  })

  it('cero-personas: por persona y facturación por persona', () => {
    const k = computeMarketingKpis(
      { reservations: 0, guests: 0 },
      row({ revenueArsCents: 100_000_00, usdArsRate: 1000 }),
    )
    expect(reason(k.costPerGuestUsd)).toBe('cero-personas')
    expect(reason(k.revenuePerGuestArs)).toBe('cero-personas')
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
    expect(marketingSentence({ reservations: 3, guests: 8 }, r, 'past')).toBe(
      nb(
        'Pusimos US$ 45,00 en pauta y no escribió nadie. Quedaron 3 reservas en pie (8 personas).',
      ),
    )
    expect(marketingSentence({ reservations: 0, guests: 0 }, r, 'past')).toBe(
      nb('Pusimos US$ 45,00 en pauta, no escribió nadie y no quedó ninguna reserva en pie.'),
    )
  })

  it('mensajes y ninguna reserva', () => {
    expect(
      marketingSentence(
        { reservations: 0, guests: 0 },
        row({ adSpendUsdCents: 4500, messages: 9 }),
        'past',
      ),
    ).toBe(nb('Pusimos US$ 45,00 en pauta, llegaron 9 mensajes y no quedó ninguna reserva en pie.'))
  })

  it('singulares', () => {
    expect(
      marketingSentence(
        { reservations: 1, guests: 1 },
        row({ adSpendUsdCents: 4500, messages: 1 }),
        'past',
      ),
    ).toBe(nb('Pusimos US$ 45,00 en pauta, llegó 1 mensaje y quedó 1 reserva en pie (1 persona).'))
  })

  it('Por ahora: hoy y lo futuro cambian «quedaron» por «hay»', () => {
    expect(
      marketingSentence(
        { reservations: 3, guests: 8 },
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
        { reservations: 0, guests: 0 },
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
        { reservations: 3, guests: 8 },
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
    const empty = { reservations: 0, guests: 0 }
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
    expect(kpiHint('closingRate', { reservations: 14, guests: 30 }, row({ messages: 9 }))).toEqual({
      value: null,
      hint: '14 reservas en pie y 9 mensajes: parte llegó por otro lado',
      srReason: NO,
    })
  })

  it('singulares', () => {
    const one = { reservations: 1, guests: 1 }
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
    expect(fichaItems({ reservations: 0, guests: 0 }, row())).toEqual([])
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
      { reservations: 14, guests: 30 },
      { adSpendUsd: 80, messages: 9, reach: null, revenueArs: null, usdArsRate: null },
    )
    expect(lines[1]?.text).toBe(
      '— de cierre · 14 reservas en pie y 9 mensajes: parte llegó por otro lado',
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
        { reservations: 14, guests: 30 },
        row({ adSpendUsdCents: 8000, messages: 9 }),
        'past',
      ),
    ).toEqual({
      text: nb('Pauta US$ 80,00 · 9 mensajes · más reservas que mensajes · US$ 5,71 por reserva'),
      tone: 'muted',
    })
    expect(
      editionMarketingLine(
        { reservations: 0, guests: 0 },
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
        row: row({ adSpendUsdCents: 10000, messages: 50 }),
      },
      {
        phase: 'past',
        reservations: 1,
        guests: 2,
        row: row({ adSpendUsdCents: 3000, messages: 10 }),
      },
    ]
    const pool = poolMarketing(items)
    expect(formatUsd(value(pool.P.costPerReservationUsd))).toBe(nb('US$ 11,82'))
    expect(formatUsd(value(pool.P.costPerReservationUsd))).not.toBe(nb('US$ 20,00'))
  })

  it('hoy y lo futuro quedan fuera de P/Q/R pero suman en lo invertido', () => {
    const items: PoolItem[] = [
      { phase: 'past', reservations: 11, guests: 29, row: ASTRAL_FULL },
      {
        phase: 'tonight',
        reservations: 3,
        guests: 8,
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
        row: row({ adSpendUsdCents: 2000, messages: null }),
      },
      { phase: 'past', reservations: 5, guests: 10, row: null },
      {
        phase: 'past',
        reservations: 5,
        guests: 10,
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
        row: row({ adSpendUsdCents: 8000, messages: 9 }),
      },
      {
        phase: 'past',
        reservations: 1,
        guests: 2,
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
        row: row({ adSpendUsdCents: 8000, messages: 9 }),
      },
      {
        phase: 'past',
        reservations: 2,
        guests: 4,
        row: row({ adSpendUsdCents: 1000, messages: 20 }),
      },
    ])
    expect(formatPercent(value(ok.Q.closingRate))).toBe(nb('55,2 %'))
  })

  it('Q cuenta solo las fechas con mensajes; P las cuenta a todas', () => {
    const pool = poolMarketing([
      { phase: 'past', reservations: 11, guests: 29, row: row() },
      {
        phase: 'past',
        reservations: 5,
        guests: 12,
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
        row: row({ adSpendUsdCents: 10000, revenueArsCents: 150_000_00, usdArsRate: 1000 }),
      },
      // US$ 50 de pauta, $ 130.000 a $ 1.300 = US$ 100.
      {
        phase: 'past',
        reservations: 5,
        guests: 10,
        row: row({ adSpendUsdCents: 5000, revenueArsCents: 130_000_00, usdArsRate: 1300 }),
      },
      // Sin facturación: no entra en R.
      { phase: 'past', reservations: 5, guests: 10, row: row({ adSpendUsdCents: 9900 }) },
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

  it('sin fechas pasadas con pauta, R es null y P no calcula', () => {
    const pool = poolMarketing([{ phase: 'future', reservations: 3, guests: 8, row: row() }])
    expect(pool.R).toBeNull()
    expect(reason(pool.P.costPerReservationUsd)).toBe('sin-pauta')
    expect(reason(pool.Q.closingRate)).toBe('sin-mensajes')
  })
})

describe('pooledStripSummary', () => {
  const X: PoolItem = { phase: 'past', reservations: 11, guests: 29, row: row() }
  const Y: PoolItem = {
    phase: 'past',
    reservations: 8,
    guests: 20,
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
        { phase: 'past', reservations: 4, guests: 9, row: null },
        {
          phase: 'tonight',
          reservations: 3,
          guests: 8,
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
        row: row({ adSpendUsdCents: 8000, messages: 9 }),
      },
      {
        phase: 'past',
        reservations: 2,
        guests: 4,
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
  it('los encabezados de §13', () => {
    expect(MARKETING_EXPORT_HEADERS.join('; ')).toBe(
      'Pauta USD; Mensajes; Alcance; Costo por mensaje USD; % de cierre; Costo por reserva USD; Costo por persona USD; Facturación ARS; Dólar; Retorno (USD facturados por USD de pauta); Pauta sobre facturación %; Nota',
    )
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
      'Campaña de reels del 1/9 al 9/9',
    ])
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
      { reservations: 14, guests: 30 },
      row({ adSpendUsdCents: 8000, messages: 9 }),
    )
    expect(more[4]).toBe('')
    expect(more[5]).toBe('5,71')
    const none = marketingCsvCells(
      { reservations: 0, guests: 0 },
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
    const block = { reservations: 1, guests: 2 }
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
    expect(marketingCsvCells({ reservations: 0, guests: 0 }, tiny)[4]).toBe('0')
  })

  it('«No tuvo pauta» escribe 0,00; sin fila o "Sin evento", todo vacío', () => {
    expect(marketingCsvCells(ASTRAL, row({ adSpendUsdCents: 0, messages: null }))).toEqual([
      '0,00',
      ...Array(11).fill(''),
    ])
    expect(marketingCsvCells(ASTRAL, null)).toEqual(Array(12).fill(''))
    expect(marketingCsvCells(null, row())).toEqual(Array(12).fill(''))
  })

  it('la nota lleva apóstrofo si Excel la leería como fórmula', () => {
    for (const note of ['=SUMA(A1)', '+54 351 555', '-3 días', '@campaña', '\tTab', '\rCR']) {
      expect(marketingCsvCells(ASTRAL, row({ notes: note }))[11]).toBe(`'${note}`)
    }
    expect(marketingCsvCells(ASTRAL, row({ notes: 'Campaña de reels' }))[11]).toBe(
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
    guests: 0,
    reservations: 0,
    avg: null,
    minParty: null,
    maxParty: null,
    attendedGuests: 0,
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
      'Fecha;Evento;Estado;Personas;Reservas;Pauta USD;Mensajes;Alcance;Costo por mensaje USD;% de cierre;Costo por reserva USD;Costo por persona USD;Facturación ARS;Dólar;Retorno (USD facturados por USD de pauta);Pauta sobre facturación %;Nota',
    )
    expect(lines[1]).toBe('2026-09-07;Ramen;sin cargar;0;0;;;;;;;;;;;;')
    expect(lines[2]).toBe(
      '2026-09-09;Noche Astral;completa;29;11;175,26;51;8420;3,44;21,6;15,93;6,04;2480000;1450;9,76;10,2;Campaña de reels del 1/9 al 9/9',
    )
    expect(lines[3]).toBe('2026-09-10;Pizza libre;sin pauta;50;20;0,00;;;;;;;;;;;')
    expect(lines[4]).toBe('2026-09-12;Tapeo;completa;30;14;80,00;9;;8,89;;5,71;2,67;;;;;')
    expect(lines[5]).toBe('2026-09-13;Jazz;incompleta;12;5;50,00;;;;;10,00;4,17;;;;;')
    // Hoy: lo cargado sí, los cocientes no (igual que la lista de la pantalla).
    expect(lines[6]).toBe('2026-09-15;Merienda y Arte;es hoy;8;3;60,00;12;;;;;;;;;;')
    expect(lines[7]).toBe('2026-09-26;Karaoke;todavía no pasó;0;0;;;;;;;;;;;;')
    // Antes era una sola fila que mezclaba P, Q y R (305,26 ÷ 60 no daba 4,25).
    // Cada total lleva solo las sumas de sus cocientes: se rehace con su fila.
    // P: 305,26 ÷ 30 = 10,18 · 305,26 ÷ 71 = 4,30.
    expect(lines[8]).toBe(
      'Total con pauta que ya pasó (3 fechas);;;71;30;305,26;;;;;10,18;4,30;;;;;',
    )
    // Q (sin Jazz): 255,26 ÷ 60 = 4,25 · 25 ÷ 60 = 41,7 % · 255,26 ÷ 25 = 10,21.
    expect(lines[9]).toBe(
      'Total con pauta que ya pasó, con mensajes cargados (2 fechas);;;;25;255,26;60;;4,25;41,7;10,21;;;;;;',
    )
    // R (solo Noche Astral): cada fecha pasa a dólares con SU dólar.
    expect(lines[10]).toBe(
      'Total con pauta que ya pasó, con facturación (1 fecha);;;;;175,26;;;;;;;2480000;;9,76;10,2;',
    )
    expect(lines[11]).toBe('Pauta de fechas que todavía no pasaron;;;;;60,00;;;;;;;;;;;')
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
    expect(futureLines.at(-1)).toBe('Pauta de fechas que todavía no pasaron;;;;;365,26;;;;;;;;;;;')

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
