import { describe, expect, it } from 'vitest'
import {
  almanacCells,
  cellAmount,
  cellShort,
  defaultDay,
  longDayTitle,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/almanac'
import {
  receivableMeta,
  receivableRail,
  receivableTranches,
  walletBoxes,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/incoming'
import {
  parseTab,
  tabHref,
  VENTAS_TABS,
  ventasView,
  viewHref,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/ventas-view'
import { monthDays } from '@/lib/accounting/home'
import { buildProjection, type ProjectionSourceDay } from '@/lib/accounting/projection'
import type { PartyListRow } from '@/lib/accounting/queries/parties'
import { eachIsoDay } from '@/lib/dates'

/**
 * Ventas pasó de siete pestañas a cuatro vistas y un almanaque. Acá se fija
 * lo que no puede romperse sin que nadie lo note: que los siete `?tab=` de
 * siempre sigan abriendo lo suyo, qué dice cada casillero según su estado (un
 * día sin cargar nunca es un cero), qué noche se muestra al lado y que lo de
 * Mercado Pago no figure como plata atrasada.
 */

const BASE = '/hub/administracion'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const TODAY = '2026-10-13'

describe('los siete ?tab= de siempre siguen valiendo', () => {
  it('cada pestaña lleva a su vista y trae su bloque', () => {
    expect(ventasView('cierres')).toEqual({ view: 'mes', focus: null })
    expect(ventasView('proyeccion')).toEqual({ view: 'mes', focus: 'proyeccion' })
    expect(ventasView('caja')).toEqual({ view: 'mes', focus: 'caja' })
    expect(ventasView('clientes')).toEqual({ view: 'cobrar', focus: null })
    expect(ventasView('neto-por-medio')).toEqual({ view: 'llego', focus: null })
    expect(ventasView('cobros')).toEqual({ view: 'llego', focus: 'cobros' })
    expect(ventasView('facturas')).toEqual({ view: 'facturas', focus: null })
  })

  it('no se perdió ni se renombró ninguna', () => {
    expect([...VENTAS_TABS]).toEqual([
      'cierres',
      'proyeccion',
      'caja',
      'clientes',
      'cobros',
      'neto-por-medio',
      'facturas',
    ])
  })

  it('lo que no es una pestaña cae en «El mes»', () => {
    expect(parseTab(null)).toBe('cierres')
    expect(parseTab('')).toBe('cierres')
    expect(parseTab('cualquiera')).toBe('cierres')
    expect(parseTab('cobros')).toBe('cobros')
  })

  it('los links son los de siempre: «El mes» va sin ?tab=', () => {
    expect(tabHref(BASE, 'cierres')).toBe(`${BASE}/ventas`)
    expect(tabHref(BASE, 'proyeccion')).toBe(`${BASE}/ventas?tab=proyeccion`)
    expect(tabHref(BASE, 'clientes', { filtro: 'atrasados' })).toBe(
      `${BASE}/ventas?tab=clientes&filtro=atrasados`,
    )
  })

  it('el mes elegido se conserva entre las vistas que miran un mes, y solo ahí', () => {
    expect(viewHref(BASE, 'mes', '2026-09')).toBe(`${BASE}/ventas?mes=2026-09`)
    expect(viewHref(BASE, 'llego', '2026-09')).toBe(`${BASE}/ventas?tab=neto-por-medio&mes=2026-09`)
    expect(viewHref(BASE, 'facturas', '2026-09')).toBe(`${BASE}/ventas?tab=facturas&mes=2026-09`)
    expect(viewHref(BASE, 'cobrar', '2026-09')).toBe(`${BASE}/ventas?tab=clientes`)
    // Sin mes en la URL no se inventa uno.
    expect(viewHref(BASE, 'llego')).toBe(`${BASE}/ventas?tab=neto-por-medio`)
  })
})

// ─── El almanaque ────────────────────────────────────────────────────────────

function source(
  over: (day: string) => Partial<ProjectionSourceDay> = () => ({}),
): ProjectionSourceDay[] {
  return eachIsoDay('2026-10-01', '2026-10-31').map((day) => ({
    day,
    targetCents: null,
    note: null,
    closes: 0,
    salonCents: 0,
    deliveryCents: 0,
    eventsCents: 0,
    salonCommissionCents: 0,
    deliveryCommissionCents: 0,
    eventsCommissionCents: 0,
    cashCountedCents: null,
    ...over(day),
  }))
}

function almanac(
  rows: ProjectionSourceDay[],
  opts: {
    booksStartDate?: string | null
    canWrite?: boolean
    selected?: string | null
    events?: Record<string, string[]> | null
    month?: string | null
  } = {},
) {
  const projection = buildProjection(rows, { serviceDay: TODAY })
  const days = monthDays(projection, { booksStartDate: opts.booksStartDate ?? '2026-10-01' })
  const cells = almanacCells({
    days: days.days,
    projection: projection.days,
    events: opts.events === undefined ? {} : opts.events,
    base: BASE,
    month: opts.month ?? null,
    canWrite: opts.canWrite ?? true,
    selected: opts.selected ?? null,
  })
  const cell = (date: string) => {
    const found = cells.find((c) => c.date === date)
    if (!found) throw new Error(`sin celda para ${date}`)
    return found
  }
  return { cells, cell, days }
}

describe('almanacCells: qué dice cada casillero', () => {
  it('el mes vacío de un bar que arrancó a mitad de mes: antes, falta, hoy y por venir', () => {
    const { cells, cell } = almanac(source(), { booksStartDate: '2026-10-12' })
    expect(cells).toHaveLength(31)
    expect(cell('2026-10-05').state).toBe('before')
    expect(cell('2026-10-12').state).toBe('missing')
    expect(cell('2026-10-13').state).toBe('today')
    expect(cell('2026-10-20').state).toBe('future')
    // Lo anterior al arranque no se toca ni dice nada.
    expect(cell('2026-10-05').href).toBeUndefined()
    expect(cell('2026-10-05').value ?? null).toBeNull()
  })

  it('un día sin cargar nunca es un cero: no se llena ni dice «$ 0»', () => {
    const { cells } = almanac(source(), { booksStartDate: '2026-10-01' })
    for (const cell of cells) {
      expect(cell.fill ?? null).toBeNull()
      expect(`${cell.value ?? ''} ${cell.valueShort ?? ''} ${cell.label}`).not.toMatch(/\$\s?0\b/)
    }
    expect(cells.filter((c) => c.state === 'missing').every((c) => c.value === 'falta')).toBe(true)
  })

  it('tocar un día que falta lo carga en un toque; a quien solo mira no lo lleva a ningún lado', () => {
    const owner = almanac(source(), { canWrite: true }).cell('2026-10-08')
    expect(owner.href).toBe(`${BASE}/ventas/cierre?fecha=2026-10-08`)
    expect(owner.label).toBe('Jueves 8 de octubre: falta el cierre. Abre la carga de ese día.')
    const reader = almanac(source(), { canWrite: false }).cell('2026-10-08')
    expect(reader.href).toBeUndefined()
    expect(reader.label).toBe('Jueves 8 de octubre: falta el cierre.')
  })

  it('una noche cargada: la venta neta, su cumplimiento, su relleno y la raya del objetivo', () => {
    const rows = source((day) =>
      day === '2026-10-07'
        ? {
            closes: 1,
            salonCents: 120_074_600,
            salonCommissionCents: 6_271_700,
            targetCents: 123_700_000,
          }
        : day === '2026-10-09'
          ? { closes: 1, salonCents: 200_000_000, targetCents: 150_000_000 }
          : {},
    )
    const { cell } = almanac(rows, { events: { '2026-10-07': ['Noche de tacos'] } })
    const night = cell('2026-10-07')
    expect(night.state).toBe('loaded')
    expect(night.value).toBe(`$${NB}1.138.029`)
    expect(night.valueShort).toBe(`1,1${NB}M`)
    expect(night.badge).toEqual({ text: '92 %', tone: 'warn', glyph: 'down' })
    expect(night.dot).toBe(true)
    expect(night.note).toBe('Noche de tacos')
    expect(night.label).toBe(
      `Miércoles 7 de octubre: $${NB}1.138.029, sin las comisiones estimadas. 92 % del objetivo. Noche de tacos.`,
    )
    // Elegir una noche es un `?dia=`: no la abre en otra pantalla.
    expect(night.href).toBe(`${BASE}/ventas?dia=2026-10-07`)
    // Misma escala para el relleno y la raya: el tope es la venta más alta del mes.
    expect(night.fill).toBeCloseTo(113_802_900 / 200_000_000, 5)
    expect(night.marker).toBeCloseTo(123_700_000 / 200_000_000, 5)
    // La noche que pasó su objetivo se llena por encima de su raya.
    const best = cell('2026-10-09')
    expect(best.badge).toEqual({ text: '133 %', tone: 'ok', glyph: 'up' })
    expect(best.fill).toBe(1)
    expect((best.fill ?? 0) > (best.marker ?? 1)).toBe(true)
  })

  it('una noche chica igual se ve: el relleno mínimo es 6 %', () => {
    const rows = source((day) =>
      day === '2026-10-02'
        ? { closes: 1, salonCents: 100_000 }
        : day === '2026-10-03'
          ? { closes: 1, salonCents: 900_000_000 }
          : {},
    )
    expect(almanac(rows).cell('2026-10-02').fill).toBe(0.06)
  })

  it('una noche cargada en cero dice su cero, pero no se llena', () => {
    const rows = source((day) => (day === '2026-10-02' ? { closes: 1 } : {}))
    const cell = almanac(rows).cell('2026-10-02')
    expect(cell.state).toBe('loaded')
    expect(cell.value).toBe(`$${NB}0`)
    expect(cell.fill ?? null).toBeNull()
  })

  it('hoy y los días por venir muestran su objetivo, si lo tienen', () => {
    const rows = source((day) => (day >= '2026-10-13' ? { targetCents: 150_000_000 } : {}))
    const { cell } = almanac(rows, { month: '2026-10' })
    expect(cell('2026-10-13').caption).toBe(`obj. $${NB}1,5${NB}M`)
    expect(cell('2026-10-13').value).toBe('hoy')
    expect(cell('2026-10-20').caption).toBe(`obj. $${NB}1,5${NB}M`)
    // Con un mes en la URL, se conserva al elegir el día.
    expect(cell('2026-10-20').href).toBe(`${BASE}/ventas?mes=2026-10&dia=2026-10-20`)
  })

  it('quien no lee el calendario no ve los eventos, pero sí las notas', () => {
    const rows = source((day) => (day === '2026-10-20' ? { note: '2x1 burger' } : {}))
    const { cell } = almanac(rows, { events: null })
    expect(cell('2026-10-20').dot).toBe(true)
    expect(cell('2026-10-20').note).toBe('2x1 burger')
    expect(cell('2026-10-21').dot).toBe(false)
  })

  it('marca la noche elegida, y solo esa', () => {
    const { cells } = almanac(source(), { selected: '2026-10-20' })
    expect(cells.filter((c) => c.selected).map((c) => c.date)).toEqual(['2026-10-20'])
  })
})

describe('cellAmount y cellShort: el importe entra en el casillero', () => {
  it('hasta $ 9.999.999 va entero; desde $ 10 M, abreviado', () => {
    expect(cellAmount(113_802_900)).toBe(`$${NB}1.138.029`)
    expect(cellAmount(999_999_900)).toBe(`$${NB}9.999.999`)
    expect(cellAmount(1_000_000_000)).toBe(`$${NB}10${NB}M`)
    expect(cellAmount(1_240_000_000)).toBe(`$${NB}12,4${NB}M`)
  })

  it('nueve cifras no desbordan: siete caracteres como mucho en el celular', () => {
    expect(cellAmount(12_345_678_900)).toBe(`$${NB}123,5${NB}M`)
    expect(cellShort(12_345_678_900)).toBe(`123,5${NB}M`)
    expect(cellShort(12_345_678_900).length).toBeLessThanOrEqual(7)
    expect(cellShort(113_802_900)).toBe(`1,1${NB}M`)
  })

  it('en el celular, de $ 100.000 a $ 1 M va en millones: «806 mil» no entra en 42 px', () => {
    expect(cellShort(80_579_400)).toBe(`0,8${NB}M`)
    expect(cellShort(10_000_000)).toBe(`0,1${NB}M`)
    expect(cellShort(97_000_000)).toBe(`1${NB}M`)
    // Más chico que eso son dos cifras y sí entra con su «mil».
    expect(cellShort(8_500_000)).toBe(`85${NB}mil`)
    // Ninguno pasa de cinco caracteres.
    for (const cents of [10_000_000, 55_500_000, 99_999_999]) {
      expect(cellShort(cents).length).toBeLessThanOrEqual(5)
    }
  })

  it('cero y lo que no es un número', () => {
    expect(cellAmount(0)).toBe(`$${NB}0`)
    expect(cellShort(0)).toBe('0')
    expect(cellAmount(Number.NaN)).toBe('')
    expect(cellShort(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('defaultDay: qué noche se muestra al lado', () => {
  const days = [
    { date: '2026-10-10', state: 'loaded' as const },
    { date: '2026-10-11', state: 'loaded' as const },
    { date: '2026-10-12', state: 'missing' as const },
    { date: '2026-10-13', state: 'today' as const },
    { date: '2026-10-14', state: 'future' as const },
  ]

  it('sin pedir nada, la última noche cargada', () => {
    expect(defaultDay({ requested: null, days })).toBe('2026-10-11')
  })

  it('el día pedido, si se puede elegir (cargado, hoy o por venir)', () => {
    expect(defaultDay({ requested: '2026-10-10', days })).toBe('2026-10-10')
    expect(defaultDay({ requested: '2026-10-13', days })).toBe('2026-10-13')
    expect(defaultDay({ requested: '2026-10-14', days })).toBe('2026-10-14')
  })

  it('un día que falta, de otro mes o roto se ignora', () => {
    expect(defaultDay({ requested: '2026-10-12', days })).toBe('2026-10-11')
    expect(defaultDay({ requested: '2026-09-30', days })).toBe('2026-10-11')
    expect(defaultDay({ requested: 'cualquiera', days })).toBe('2026-10-11')
  })

  it('un mes sin ninguna noche no elige nada; uno que no empezó abre en su día 1', () => {
    expect(
      defaultDay({ requested: null, days: [{ date: '2026-10-12', state: 'missing' }] }),
    ).toBeNull()
    expect(defaultDay({ requested: null, days: [] })).toBeNull()
    expect(
      defaultDay({
        requested: null,
        days: [
          { date: '2026-11-01', state: 'future' },
          { date: '2026-11-02', state: 'future' },
        ],
      }),
    ).toBe('2026-11-01')
  })
})

describe('longDayTitle', () => {
  it('«Miércoles 7 de octubre»', () => {
    expect(longDayTitle('2026-10-07')).toBe('Miércoles 7 de octubre')
    expect(longDayTitle('2026-13-40')).toBe('')
  })
})

// ─── La billetera no está «atrasada» ─────────────────────────────────────────

function party(over: Partial<PartyListRow>): PartyListRow {
  return {
    partyId: 'p',
    partyName: 'Alguien',
    partyKind: 'card_processor',
    taxId: null,
    tradeName: null,
    active: true,
    systemKey: null,
    debtCents: 0,
    creditCents: 0,
    netCents: 0,
    notDueCents: 0,
    dueSoonCents: 0,
    overdue1to30Cents: 0,
    overdue31to60Cents: 0,
    overdue60PlusCents: 0,
    noDueCents: 0,
    overdueCents: 0,
    oldestDueDate: null,
    nextDueDate: null,
    lastIncreaseDate: null,
    trafficLight: 'green',
    trafficText: '',
    ...over,
  }
}

describe('Mercado Pago va aparte, no como plata atrasada', () => {
  const rows = [
    party({
      partyId: 'posnet',
      partyName: 'Tarjetas de crédito (Posnet)',
      debtCents: 253_615_080,
      overdueCents: 147_995_440,
      dueSoonCents: 105_619_640,
      oldestDueDate: '2026-10-07',
      nextDueDate: '2026-10-13',
    }),
    party({
      partyId: 'mp',
      partyName: 'Mercado Pago',
      partyKind: 'payment_wallet',
      debtCents: 40_000_000,
      overdueCents: 40_000_000,
      oldestDueDate: '2026-10-12',
    }),
  ]
  const boxes = [
    { id: 'caja-mp', name: 'Mercado Pago', bankPartyId: 'mp', active: true },
    { id: 'caja', name: 'Caja', bankPartyId: null, active: true },
  ]

  it('la billetera con su caja se reconoce por el pagador', () => {
    const wallets = walletBoxes(rows, boxes)
    expect([...wallets.keys()]).toEqual(['mp'])
    expect(wallets.get('mp')).toEqual({ treasuryId: 'caja-mp', name: 'Mercado Pago' })
    // Una billetera sin caja propia (o con la caja desactivada) se cobra como cualquiera.
    expect(walletBoxes(rows, [{ ...boxes[0], active: false }] as typeof boxes).size).toBe(0)
  })

  it('lo suyo no suma a «ya tendría que haber llegado»', () => {
    const tranches = receivableTranches(rows, new Set(['mp']))
    expect(tranches).toEqual({
      totalCents: 293_615_080,
      lateCents: 147_995_440,
      weekCents: 105_619_640,
      laterCents: 0,
      walletCents: 40_000_000,
      lateParties: 1,
    })
  })

  it('sin saber qué es una billetera, la base la cuenta como atrasada (lo que se corrige)', () => {
    expect(receivableTranches(rows, new Set()).lateCents).toBe(187_995_440)
  })

  it('su renglón dice que falta contarla, no cuántos días lleva tarde', () => {
    const mp = rows[1]
    if (!mp) throw new Error('falta la fila')
    expect(receivableRail(mp, { today: TODAY, wallet: true })).toEqual({
      kind: 'wallet',
      unit: 'sin contar',
      tone: 'muted',
    })
    expect(receivableMeta(mp, { today: TODAY, walletName: 'Mercado Pago' })).toBe(
      'Ya está en tu Mercado Pago: contala para anotarlo',
    )
  })

  it('los tramos nunca suman más que la deuda, aunque la base traiga de más', () => {
    const odd = receivableTranches(
      [party({ debtCents: 1_000, overdueCents: 900, dueSoonCents: 900 })],
      new Set(),
    )
    expect(odd.lateCents + odd.weekCents + odd.laterCents).toBe(1_000)
    expect(odd.weekCents).toBe(100)
  })

  it('sin nadie que deba, todo en cero', () => {
    expect(receivableTranches([], new Set()).totalCents).toBe(0)
    expect(receivableTranches([party({ creditCents: 5_000 })], new Set()).totalCents).toBe(0)
  })
})
