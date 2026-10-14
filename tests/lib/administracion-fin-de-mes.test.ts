import { describe, expect, it } from 'vitest'
import {
  focusMonth,
  type MonthPeriod,
  monthHeadline,
  monthState,
  monthStripModel,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/months'
import type { ChecklistItemLike } from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/checklist'
import {
  closeHeadline,
  closeReview,
  closeStripDays,
  closeWaitText,
  firstReviewAction,
  ivaClosePlan,
  type ReviewCalendar,
  type ReviewChecklist,
  type ReviewInput,
  stepStates,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/review'
import { eachIsoDay } from '@/lib/dates'

/**
 * «Fin de mes» en palabras (puro): qué mes se abre, qué dice el título, qué
 * paso toca y los renglones de la revisión. Lo más importante de este archivo
 * son los tres silencios de la base: sin cierres del día, sin movimientos en
 * las cajas y con gastos fijos que vencen el mes que viene, la base NO avisa
 * nada, y aun así la pantalla no puede decir «está todo bien».
 */

/** La plata lleva un espacio duro entre el «$» y el número: acá se compara contra texto común. */
const plain = (text: string | null | undefined) => (text ?? '').replaceAll('\u00a0', ' ')

const BASE = '/hub/administracion'
const PATH = `${BASE}/libros/cierres`

function month(
  ym: string,
  status: 'open' | 'closed' = 'open',
  extra: Partial<MonthPeriod> = {},
): MonthPeriod {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    id: `p-${ym}`,
    kind: 'month',
    month: `${ym}-01`,
    startsOn: `${ym}-01`,
    endsOn: `${ym}-${String(last).padStart(2, '0')}`,
    status,
    closedAt: null,
    closedByName: null,
    ...extra,
  }
}

/** HUB el 13/10: el ejercicio arranca el 12/10 y no hay ningún mes cerrado. */
const HUB = [
  month('2026-10', 'open', { startsOn: '2026-10-12' }),
  month('2026-11'),
  month('2026-12'),
]
/** El bar de ejemplo: septiembre terminó y sigue abierto. */
const DEMO = [month('2026-09'), month('2026-10'), month('2026-11'), month('2026-12')]
const TODAY = '2026-10-13'

function item(key: string, extra: Partial<ChecklistItemLike> = {}): ChecklistItemLike {
  return { key, label: key, detail: {}, amountCents: null, count: null, ...extra }
}

function checklist(over: Partial<ReviewChecklist> = {}): ReviewChecklist {
  return { canClose: false, blockers: [], warnings: [], info: [], ...over }
}

/** Un almanaque de octubre con los días que se indiquen cargados (desde el arranque hasta ayer). */
function calendar(opts: {
  monthYm: string
  from?: string
  serviceDay: string
  loaded: readonly string[]
}): ReviewCalendar {
  const [y, m] = opts.monthYm.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const first = `${opts.monthYm}-01`
  const end = `${opts.monthYm}-${String(last).padStart(2, '0')}`
  const start = opts.from ?? first
  const loaded = new Set(opts.loaded)
  let loadedDays = 0
  let missingDays = 0
  let soldCents = 0
  const days = eachIsoDay(first, end).map((date) => {
    let status: ReviewCalendar['days'][number]['status']
    if (date < start) status = 'before_start'
    else if (loaded.has(date)) status = 'loaded'
    else if (date === opts.serviceDay) status = 'pending'
    else if (date > opts.serviceDay) status = 'future'
    else status = 'missing'
    if (status === 'loaded') {
      loadedDays += 1
      soldCents += 100_000_00
    }
    if (status === 'missing') missingDays += 1
    return { date, status, totalCents: status === 'loaded' ? 100_000_00 : null }
  })
  return { days, soldCents, loadedDays, missingDays, serviceDay: opts.serviceDay }
}

function review(over: Partial<ReviewInput> = {}) {
  return closeReview({
    month: '2026-10',
    base: BASE,
    finished: false,
    canWrite: true,
    checklist: checklist(),
    calendar: calendar({ monthYm: '2026-10', serviceDay: TODAY, loaded: [] }),
    settings: { openingStatus: 'posted', cuit: '30-12345678-9' },
    ...over,
  })
}

describe('qué mes se abre sin `?mes=`', () => {
  it('HUB hoy: octubre (nada terminó ni se cerró)', () => {
    expect(focusMonth(HUB, TODAY)).toBe('2026-10')
  })

  it('el bar de ejemplo: septiembre, el primero que terminó y sigue abierto', () => {
    expect(focusMonth(DEMO, TODAY)).toBe('2026-09')
  })

  it('recién cerrado (hace 3 días): se queda en ese mes, para mandar los libros', () => {
    const closed = [
      month('2026-09', 'closed', { closedAt: '2026-10-10T15:00:00Z', closedByName: 'Franco' }),
      month('2026-10'),
    ]
    expect(focusMonth(closed, TODAY)).toBe('2026-09')
  })

  it('cerrado hace 20 días: el mes de hoy', () => {
    const closed = [
      month('2026-09', 'closed', { closedAt: '2026-09-23T15:00:00Z', closedByName: 'Franco' }),
      month('2026-10'),
    ]
    expect(focusMonth(closed, TODAY)).toBe('2026-10')
  })

  it('el cierre se mide con el día de Córdoba, no con el de UTC', () => {
    // 03/10 01:30 UTC = 02/10 22:30 en Córdoba: son 11 días al 13/10 → ya no se queda.
    const closed = [month('2026-09', 'closed', { closedAt: '2026-10-03T01:30:00Z' })]
    expect(focusMonth([...closed, month('2026-10')], TODAY)).toBe('2026-10')
  })

  it('sin períodos: el mes de hoy', () => {
    expect(focusMonth([], TODAY)).toBe('2026-10')
  })

  it('«Apertura» y «Ajustes de cierre» no son meses', () => {
    const adjustments: MonthPeriod = { ...month('2026-09'), kind: 'fy_adjustments', id: 'aj' }
    expect(focusMonth([adjustments, month('2026-10')], TODAY)).toBe('2026-10')
  })
})

describe('las pestañas del año', () => {
  it('cada mes con su estado; el que no empezó no lleva link', () => {
    const strip = monthStripModel(DEMO, {
      today: TODAY,
      selected: '2026-09',
      hrefFor: (m) => `/libros?mes=${m}`,
    })
    expect(strip.map((m) => [m.key, m.label, m.state])).toEqual([
      ['2026-09', 'Sep', 'to_close'],
      ['2026-10', 'Oct', 'current'],
      ['2026-11', 'Nov', 'future'],
      ['2026-12', 'Dic', 'future'],
    ])
    expect(strip[0]?.selected).toBe(true)
    expect(strip[0]?.href).toBe('/libros?mes=2026-09')
    expect(strip[2]?.href).toBeUndefined()
  })

  it('cerrado: el detalle dice quién y cuándo; con cambio posterior, lleva aviso', () => {
    const closed = month('2026-09', 'closed', {
      closedAt: '2026-10-05T15:00:00Z',
      closedByName: 'Franco',
    })
    const [cell] = monthStripModel([closed], {
      today: TODAY,
      selected: null,
      hrefFor: (m) => m,
      alertIds: new Set([closed.id]),
    })
    expect(cell?.state).toBe('closed')
    expect(cell?.title).toBe('Cerrado el 05/10/2026 por Franco')
    expect(cell?.alert).toBe(true)
    expect(monthState(closed, TODAY)).toBe('closed')
  })
})

describe('el título del mes en /libros', () => {
  const books = `${BASE}/libros`
  const base = { today: TODAY, canWrite: true, booksPath: books }

  it('en curso (HUB hoy): se dice desde cuándo se puede cerrar y el botón es callado', () => {
    const h = monthHeadline({
      ...base,
      month: '2026-10',
      period: HUB[0] ?? null,
      earlierOpen: null,
    })
    expect(h.title).toBe('Octubre está en curso')
    expect(h.sentence).toBe(
      'Se puede cerrar desde el 01/11/2026. Lo que cargues con fecha de octubre entra en este mes.',
    )
    expect(h.action).toEqual({
      label: 'Ver cómo viene el fin de mes',
      href: `${books}/cierres?mes=2026-10`,
      emphasis: 'outline',
    })
  })

  it('terminó y es el próximo a cerrar (el ejemplo hoy): botón primario', () => {
    const h = monthHeadline({
      ...base,
      month: '2026-09',
      period: DEMO[0] ?? null,
      earlierOpen: null,
    })
    expect(h.title).toBe('Septiembre terminó y falta cerrarlo')
    expect(h.action).toEqual({
      label: 'Revisar y cerrar septiembre',
      href: `${books}/cierres?mes=2026-09`,
      emphasis: 'primary',
    })
  })

  it('terminó y hay otro antes: los meses se cierran en orden', () => {
    const today = '2026-11-05'
    const h = monthHeadline({
      ...base,
      today,
      month: '2026-10',
      period: DEMO[1] ?? null,
      earlierOpen: DEMO[0] ?? null,
    })
    expect(h.title).toBe('Antes de octubre hay que cerrar septiembre')
    expect(h.sentence).toBe('Los meses se cierran en orden.')
    expect(h.action).toEqual({
      label: 'Ir a septiembre',
      href: `${books}?mes=2026-09`,
      emphasis: 'primary',
    })
  })

  it('cerrado: el paso que sigue es mandarle los libros a la contadora', () => {
    const closed = month('2026-09', 'closed', {
      closedAt: '2026-10-05T15:00:00Z',
      closedByName: 'Franco',
    })
    const h = monthHeadline({ ...base, month: '2026-09', period: closed, earlierOpen: null })
    expect(h.title).toBe('Septiembre está cerrado')
    expect(h.sentence).toBe(
      'Lo cerró Franco el 05/10/2026. Ya le podés mandar los libros a tu contadora.',
    )
    expect(h.action?.href).toBe(`${books}/cierres?mes=2026-09#paso-3`)
  })

  it('la contadora: el mismo título, sin botón; en un mes abierto, el link a lo que falta', () => {
    const open = monthHeadline({
      ...base,
      canWrite: false,
      month: '2026-09',
      period: DEMO[0] ?? null,
      earlierOpen: null,
    })
    expect(open.title).toBe('Septiembre terminó y falta cerrarlo')
    expect(open.sentence).toBe('Sigue abierto: lo cierran los dueños.')
    expect(open.action).toBeNull()
    expect(open.link).toEqual({
      label: 'Ver qué le falta para cerrarse',
      href: `${books}/cierres?mes=2026-09`,
    })
    const closed = monthHeadline({
      ...base,
      canWrite: false,
      month: '2026-09',
      period: month('2026-09', 'closed', {
        closedAt: '2026-10-05T15:00:00Z',
        closedByName: 'Franco',
      }),
      earlierOpen: null,
    })
    expect(closed.sentence).toBe('Lo cerró Franco el 05/10/2026.')
    expect(closed.action).toBeNull()
    expect(closed.link).toBeNull()
  })

  it('un mes sin libros (o que no empezó) no afirma nada más que eso', () => {
    const h = monthHeadline({
      ...base,
      month: '2026-11',
      period: DEMO[2] ?? null,
      earlierOpen: null,
      unavailable: 'Noviembre 2026 todavía no empezó.',
    })
    expect(h).toEqual({
      kind: 'unavailable',
      title: 'Noviembre 2026 todavía no empezó.',
      sentence: null,
      action: null,
      link: null,
    })
  })
})

describe('la afirmación de «Fin de mes»: los ocho casos', () => {
  const sep = { endsOn: '2026-09-30', status: 'open' as const, closedAt: null, closedByName: null }
  const oct = { endsOn: '2026-10-31', status: 'open' as const, closedAt: null, closedByName: null }
  const base = {
    today: TODAY,
    canWrite: true,
    blockersCount: 0,
    blockerWords: null,
    earlierOpen: null,
    path: PATH,
  }

  it('1 · en curso, solo frena la fecha', () => {
    const h = closeHeadline({ ...base, month: '2026-10', period: oct, checklist: checklist() })
    expect(h.lead).toBe('Octubre todavía no terminó.')
    expect(h.rest).toBe(
      'Se puede cerrar desde el 01/11/2026. Abajo está lo que conviene ir dejando listo.',
    )
  })

  it('2 · en curso y además falta algo que frena (HUB hoy)', () => {
    const h = closeHeadline({
      ...base,
      month: '2026-10',
      period: oct,
      checklist: checklist({ blockers: [item('month_not_finished'), item('opening_pending')] }),
      blockersCount: 1,
      blockerWords: 'decir cuánta plata había al arrancar',
    })
    expect(`${h.lead} ${h.rest}`).toBe(
      'Octubre todavía no terminó. Se puede cerrar desde el 01/11/2026, y antes falta 1 cosa: decir cuánta plata había al arrancar.',
    )
  })

  it('3 · terminó y algo lo frena', () => {
    const h = closeHeadline({
      ...base,
      month: '2026-09',
      period: sep,
      checklist: checklist({
        blockers: [item('opening_pending')],
        warnings: [item('treasuries_not_reconciled'), item('sas_cuit_missing')],
      }),
      blockersCount: 1,
      blockerWords: 'decir cuánta plata había al arrancar',
    })
    expect(h.lead).toBe('A septiembre le falta 1 cosa para poder cerrarse.')
    expect(h.rest).toBe('Además hay 2 avisos, que no frenan.')
  })

  it('4 · terminó, se puede cerrar con avisos (el ejemplo hoy)', () => {
    const h = closeHeadline({
      ...base,
      month: '2026-09',
      period: sep,
      checklist: checklist({ canClose: true, warnings: [item('treasuries_not_reconciled')] }),
    })
    expect(h.lead).toBe('Septiembre se puede cerrar.')
    expect(h.rest).toBe('Queda 1 aviso para mirar: no frena el cierre.')
  })

  it('5 · terminó, sin avisos', () => {
    const h = closeHeadline({
      ...base,
      month: '2026-09',
      period: sep,
      checklist: checklist({ canClose: true }),
    })
    expect(`${h.lead} ${h.rest}`).toBe('Septiembre está listo para cerrar. No hay avisos.')
  })

  it('6 · hay otro mes antes: lleva a ese mes', () => {
    const h = closeHeadline({
      ...base,
      today: '2026-11-05',
      month: '2026-10',
      period: oct,
      checklist: checklist({ blockers: [item('close_out_of_order')] }),
      earlierOpen: '2026-09',
    })
    expect(h.lead).toBe('Antes de octubre hay que cerrar septiembre.')
    expect(h.rest).toBe('Los meses se cierran en orden.')
    expect(h.link).toEqual({ label: 'Ir a septiembre', href: `${PATH}?mes=2026-09` })
  })

  it('7 · cerrado', () => {
    const h = closeHeadline({
      ...base,
      month: '2026-09',
      period: {
        endsOn: '2026-09-30',
        status: 'closed',
        closedAt: '2026-10-05T15:00:00Z',
        closedByName: 'Franco',
      },
      checklist: null,
    })
    expect(`${h.lead} ${h.rest}`).toBe(
      'Septiembre está cerrado. Lo cerró Franco el 05/10/2026. Ya le podés mandar los libros a tu contadora.',
    )
  })

  it('8 · la contadora: abierto (con sus avisos) y cerrado', () => {
    const open = closeHeadline({
      ...base,
      canWrite: false,
      month: '2026-09',
      period: sep,
      checklist: checklist({ canClose: true, warnings: [item('treasuries_not_reconciled')] }),
    })
    expect(`${open.lead} ${open.rest}`).toBe(
      'Septiembre sigue abierto: lo cierran los dueños. Tiene 1 aviso.',
    )
    const closed = closeHeadline({
      ...base,
      canWrite: false,
      month: '2026-09',
      period: {
        endsOn: '2026-09-30',
        status: 'closed',
        closedAt: '2026-10-05T15:00:00Z',
        closedByName: 'Franco',
      },
      checklist: null,
    })
    expect(`${closed.lead} ${closed.rest}`).toBe(
      'Septiembre está cerrado. Lo cerró Franco el 05/10/2026.',
    )
  })

  it('el número de avisos es el de la base, en singular y en plural', () => {
    const three = closeHeadline({
      ...base,
      month: '2026-09',
      period: sep,
      checklist: checklist({
        canClose: true,
        warnings: [item('a'), item('b'), item('c')],
      }),
    })
    expect(three.rest).toBe('Quedan 3 avisos para mirar: no frenan el cierre.')
  })
})

describe('qué paso toca', () => {
  const current = (s: readonly string[]) => s.filter((x) => x === 'current').length

  it('uno solo a la vez, en las cuatro situaciones', () => {
    const cases = [
      stepStates({ closed: true, canClose: false, hasWork: false }),
      stepStates({ closed: false, canClose: true, hasWork: false }),
      stepStates({ closed: false, canClose: true, hasWork: true }),
      stepStates({ closed: false, canClose: false, hasWork: true }),
    ]
    expect(cases).toEqual([
      ['done', 'done', 'current'],
      ['done', 'current', 'todo'],
      ['current', 'todo', 'todo'],
      ['current', 'todo', 'todo'],
    ])
    for (const c of cases) expect(current(c)).toBe(1)
  })

  it('abierto, no se puede cerrar y sin nada para hacer: el paso 1 queda hecho', () => {
    expect(stepStates({ closed: false, canClose: false, hasWork: false })).toEqual([
      'done',
      'todo',
      'todo',
    ])
  })

  it('por qué todavía no se puede cerrar', () => {
    const base = { month: '2026-10', earlierOpen: null, openingPending: false, blockersCount: 0 }
    expect(closeWaitText({ ...base, period: { endsOn: '2026-10-31' }, today: TODAY })).toBe(
      'Se puede desde el 01/11/2026.',
    )
    expect(
      closeWaitText({
        ...base,
        period: { endsOn: '2026-10-31' },
        today: '2026-11-05',
        earlierOpen: '2026-09',
      }),
    ).toBe('Primero hay que cerrar septiembre.')
    expect(
      closeWaitText({
        ...base,
        month: '2026-09',
        period: { endsOn: '2026-09-30' },
        today: TODAY,
        openingPending: true,
        blockersCount: 1,
      }),
    ).toBe('Antes falta decir cuánta plata había al arrancar (paso 1).')
  })
})

describe('la revisión: un «está bien» nunca sale de que la base calle', () => {
  it('sin ningún cierre y sin aviso de la base, «Cierres del día» NO da «Sin avisos»', () => {
    // HUB: arranca el 12/10, hoy es 13/10 y nunca se cargó un cierre. La base no avisa nada.
    const r = review({
      calendar: calendar({
        monthYm: '2026-10',
        from: '2026-10-12',
        serviceDay: TODAY,
        loaded: [],
      }),
    })
    const closes = r.rows[0]
    expect(closes?.id).toBe('closes')
    expect(closes?.tone).toBe('muted')
    expect(closes?.pill).toBe('Sin cierres')
    expect(closes?.okText).toBeNull()
    expect(closes?.items[0]?.title).toBe('Todavía no hay ningún cierre del día en octubre')
    expect(closes?.items[0]?.detail).toBe('Sin cierres, el mes queda sin ventas en los libros.')
    expect(closes?.items[0]?.actions).toEqual([
      {
        kind: 'href',
        label: 'Cargar el del lunes 12/10',
        href: `${BASE}/ventas/cierre?fecha=2026-10-12`,
      },
    ])
    expect(closes?.showStrip).toBe(true)
    expect(r.hasWork).toBe(true)
  })

  it('faltan algunos: cuántos, cuál es el primero y el botón para cargarlo', () => {
    const loaded = eachIsoDay('2026-10-01', '2026-10-12').filter((d) => d !== '2026-10-07')
    const r = review({ calendar: calendar({ monthYm: '2026-10', serviceDay: TODAY, loaded }) })
    const closes = r.rows[0]
    expect(closes?.tone).toBe('warn')
    expect(closes?.pill).toBe('1 aviso')
    expect(closes?.items[0]?.title).toBe('Falta 1 cierre del día')
    expect(closes?.items[0]?.detail).toBe(
      'Cargaste 11 de 12. El primero que falta es el miércoles 07/10.',
    )
    expect(closes?.items[0]?.actions[0]).toEqual({
      kind: 'href',
      label: 'Cargar el del miércoles 07/10',
      href: `${BASE}/ventas/cierre?fecha=2026-10-07`,
    })
  })

  it('al día: dice literal cuántos días tienen su cierre (y no dibuja el almanaque)', () => {
    const loaded = eachIsoDay('2026-10-01', '2026-10-12')
    const inCourse = review({
      calendar: calendar({ monthYm: '2026-10', serviceDay: TODAY, loaded }),
    })
    expect(inCourse.rows[0]?.tone).toBe('ok')
    expect(inCourse.rows[0]?.pill).toBe('Sin avisos')
    expect(inCourse.rows[0]?.okText).toBe('Vas al día: están los 12 días que van de octubre.')
    expect(inCourse.rows[0]?.showStrip).toBe(false)

    const finished = review({
      month: '2026-09',
      finished: true,
      calendar: calendar({
        monthYm: '2026-09',
        serviceDay: TODAY,
        loaded: eachIsoDay('2026-09-01', '2026-09-30'),
      }),
    })
    expect(finished.rows[0]?.okText).toBe('Los 30 días de septiembre tienen su cierre.')
  })

  it('sin almanaque usa solo el aviso de la base; sin aviso, tampoco afirma que está bien', () => {
    const withWarning = review({
      calendar: null,
      checklist: checklist({
        warnings: [
          item('missing_daily_closes', { detail: { dates: ['2026-10-04', '2026-10-11'] } }),
        ],
      }),
    })
    expect(withWarning.rows[0]?.items[0]?.detail).toBe('Faltan los del 04/10 y 11/10.')
    expect(withWarning.rows[0]?.showStrip).toBe(false)

    const silent = review({ calendar: null })
    expect(silent.rows[0]?.tone).toBe('muted')
    expect(silent.rows[0]?.pill).toBe('Sin dato')
    expect(silent.rows[0]?.okText).toBeNull()
  })

  it('sin aviso de cajas, el texto es el literal y nunca dice «contadas»', () => {
    const r = review()
    const money = r.rows.find((row) => row.id === 'money')
    expect(money?.tone).toBe('ok')
    expect(money?.okText).toBe('Ninguna caja con movimientos quedó sin contar ni en negativo.')
    expect(money?.okText).not.toMatch(/contadas/i)
    const purchases = r.rows.find((row) => row.id === 'purchases')
    expect(purchases?.okText).toBe(
      'No hay gastos fijos de octubre sin cargar ni tiques sin comercio.',
    )
  })

  it('`openingStatus: pending` cuenta como «Falta» aunque el checklist no lo traiga', () => {
    const r = review({ settings: { openingStatus: 'pending', cuit: null } })
    const papers = r.rows.find((row) => row.id === 'papers')
    expect(papers?.tone).toBe('late')
    expect(papers?.pill).toBe('Falta')
    expect(papers?.items.map((i) => [i.title, i.actions[0]?.label])).toEqual([
      ['Falta decir cuánta plata había al arrancar', 'Cargar lo que había'],
      ['Falta la CUIT del bar', 'Cargarla'],
    ])
    expect(papers?.items[0]?.actions[0]).toMatchObject({ href: `${BASE}/configurar` })
    expect(papers?.items[1]?.actions[0]).toMatchObject({ href: `${BASE}/ajustes?tab=sas` })
  })

  it('con todo cargado, los papeles dicen qué se revisó', () => {
    const papers = review().rows.find((row) => row.id === 'papers')
    expect(papers?.okText).toBe('La CUIT y lo que había al arrancar están cargados.')
  })

  it('sin los datos del bar no se afirma que estén cargados', () => {
    const papers = review({ settings: null }).rows.find((row) => row.id === 'papers')
    expect(papers?.tone).toBe('muted')
    expect(papers?.okText).toBeNull()
  })

  it('un aviso desconocido cae en «Otros avisos» y nunca muestra la clave', () => {
    const r = review({
      checklist: checklist({ warnings: [item('alguna_clave_nueva', { label: '' })] }),
    })
    const other = r.rows.find((row) => row.id === 'other')
    expect(other?.title).toBe('Otros avisos')
    expect(other?.items[0]?.title).toBe('Hay algo para revisar antes de cerrar.')
    expect(JSON.stringify(other?.items.map((i) => [i.title, i.detail]))).not.toContain(
      'alguna_clave_nueva',
    )
  })

  it('los avisos conocidos van a su renglón, con su acción', () => {
    const r = review({
      month: '2026-09',
      finished: true,
      calendar: calendar({
        monthYm: '2026-09',
        serviceDay: TODAY,
        loaded: eachIsoDay('2026-09-01', '2026-09-30'),
      }),
      checklist: checklist({
        canClose: true,
        warnings: [
          item('recurring_not_loaded', {
            count: 5,
            detail: {
              items: [
                {
                  recurring_id: '00000000-0000-4000-8000-000000000001',
                  name: 'Alquiler',
                  due_date: '2026-09-10',
                  amount_cents: 850_000_00,
                },
                {
                  recurring_id: '00000000-0000-4000-8000-000000000002',
                  name: 'Internet',
                  due_date: '2026-09-15',
                  amount_cents: null,
                },
                { recurring_id: 'no-es-un-uuid', name: 'Seguro', due_date: '2026-09-20' },
                { name: 'Alarma' },
                { name: 'Contador' },
              ],
            },
          }),
          item('tickets_without_vendor', { count: 2, amountCents: 18_400_00 }),
          item('treasuries_not_reconciled', {
            detail: {
              treasuries: [
                { treasury_id: '00000000-0000-4000-8000-0000000000aa', name: 'Caja' },
                { treasury_id: '00000000-0000-4000-8000-0000000000bb', name: 'Banco Nación' },
              ],
            },
          }),
          item('receivables_overdue', { count: 3, amountCents: 240_000_00 }),
        ],
      }),
    })
    const purchases = r.rows.find((row) => row.id === 'purchases')
    expect(purchases?.pill).toBe('2 avisos')
    const recurring = purchases?.items[0]
    expect(recurring?.title).toBe('Hay gastos fijos de septiembre sin cargar')
    // El mes ya terminó: todos «vencieron» (no «vence», que suena a que todavía hay tiempo).
    expect(recurring?.recurring?.map((row) => plain(row.text))).toEqual([
      'Alquiler · venció el 10/09 · $ 850.000',
      'Internet · venció el 15/09 · sin monto',
      'Seguro · venció el 20/09 · sin monto',
    ])
    // En el celular el nombre y «cuándo · cuánto» van en dos renglones: llegan separados.
    expect(recurring?.recurring?.map((row) => [row.name, plain(row.meta)])).toEqual([
      ['Alquiler', 'venció el 10/09 · $ 850.000'],
      ['Internet', 'venció el 15/09 · sin monto'],
      ['Seguro', 'venció el 20/09 · sin monto'],
    ])
    // Sin un id válido no hay «Pagar» (no se abre una hoja con un parámetro roto).
    expect(recurring?.recurring?.map((row) => row.action?.kind ?? null)).toEqual([
      'sheet',
      'sheet',
      null,
    ])
    expect(recurring?.recurring?.[0]?.action).toEqual({
      kind: 'sheet',
      label: 'Pagar',
      sheet: 'gasto',
      params: { 'gasto-fijo': '00000000-0000-4000-8000-000000000001' },
    })
    expect(recurring?.more).toBe('y 2 más')
    expect(purchases?.items[1]?.title).toBe('2 tiques no dicen de qué comercio son')
    expect(plain(purchases?.items[1]?.detail)).toBe(
      'Por $ 18.400. Así no entran al Libro IVA; igual quedan registrados.',
    )

    const money = r.rows.find((row) => row.id === 'money')
    expect(money?.items[0]?.title).toBe('Hay cajas sin contar en septiembre')
    expect(money?.items[0]?.actions).toEqual([
      {
        kind: 'sheet',
        label: 'Contar Caja',
        sheet: 'ajustar',
        params: { caja: '00000000-0000-4000-8000-0000000000aa' },
      },
      {
        kind: 'sheet',
        label: 'Contar Banco Nación',
        sheet: 'ajustar',
        params: { caja: '00000000-0000-4000-8000-0000000000bb' },
      },
    ])
    expect(money?.items[1]?.title).toBe('Hay plata en camino atrasada')
    expect(plain(money?.items[1]?.detail)).toBe(
      '3 cobros por $ 240.000 ya tendrían que haber entrado.',
    )

    // EL botón primario de la pantalla: la primera acción, en el orden de los renglones.
    expect(firstReviewAction(r)).toEqual(recurring?.recurring?.[0]?.action)
  })

  it('cajas sin contar en un mes que ya terminó: dice con qué fecha hay que contarlas', () => {
    // La base da por contada una caja solo si el conteo tiene fecha DENTRO del mes, y la hoja
    // abre con la de hoy: sin decirlo, se cuenta y el aviso sigue ahí.
    const warning = item('treasuries_not_reconciled', {
      detail: {
        treasuries: [
          { treasury_id: '00000000-0000-4000-8000-0000000000aa', name: 'Caja' },
          { treasury_id: '00000000-0000-4000-8000-0000000000bb', name: 'Banco Nación' },
        ],
      },
    })
    const moneyOf = (over: Partial<ReviewInput>) => ({
      row: review({
        checklist: checklist({ canClose: true, warnings: [warning] }),
        ...over,
      }).rows.find((row) => row.id === 'money'),
    })

    // Una sola oración (antes eran ocho renglones en el celular), con la fecha de ejemplo.
    const finished = moneyOf({ month: '2026-09', finished: true, today: TODAY })
    expect(finished.row?.pill).toBe('1 aviso')
    expect(finished.row?.items[0]?.title).toBe('Hay cajas sin contar en septiembre')
    expect(plain(finished.row?.items[0]?.detail)).toBe(
      'Contalas con fecha de septiembre (por ejemplo, 30/09) para que valga para este mes.',
    )
    expect(finished.row?.items[0]?.actions.map((a) => a.label)).toEqual([
      'Contar Caja',
      'Contar Banco Nación',
    ])
    // Con la fecha de hoy «Contar» no apaga el aviso: nunca es EL botón relleno de la pantalla.
    expect(finished.row?.items[0]?.quiet).toBe(true)
    expect(firstReviewAction({ rows: finished.row ? [finished.row] : [] })).toBeNull()

    // A la contadora no se le explica cómo cargar.
    const reader = moneyOf({ month: '2026-09', finished: true, canWrite: false })
    expect(reader.row?.items[0]?.detail).toBe('Sin contar: Caja, Banco Nación.')
    expect(reader.row?.items[0]?.actions).toEqual([])
  })

  it('cajas sin contar a mitad de mes: una línea gris con su link, no un aviso', () => {
    // El 13/10 «Hay cajas sin contar en octubre» todavía no es cierto: alcanza con contarlas una
    // vez antes de cerrar. No cuenta como aviso, no lleva un botón por caja ni es el primario.
    const warning = item('treasuries_not_reconciled', {
      detail: {
        treasuries: [
          { treasury_id: '00000000-0000-4000-8000-0000000000aa', name: 'Caja' },
          { treasury_id: '00000000-0000-4000-8000-0000000000bb', name: 'Banco Nación' },
        ],
      },
    })
    const r = review({
      month: '2026-10',
      finished: false,
      today: TODAY,
      checklist: checklist({ warnings: [warning] }),
    })
    const money = r.rows.find((row) => row.id === 'money')
    expect(money?.tone).toBe('muted')
    expect(money?.pill).toBe('Para ir viendo')
    expect(money?.items).toHaveLength(1)
    expect(money?.items[0]).toMatchObject({
      soft: true,
      tone: 'muted',
      title: 'Las cajas de octubre se cuentan antes de cerrar el mes.',
      detail: 'Todavía sin contar: Caja, Banco Nación.',
      actions: [{ kind: 'href', label: 'Ver cajas', href: `${BASE}/cajas` }],
    })
    expect(JSON.stringify(money?.items)).not.toContain('Hay cajas sin contar')
    // Sigue habiendo algo para mirar en el paso 1, pero su link no es el botón relleno.
    expect(r.hasWork).toBe(true)
    expect(firstReviewAction({ rows: money ? [money] : [] })).toBeNull()

    // Con un aviso de verdad al lado, el renglón cuenta ESE aviso (y solo ese).
    const both = review({
      month: '2026-10',
      finished: false,
      today: TODAY,
      checklist: checklist({
        warnings: [item('receivables_overdue', { count: 3, amountCents: 240_000_00 }), warning],
      }),
    }).rows.find((row) => row.id === 'money')
    expect(both?.tone).toBe('warn')
    expect(both?.pill).toBe('1 aviso')

    // La contadora ve la misma línea, sin link.
    const reader = review({
      month: '2026-10',
      finished: false,
      today: TODAY,
      canWrite: false,
      checklist: checklist({ warnings: [warning] }),
    }).rows.find((row) => row.id === 'money')
    expect(reader?.items[0]?.soft).toBe(true)
    expect(reader?.items[0]?.actions).toEqual([])
  })

  it('gastos fijos a mitad de mes: separa lo que ya venció de lo que vence más adelante', () => {
    const fixed = (rows: Array<{ name: string; due_date: string; amount_cents: number }>) =>
      review({
        month: '2026-10',
        finished: false,
        today: TODAY,
        checklist: checklist({
          warnings: [
            item('recurring_not_loaded', {
              count: rows.length,
              detail: {
                items: rows.map((row, i) => ({
                  recurring_id: `00000000-0000-4000-8000-00000000000${i + 1}`,
                  ...row,
                })),
              },
            }),
          ],
        }),
      }).rows.find((row) => row.id === 'purchases')

    // Hoy es 13/10: el del 10 venció, el del 13 vence hoy y el del 15 todavía no.
    const mixed = fixed([
      { name: 'Alquiler del local', due_date: '2026-10-10', amount_cents: 850_000_00 },
      { name: 'Seguro', due_date: '2026-10-13', amount_cents: 60_000_00 },
      { name: 'Internet y teléfono', due_date: '2026-10-15', amount_cents: 35_000_00 },
    ])
    expect(mixed?.tone).toBe('warn')
    expect(mixed?.pill).toBe('1 aviso')
    expect(mixed?.items[0]?.title).toBe('Hay gastos fijos de octubre sin cargar')
    expect(mixed?.items[0]?.recurring?.map((row) => plain(row.meta))).toEqual([
      'venció el 10/10 · $ 850.000',
      'vence hoy · $ 60.000',
      'vence el 15/10 · $ 35.000',
    ])

    // Si ninguno venció todavía, no es un aviso: es algo «para ir viendo» (con su «Pagar» igual).
    const upcoming = fixed([
      { name: 'Internet y teléfono', due_date: '2026-10-15', amount_cents: 35_000_00 },
      { name: 'Expensas', due_date: '2026-10-20', amount_cents: 120_000_00 },
    ])
    expect(upcoming?.tone).toBe('muted')
    expect(upcoming?.pill).toBe('Para ir viendo')
    expect(upcoming?.items[0]?.title).toBe('Gastos fijos de octubre que todavía no vencieron')
    expect(upcoming?.items[0]?.recurring?.map((row) => plain(row.text))).toEqual([
      'Internet y teléfono · vence el 15/10 · $ 35.000',
      'Expensas · vence el 20/10 · $ 120.000',
    ])
    expect(upcoming?.items[0]?.recurring?.[0]?.action).toMatchObject({ label: 'Pagar' })
  })

  it('sueldos: un renglón fijo que no cuenta como aviso (el sistema no puede saberlo)', () => {
    const r = review()
    const purchases = r.rows.find((row) => row.id === 'purchases')
    expect(purchases?.tone).toBe('ok')
    expect(purchases?.payroll?.action).toEqual({
      kind: 'href',
      label: 'Cargar los sueldos',
      href: `${BASE}/libros/asiento-manual?tipo=sueldos`,
    })
  })

  it('con `canWrite: false`, ninguna acción (ni sueldos): «Lo cargan los dueños.»', () => {
    const r = review({
      canWrite: false,
      settings: { openingStatus: 'pending', cuit: null },
      calendar: calendar({
        monthYm: '2026-10',
        from: '2026-10-12',
        serviceDay: TODAY,
        loaded: [],
      }),
      checklist: checklist({
        warnings: [
          item('recurring_not_loaded', {
            detail: {
              items: [{ recurring_id: '00000000-0000-4000-8000-000000000001', name: 'Alquiler' }],
            },
          }),
          item('treasuries_not_reconciled', {
            detail: {
              treasuries: [{ treasury_id: '00000000-0000-4000-8000-0000000000aa', name: 'Caja' }],
            },
          }),
        ],
      }),
    })
    for (const row of r.rows) {
      expect(row.payroll).toBeNull()
      for (const entry of row.items) {
        expect(entry.actions).toEqual([])
        expect(entry.help ?? null).toBeNull()
        for (const recurring of entry.recurring ?? []) expect(recurring.action).toBeNull()
        expect(entry.note).toBe('Lo cargan los dueños.')
      }
    }
    expect(firstReviewAction(r)).toBeNull()
  })

  it('los datos para la contadora van aparte, con el texto de siempre', () => {
    const r = review({
      checklist: checklist({
        info: [item('opening_unassigned', { amountCents: 330_000_000 })],
      }),
    })
    expect(r.info.map(plain)).toEqual([
      'Hay $ 3.300.000,00 de patrimonio inicial sin asignar: lo revisa la contadora.',
    ])
  })

  it('cuenta lo que frena además de la fecha y del orden', () => {
    const r = review({
      settings: { openingStatus: 'pending', cuit: '30-12345678-9' },
      checklist: checklist({
        blockers: [item('month_not_finished'), item('opening_pending')],
      }),
    })
    expect(r.blockersCount).toBe(1)
    expect(r.blockerWords).toBe('decir cuánta plata había al arrancar')
  })
})

describe('el almanaque del paso 1', () => {
  it('cada día que falta (y hoy) lleva a su cierre; lo demás no', () => {
    const days = closeStripDays(
      calendar({
        monthYm: '2026-10',
        from: '2026-10-12',
        serviceDay: TODAY,
        loaded: [],
      }),
      BASE,
    )
    const by = new Map(days.map((d) => [d.date, d]))
    // El bar arrancó el lunes 12: las semanas enteras de antes no se dibujan.
    expect(days[0]?.date).toBe('2026-10-12')
    expect(by.has('2026-10-11')).toBe(false)
    expect(by.get('2026-10-12')).toMatchObject({
      state: 'missing',
      href: `${BASE}/ventas/cierre?fecha=2026-10-12`,
      weekday: 'lu',
    })
    expect(by.get('2026-10-13')).toMatchObject({ state: 'today', isToday: true })
    expect(by.get('2026-10-14')?.href).toBeUndefined()
  })

  it('si arranca a mitad de semana, esa semana va entera (apagada antes del arranque)', () => {
    const days = closeStripDays(
      calendar({ monthYm: '2026-10', from: '2026-10-15', serviceDay: TODAY, loaded: [] }),
      BASE,
    )
    expect(days[0]?.date).toBe('2026-10-12')
    expect(days.find((d) => d.date === '2026-10-14')?.state).toBe('before')
    expect(days.find((d) => d.date === '2026-10-15')?.state).not.toBe('before')
  })

  it('un mes entero de uso arranca el día 1', () => {
    const days = closeStripDays(
      calendar({ monthYm: '2026-10', serviceDay: TODAY, loaded: [] }),
      BASE,
    )
    expect(days[0]?.date).toBe('2026-10-01')
    expect(days).toHaveLength(31)
  })

  it('para la contadora no hay links de carga', () => {
    const days = closeStripDays(
      calendar({ monthYm: '2026-10', serviceDay: TODAY, loaded: [] }),
      null,
    )
    expect(days.every((d) => d.href === undefined)).toBe(true)
  })
})

describe('el IVA que toma el cierre: las mismas ramas, otras palabras', () => {
  const base = {
    applies: true,
    mode: 'on_close' as const,
    willGenerate: true,
    replacesDocumentId: null,
    toPayCents: 0,
    inFavorCents: 0,
    isZero: false,
    settlementDocumentId: null,
  }

  it('se anota, a pagar', () => {
    const plan = ivaClosePlan({ ...base, toPayCents: 411_706_204 }, '2026-09')
    expect(plan).toMatchObject({ settles: true, replaces: false, voidsOnly: false })
    // La oración de la pantalla va en pesos, como el papel del mes y «¿Cómo se calcula?»…
    expect(`${plan.text?.lead}${plan.text?.amount}${plan.text?.tail}`.replace(/ /g, ' ')).toBe(
      'Al cerrar queda anotado el IVA de septiembre: $ 4.117.062 a pagarle a ARCA.',
    )
    // …y el importe exacto, con centavos, queda en la frase del diálogo de «Cerrar».
    expect(plan.summary.replace(/ /g, ' ')).toBe(
      'Queda anotado el IVA de septiembre: a pagar $ 4.117.062,04.',
    )
  })

  it('se anota, a favor: dice para qué mes queda', () => {
    const plan = ivaClosePlan({ ...base, inFavorCents: 12_000_000 }, '2026-09')
    expect(`${plan.text?.lead}${plan.text?.amount}${plan.text?.tail}`.replace(/ /g, ' ')).toBe(
      'Al cerrar queda anotado el IVA de septiembre: quedan $ 120.000 a favor para octubre.',
    )
    expect(plan.summary.replace(/ /g, ' ')).toBe(
      'Queda anotado el IVA de septiembre: quedan $ 120.000,00 a favor.',
    )
  })

  it('se anota y da cero', () => {
    expect(ivaClosePlan(base, '2026-09').text?.lead).toBe(
      'Al cerrar queda anotado el IVA de septiembre: no queda nada a pagar.',
    )
  })

  it('reemplaza a uno viejo: lo dice y el cierre lo tiene que tomar', () => {
    const plan = ivaClosePlan(
      { ...base, toPayCents: 100_00, replacesDocumentId: 'doc-viejo' },
      '2026-09',
    )
    expect(plan.replaces).toBe(true)
    expect(plan.text?.tail).toBe(' a pagarle a ARCA. Reemplaza al que había quedado viejo.')
    expect(plan.summary).toMatch(/Reemplaza al que había quedado viejo\.$/)
  })

  it('solo anula (había uno y ahora el mes da cero)', () => {
    const plan = ivaClosePlan(
      { ...base, willGenerate: false, replacesDocumentId: 'doc-viejo', isZero: true },
      '2026-09',
    )
    expect(plan).toMatchObject({ settles: true, voidsOnly: true })
    expect(plan.text?.lead).toBe(
      'Al cerrar se anula el IVA que había quedado anotado: ahora septiembre da cero.',
    )
  })

  it('todo en cero, a mano, ya anotado y sin IVA', () => {
    expect(ivaClosePlan({ ...base, willGenerate: false, isZero: true }, '2026-09')).toMatchObject({
      settles: false,
      text: { lead: 'Septiembre no tiene IVA para anotar.' },
    })
    expect(
      ivaClosePlan({ ...base, mode: 'manual', willGenerate: false }, '2026-09').text?.lead,
    ).toBe('El IVA de este mes se anota a mano, desde El IVA del mes.')
    expect(
      ivaClosePlan({ ...base, willGenerate: false, settlementDocumentId: 'doc' }, '2026-09').text
        ?.lead,
    ).toBe('El IVA de septiembre ya está anotado.')
    expect(ivaClosePlan({ ...base, applies: false }, '2026-09')).toEqual({
      settles: false,
      replaces: false,
      voidsOnly: false,
      text: null,
      summary: '',
    })
    expect(ivaClosePlan(null, '2026-09').text).toBeNull()
  })
})
