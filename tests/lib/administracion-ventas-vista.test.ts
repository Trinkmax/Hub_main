import { describe, expect, it } from 'vitest'
import {
  receivableArrival,
  receivableTranches,
  walletBoxes,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/incoming'
import {
  cashCheckText,
  cashPending,
  closeHref,
  compliancePercent,
  dayCell,
  dayExtra,
  longDay,
  longDayTitle,
  nextCloseDay,
  nightPaceText,
  openNight,
  planillaHref,
  planillaTotals,
  rowAction,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/planilla'
import {
  detailParam,
  parseDetail,
  parseTab,
  periodWords,
  tabHref,
  VENTAS_TABS,
  VIEW_TITLES,
  ventasView,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/ventas-view'
import { monthDays } from '@/lib/accounting/home'
import { buildProjection, type ProjectionSourceDay } from '@/lib/accounting/projection'
import type { PartyListRow } from '@/lib/accounting/queries/parties'
import { eachIsoDay } from '@/lib/dates'

/**
 * Ventas: tres solapas y dos pantallas detrás del «⋯». Acá se fija lo que no puede romperse sin que
 * nadie lo note: que los siete `?tab=` de siempre sigan abriendo lo suyo, qué se puede hacer desde
 * cada renglón de la planilla (un día sin cargar nunca es un cero), los tres números de arriba y que
 * lo de Mercado Pago no figure como plata atrasada.
 */

const BASE = '/hub/administracion'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const TODAY = '2026-10-13'

describe('los siete ?tab= de siempre siguen valiendo', () => {
  it('cada pestaña lleva a su vista y dice qué trae abierto', () => {
    expect(ventasView('cierres')).toEqual({ view: 'mes', focus: null })
    expect(ventasView('proyeccion')).toEqual({ view: 'mes', focus: 'proyeccion' })
    expect(ventasView('caja')).toEqual({ view: 'mes', focus: 'caja' })
    expect(ventasView('clientes')).toEqual({ view: 'cobrar', focus: null })
    expect(ventasView('neto-por-medio')).toEqual({ view: 'llego', focus: null })
    expect(ventasView('cobros')).toEqual({ view: 'cobros', focus: null })
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

  it('lo que no es una pestaña cae en la planilla', () => {
    expect(parseTab(null)).toBe('cierres')
    expect(parseTab('')).toBe('cierres')
    expect(parseTab('cualquiera')).toBe('cierres')
    expect(parseTab('cobros')).toBe('cobros')
  })

  it('los links son los de siempre: la planilla va sin ?tab=', () => {
    expect(tabHref(BASE, 'cierres')).toBe(`${BASE}/ventas`)
    expect(tabHref(BASE, 'proyeccion')).toBe(`${BASE}/ventas?tab=proyeccion`)
    expect(tabHref(BASE, 'clientes', { filtro: 'atrasados' })).toBe(
      `${BASE}/ventas?tab=clientes&filtro=atrasados`,
    )
    expect(tabHref(BASE, 'facturas', { mes: null })).toBe(`${BASE}/ventas?tab=facturas`)
  })

  it('cada vista tiene su nombre para lectores: lo que se ve es la solapa', () => {
    expect(VIEW_TITLES).toEqual({
      mes: 'Proyección',
      cobrar: 'Por cobrar',
      llego: 'Lo que llegó',
      cobros: 'Cobros',
      facturas: 'Facturas',
    })
  })

  it('el período se dice de corrido', () => {
    const month = { kind: 'month', month: '2026-10', from: '', to: '', label: '' } as const
    expect(periodWords(month)).toBe('en octubre')
    expect(periodWords({ ...month, kind: 'range', month: null })).toBe('en ese período')
  })
})

describe('«Ver detalle»: se esconde por defecto', () => {
  it('la planilla abre sin el detalle; los dos links viejos, con él', () => {
    expect(parseDetail(null, null)).toBe(false)
    expect(parseDetail(null, 'proyeccion')).toBe(true)
    expect(parseDetail(null, 'caja')).toBe(true)
  })

  it('el interruptor manda sobre el link', () => {
    expect(parseDetail('1', null)).toBe(true)
    expect(parseDetail('0', 'caja')).toBe(false)
    expect(parseDetail('otra cosa', null)).toBe(false)
  })

  it('el parámetro solo va si cambia lo que abre esa URL', () => {
    expect(detailParam(false, null)).toBeNull()
    expect(detailParam(true, null)).toBe('1')
    expect(detailParam(true, 'caja')).toBeNull()
    expect(detailParam(false, 'caja')).toBe('0')
    // Ida y vuelta: siempre vuelve a lo mismo.
    for (const focus of [null, 'proyeccion', 'caja'] as const) {
      for (const detail of [true, false]) {
        expect(parseDetail(detailParam(detail, focus), focus)).toBe(detail)
      }
    }
  })
})

// ─── La planilla ─────────────────────────────────────────────────────────────

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

describe('cada renglón de la planilla', () => {
  it('el día se escribe corto: «lu 02»', () => {
    expect(dayCell('2026-11-02')).toBe('lu 02')
    expect(dayCell('2026-11-07')).toBe('sá 07')
    expect(dayCell('2026-11-08')).toBe('do 08')
    expect(dayCell('2026-13-40')).toBe('')
    expect(longDay('2026-11-02')).toBe('lunes 02/11')
  })

  it('debajo del día, el evento y la nota', () => {
    expect(dayExtra(['Noche de tacos'], '2x1 burger')).toBe('Noche de tacos · 2x1 burger')
    expect(dayExtra([], '2x1 burger')).toBe('2x1 burger')
    expect(dayExtra(['Noche de tacos'], null)).toBe('Noche de tacos')
    expect(dayExtra([], null)).toBeNull()
  })

  it('«Ver cierre» si lo tiene; «Cargar cierre» si ya llegó y falta; antes del arranque, nada', () => {
    expect(rowAction('loaded', true)).toBe('view')
    expect(rowAction('missing', true)).toBe('load')
    expect(rowAction('today', true)).toBe('load')
    expect(rowAction('future', true)).toBe('none')
    expect(rowAction('before', true)).toBe('none')
    expect(rowAction(undefined, true)).toBe('none')
  })

  it('quien solo mira ve el cierre, pero no carga nada', () => {
    expect(rowAction('loaded', false)).toBe('view')
    expect(rowAction('missing', false)).toBe('none')
    expect(rowAction('today', false)).toBe('none')
  })

  it('el cierre que toca es el primero que falta; si no falta ninguno, el de hoy', () => {
    const days = [{ day: '01' }, { day: '02' }, { day: '03' }]
    expect(nextCloseDay(days, { '01': 'loaded', '02': 'missing', '03': 'today' })).toBe('02')
    expect(nextCloseDay(days, { '01': 'loaded', '02': 'loaded', '03': 'today' })).toBe('03')
    expect(nextCloseDay(days, { '01': 'loaded', '02': 'loaded', '03': 'future' })).toBeNull()
  })

  it('el cumplimiento es el número: el verde o el rojo lo pone la pantalla', () => {
    expect(
      compliancePercent({ kind: 'value', percent: 84, side: 'below', gapPercent: 16 }),
    ).toEqual({ text: `84${NB}%`, good: false })
    expect(compliancePercent({ kind: 'value', percent: 100, side: 'on', gapPercent: 0 })).toEqual({
      text: `100${NB}%`,
      good: true,
    })
    expect(
      compliancePercent({ kind: 'value', percent: 120, side: 'above', gapPercent: 20 }),
    ).toEqual({ text: `120${NB}%`, good: true })
    // Un día sin cierre o sin objetivo no es 0 %.
    expect(compliancePercent({ kind: 'no_close' })).toBeNull()
    expect(compliancePercent({ kind: 'no_target' })).toBeNull()
    expect(compliancePercent({ kind: 'future' })).toBeNull()
  })

  it('la diferencia de caja va en palabras, nunca con un menos pelado', () => {
    expect(cashCheckText({ kind: 'compared', diffCents: -100_000 })).toBe(`Faltan $${NB}1.000`)
    expect(cashCheckText({ kind: 'compared', diffCents: 0 })).toBe('Coincide')
    expect(cashCheckText({ kind: 'missing_count' })).toBe('Falta cargar')
    expect(cashCheckText({ kind: 'missing_close' })).toBe('Falta el cierre')
    expect(cashCheckText({ kind: 'none' })).toBeNull()
  })

  it('lo que falta para comparar se dice por motivo', () => {
    expect(cashPending({ missingCountDays: 0, missingCloseDays: 0 })).toEqual([])
    expect(cashPending({ missingCountDays: 1, missingCloseDays: 2 })).toEqual([
      'A 1 día con cierre le falta cargar lo que entró.',
      'A 2 días con lo que entró les falta el cierre.',
    ])
  })
})

describe('los links de la planilla', () => {
  const link = { base: BASE, tab: null, month: null, detail: null }

  it('abrir una noche es un `?dia=`; cerrarla, la misma URL sin él', () => {
    expect(planillaHref(link, '2026-10-05')).toBe(`${BASE}/ventas?dia=2026-10-05`)
    expect(planillaHref(link, null)).toBe(`${BASE}/ventas`)
  })

  it('conserva el mes, el detalle y la pestaña por la que se entró', () => {
    expect(planillaHref({ ...link, month: '2026-09', detail: '1' }, '2026-09-05')).toBe(
      `${BASE}/ventas?mes=2026-09&detalle=1&dia=2026-09-05`,
    )
    expect(planillaHref({ ...link, tab: 'caja', detail: '0' }, null)).toBe(
      `${BASE}/ventas?tab=caja&detalle=0`,
    )
  })

  it('el cierre de un día', () => {
    expect(closeHref(BASE, '2026-10-05')).toBe(`${BASE}/ventas/cierre?fecha=2026-10-05`)
  })
})

describe('openNight: qué noche se abre', () => {
  const days = [
    { date: '2026-10-10', state: 'loaded' as const },
    { date: '2026-10-12', state: 'missing' as const },
    { date: '2026-10-13', state: 'today' as const },
    { date: '2026-10-14', state: 'future' as const },
  ]

  it('sin pedir nada no se abre ninguna: la planilla es la pantalla', () => {
    expect(openNight(null, days)).toBeNull()
  })

  it('la pedida, si tiene su cierre', () => {
    expect(openNight('2026-10-10', days)).toBe('2026-10-10')
  })

  it('un día sin cierre, de otro mes o roto no abre nada', () => {
    for (const requested of [
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-09-30',
      'cualquiera',
    ]) {
      expect(openNight(requested, days)).toBeNull()
    }
  })
})

describe('planillaTotals: los tres números de arriba', () => {
  const totals = (rows: ProjectionSourceDay[]) => {
    const projection = buildProjection(rows, { serviceDay: TODAY })
    return planillaTotals(projection.summary, {
      hasCloses: projection.days.some((d) => d.hasClose),
    })
  }
  const closed = (day: string) => day < '2026-10-05'

  it('un mes sin objetivos ni cierres no dice «$ 0» por ningún lado', () => {
    const [target, sold, remaining] = totals(source())
    expect(target).toMatchObject({ label: 'Objetivo del mes', cents: null })
    expect(sold).toMatchObject({ label: 'Vendido', cents: null })
    expect(remaining).toMatchObject({ label: 'Falta vender', cents: null })
  })

  it('objetivo del mes, lo vendido (la venta neta) y lo que falta', () => {
    const rows = source((day) => ({
      targetCents: 100_000_000,
      ...(closed(day)
        ? { closes: 1, salonCents: 100_000_000, salonCommissionCents: 5_000_000 }
        : {}),
    }))
    const [target, sold, remaining] = totals(rows)
    expect(target).toMatchObject({ cents: 3_100_000_000 })
    expect(sold).toMatchObject({ cents: 380_000_000, tone: 'ok' })
    expect(remaining).toMatchObject({ label: 'Falta vender', cents: 2_720_000_000 })
  })

  it('debajo del objetivo del mes, el objetivo a hoy: el mismo número que pidieron los socios', () => {
    const rows = source((day) => ({
      targetCents: 100_000_000,
      ...(closed(day) ? { closes: 1, salonCents: 100_000_000 } : {}),
    }))
    // Hasta el 12 (hoy es el 13 y todavía no tiene cierre): 12 días de $ 1.000.000.
    expect(totals(rows)[0]?.hint).toBe(`Objetivo a hoy $${NB}12.000.000`)
  })

  it('un mes terminado habla en pasado y no tiene «a hoy»', () => {
    const rows = source((day) => ({
      targetCents: 100_000_000,
      ...(closed(day) ? { closes: 1, salonCents: 100_000_000 } : {}),
    }))
    const projection = buildProjection(rows, { serviceDay: '2026-11-04' })
    const [target, , remaining] = planillaTotals(projection.summary, { hasCloses: true })
    expect(target?.hint).toBeUndefined()
    expect(remaining?.label).toBe('Faltó vender')
  })

  it('pasado el objetivo, el tercer número dice por cuánto', () => {
    const rows = source((day) => ({
      targetCents: day === '2026-10-01' ? 100_000_000 : null,
      ...(day === '2026-10-01' ? { closes: 1, salonCents: 150_000_000 } : {}),
    }))
    expect(totals(rows)[2]).toMatchObject({
      label: 'Arriba del objetivo',
      cents: 50_000_000,
      tone: 'ok',
    })
  })

  it('la suma de los renglones es el número de arriba', () => {
    const rows = source((day) =>
      closed(day) ? { closes: 1, salonCents: 90_000_000, deliveryCents: 10_000_000 } : {},
    )
    const projection = buildProjection(rows, { serviceDay: TODAY })
    const sum = projection.days.reduce((total, d) => total + (d.hasClose ? d.netCents : 0), 0)
    expect(projection.summary.soldCents).toBe(sum)
    const days = monthDays(projection, { booksStartDate: '2026-10-01' })
    expect(days.days.filter((d) => d.state === 'loaded')).toHaveLength(4)
  })
})

describe('la noche', () => {
  it('la pastilla dice una sola cosa', () => {
    expect(nightPaceText({ kind: 'value', percent: 84, side: 'below', gapPercent: 16 })).toBe(
      `16${NB}% abajo del objetivo`,
    )
    expect(nightPaceText({ kind: 'value', percent: 108, side: 'above', gapPercent: 8 })).toBe(
      `8${NB}% arriba del objetivo`,
    )
    expect(nightPaceText({ kind: 'value', percent: 100, side: 'on', gapPercent: 0 })).toBe(
      'Justo en el objetivo',
    )
  })

  it('el título: «Miércoles 7 de octubre»', () => {
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
    expect(receivableArrival(mp, { today: TODAY, wallet: true })).toEqual({
      kind: 'wallet',
      text: 'Falta contarla',
      note: null,
    })
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
