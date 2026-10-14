/**
 * El almanaque de Ventas: qué dice cada casillero del mes, qué noche se
 * muestra al lado y las oraciones que acompañan. Puro (sin lecturas): sale de
 * lo que ya arma la pantalla (`monthDays`, `buildProjection`, el calendario de
 * cierres y los eventos) y lo prueban `administracion-ventas-vista.test.ts` y
 * `administracion-ventas-noche.test.ts`.
 *
 * Un solo «vendido» para todo el mes: el número de cada casillero es la venta
 * neta (sin las comisiones estimadas), así la suma de los casilleros ES el
 * número de la hoja verde y el del Resumen. Un día sin cargar nunca es un cero.
 */

import { hrefWith } from '@/components/administracion/cajas-ventas/periods'
import { compactCents } from '@/components/administracion/charts/scale'
import type { PostingCatalog } from '@/lib/accounting/context'
import type { MonthDay } from '@/lib/accounting/home'
import {
  type CashTotals,
  type Compliance,
  complianceOf,
  type Projection,
  type ProjectionDay,
} from '@/lib/accounting/projection'
import type { DayEvents } from '@/lib/accounting/queries/projection'
import {
  capitalizeFirst,
  formatWeekdayDayMonth,
  isRealIsoDay,
  monthName,
  weekdayName,
} from '@/lib/dates'
import { formatCents, formatCentsShort, NBSP } from '@/lib/money'
import type { MonthGridCell } from '../_components/month-grid'

/** Desde acá el importe entero no entra en un casillero de la compu: va abreviado. */
const CELL_FULL_LIMIT_CENTS = 1_000_000_000
/** Lo mínimo que se llena un casillero con ventas, para que el relleno se vea. */
const MIN_FILL = 0.06

/** El importe de un casillero en la compu: «$ 1.138.029»; desde $ 10 M, «$ 12,4 M». */
export function cellAmount(cents: number): string {
  if (!Number.isFinite(cents)) return ''
  return Math.abs(cents) >= CELL_FULL_LIMIT_CENTS ? compactCents(cents) : formatCentsShort(cents)
}

/** De $ 100.000 a $ 999.999 el almanaque chico del asistente habla en millones. */
const SHORT_AS_MILLIONS_FROM_CENTS = 10_000_000
const ONE_MILLION_CENTS = 100_000_000

/**
 * El importe de un casillero en el celular, sin el «$»: «1,1 M», «806 mil»,
 * «85 mil». Como lo dice el dueño: una noche de $ 805.794 son «806 mil», no
 * «0,8 M» (que además escondía 90 mil pesos entre dos noches). El número va en
 * grande y la unidad chica y gris al lado (`MonthGrid`). El importe entero está
 * en la noche elegida y en el `label` del casillero.
 */
export function cellShort(cents: number): string {
  if (!Number.isFinite(cents)) return ''
  return compactCents(cents).replace(`$${NBSP}`, '')
}

/**
 * Lo mismo, siempre en millones desde $ 100.000 («0,8 M»): es para el almanaque
 * chico de «Armar el objetivo», donde el casillero mide 30 px y «806 mil» no
 * entra. Ahí se compara un día contra otro, no se lee una noche.
 */
export function cellMillions(cents: number): string {
  if (!Number.isFinite(cents)) return ''
  const abs = Math.abs(cents)
  if (abs >= SHORT_AS_MILLIONS_FROM_CENTS && abs < ONE_MILLION_CENTS) {
    const tenths = Math.round(abs / SHORT_AS_MILLIONS_FROM_CENTS)
    return `${cents < 0 ? '−' : ''}${tenths >= 10 ? '1' : `0,${tenths}`}${NBSP}M`
  }
  return compactCents(cents).replace(`$${NBSP}`, '')
}

/** «Miércoles 7 de octubre». Vacío si no es un día real. */
export function longDayTitle(day: string): string {
  if (!isRealIsoDay(day)) return ''
  const month = monthName(Number(day.slice(5, 7)))
  return capitalizeFirst(`${weekdayName(day)} ${Number(day.slice(8, 10))} de ${month}`)
}

/** «a», «a y b», «a, b y c». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
}

/**
 * Qué día se muestra al lado del almanaque: el pedido (`?dia=`) si es del mes
 * y se puede elegir (cargado, hoy o por venir); si no, la última noche cargada;
 * un mes que todavía no empezó abre en su día 1; sin ninguna noche, `null`.
 */
export function defaultDay(input: {
  requested: string | null
  days: readonly Pick<MonthDay, 'date' | 'state'>[]
}): string | null {
  const { requested, days } = input
  const pickable = (d: Pick<MonthDay, 'state'>) =>
    d.state === 'loaded' || d.state === 'today' || d.state === 'future'
  if (requested) {
    const found = days.find((d) => d.date === requested)
    if (found && pickable(found)) return found.date
  }
  const lastLoaded = days.filter((d) => d.state === 'loaded').at(-1)
  if (lastLoaded) return lastLoaded.date
  const first = days[0]
  if (first && days.every((d) => d.state === 'future')) return first.date
  return null
}

/**
 * La oración de la noche elegida: el puente entre lo que se cargó esa noche y
 * el número del casillero. Sin comisión estimada no hay nada que explicar.
 */
export function nightSentence(input: { loadedCents: number; netCents: number }): string | null {
  const commission = input.loadedCents - input.netCents
  if (!Number.isFinite(commission) || commission <= 0) return null
  return `Sacando lo que se quedan las tarjetas y las apps (unos ${formatCentsShort(commission)}, estimado), cuenta ${formatCentsShort(input.netCents)} para el mes: es el número del almanaque.`
}

/**
 * El título de «Ventas contra caja», que afirma: «En 8 noches anotadas, faltan
 * $ 12.400». A quien solo mira (`reader`) no se le dice «anotaste»: no carga.
 */
export function cashTitle(
  cash: Pick<CashTotals, 'comparedDays' | 'diffCents'>,
  opts: { reader?: boolean } = {},
): string {
  if (cash.comparedDays <= 0) {
    return opts.reader
      ? 'Todavía no se anotó lo que entró ninguna noche'
      : 'Todavía no anotaste lo que entró ninguna noche'
  }
  const nights =
    cash.comparedDays === 1 ? 'En 1 noche anotada' : `En ${cash.comparedDays} noches anotadas`
  if (cash.diffCents === 0) return `${nights}, coincide`
  const abs = Math.abs(cash.diffCents)
  const amount = abs % 100 === 0 ? formatCentsShort(abs) : formatCents(abs)
  return cash.diffCents < 0 ? `${nights}, faltan ${amount}` : `${nights}, sobran ${amount}`
}

export type CommissionGaps = { names: string[]; sentence: string }

/** Cuántos nombres se dicen antes de pasar a «y N más». */
const MAX_GAP_NAMES = 4

/**
 * Los medios que pagan después (tarjetas y apps) cuyo pagador no tiene la
 * comisión cargada: mientras tanto se cuentan enteros en «Vas vendiendo».
 * `null` si no falta ninguna.
 */
export function commissionGaps(
  catalog: Pick<PostingCatalog, 'methods' | 'parties'>,
): CommissionGaps | null {
  const parties = new Map(catalog.parties.map((p) => [p.id, p]))
  const names: string[] = []
  for (const method of catalog.methods) {
    if (!method.active || method.kind !== 'receivable' || !method.partyId) continue
    const party = parties.get(method.partyId)
    if (!party || party.rates.commissionBp !== null) continue
    if (!names.includes(method.name)) names.push(method.name)
  }
  if (names.length === 0) return null
  const shown =
    names.length > MAX_GAP_NAMES
      ? `${names.slice(0, MAX_GAP_NAMES - 1).join(', ')} y ${names.length - (MAX_GAP_NAMES - 1)} más`
      : joinNames(names)
  const sentence =
    names.length === 1
      ? `1 medio no tiene la comisión cargada (${shown}): por ahora se cuenta entero.`
      : `${names.length} medios no tienen la comisión cargada (${shown}): por ahora se cuentan enteros.`
  return { names, sentence }
}

/**
 * El «%» pegado a su número con un espacio duro: «vas 4 %» nunca se parte en
 * «vas 4» y, abajo, «% abajo». Solo para mostrar (los textos de
 * `projectionFigures` no se tocan).
 */
export function keepPercent(text: string): string {
  return text.replace(/(\d) %/g, `$1${NBSP}%`)
}

// ─── «A hoy» contra lo cargado ───────────────────────────────────────────────

type Pace = Extract<Compliance, { kind: 'value' }>

/**
 * Cuando «Objetivo a hoy» cuenta noches que todavía no tienen cierre (pasa
 * todas las mañanas, antes de cargar el de anoche), la pantalla daba dos
 * cuentas que parecían contradecirse: «a hoy vas 4 % abajo» y, en la carrera,
 * «vas 4 % arriba» (que corta en la última noche cargada). Las dos están bien;
 * esto junta lo que hace falta para decir por qué. `null` si no pasa.
 */
export type StaleTarget = {
  /** La última noche con cierre. */
  lastLoaded: string
  /** Las noches de después, con objetivo y sin cierre, que «a hoy» ya cuenta. */
  missing: string[]
  /** Cómo venís con lo cargado (hasta `lastLoaded`). */
  loadedPace: Pace | null
  /** Cómo da «a hoy» (la cuenta de `projectionFigures`). */
  todayPace: Pace | null
}

export function staleTarget(projection: Pick<Projection, 'days' | 'summary'>): StaleTarget | null {
  const { summary, days } = projection
  const through = summary.throughDay
  if (!summary.hasTargets || summary.monthState !== 'current' || through === null) return null
  const last = days.filter((d) => d.hasClose && d.moment !== 'future').at(-1)
  if (!last || last.day >= through) return null
  const missing = days
    .filter((d) => d.day > last.day && d.day <= through && !d.hasClose && d.targetCents !== null)
    .map((d) => d.day)
  if (missing.length === 0) return null
  return {
    lastLoaded: last.day,
    missing,
    loadedPace:
      last.targetAccumCents > 0 ? complianceOf(last.netAccumCents, last.targetAccumCents) : null,
    todayPace: summary.pace,
  }
}

/** «4 % arriba» / «4 % abajo» / «justo», con el «%» pegado a su número. */
function paceShort(pace: Pace): string {
  if (pace.side === 'on') return 'justo'
  return `${pace.gapPercent}${NBSP}% ${pace.side === 'above' ? 'arriba' : 'abajo'}`
}

/**
 * La oración de «Proyección» cuando «a hoy» cuenta noches sin cierre: «Con lo
 * cargado hasta el dom 11/10 vas 4 % arriba. Falta el cierre del lun 12/10: el
 * objetivo a hoy ya cuenta esa noche, por eso te da 4 % abajo.»
 */
export function staleSentence(stale: StaleTarget): string {
  const until = formatWeekdayDayMonth(stale.lastLoaded)
  const loaded = stale.loadedPace
    ? stale.loadedPace.side === 'on'
      ? `Con lo cargado hasta el ${until} vas justo en el objetivo.`
      : `Con lo cargado hasta el ${until} vas ${paceShort(stale.loadedPace)}.`
    : `Lo cargado llega hasta el ${until}.`
  const first = formatWeekdayDayMonth(stale.missing[0] ?? '')
  const one = stale.missing.length === 1
  const gap = one
    ? `Falta el cierre del ${first}`
    : `Faltan ${stale.missing.length} cierres, desde el ${first}`
  const counts = one
    ? 'el objetivo a hoy ya cuenta esa noche'
    : 'el objetivo a hoy ya cuenta esas noches'
  const result = stale.todayPace ? `, por eso te da ${paceShort(stale.todayPace)}` : ''
  return `${loaded} ${gap}: ${counts}${result}.`
}

/**
 * La pastilla de la noche elegida contra su objetivo: dice UNA cosa («16 %
 * abajo del objetivo»). «84 % · 16 % abajo» eran dos porcentajes pegados que
 * sumaban cien y no decían de qué.
 */
export function nightPaceText(pace: Pace): string {
  if (pace.side === 'on') return 'Justo en el objetivo'
  return `${paceShort(pace)} del objetivo`
}

/** El renglón de la hoja verde debajo de «vas 4 % abajo»: qué noche sin cierre está contando. */
export function staleNote(stale: StaleTarget): string {
  if (stale.missing.length === 1) {
    return `Cuenta el ${formatWeekdayDayMonth(stale.missing[0] ?? '')}, que todavía no tiene cierre.`
  }
  return `Cuenta ${stale.missing.length} noches que todavía no tienen cierre.`
}

/** «obj. $ 1,5 M». */
function targetCaption(targetCents: number | null): string | null {
  return targetCents !== null && targetCents > 0 ? `obj. ${compactCents(targetCents)}` : null
}

type Badge = NonNullable<MonthGridCell['badge']>

function complianceBadge(day: ProjectionDay | undefined): Badge | null {
  const c = day?.compliance
  if (!c || c.kind !== 'value') return null
  if (c.side === 'on') return { text: '100 %', tone: 'ok' }
  return c.side === 'above'
    ? { text: `${c.percent} %`, tone: 'ok', glyph: 'up' }
    : { text: `${c.percent} %`, tone: 'warn', glyph: 'down' }
}

export type AlmanacInput = {
  /** `monthDays(projection, { booksStartDate }).days`. */
  days: readonly MonthDay[]
  /** `projection.days`: el cumplimiento y la nota de cada día. */
  projection: readonly ProjectionDay[]
  /** Eventos del calendario por día; `null` si quien mira no los puede leer. */
  events: DayEvents | null
  /** `/<bar>/administracion`. */
  base: string
  /** El `?mes=` de la URL, si hay: se conserva al elegir una noche. */
  month: string | null
  canWrite: boolean
  /** La noche elegida (`defaultDay`). */
  selected: string | null
}

/**
 * Las celdas del almanaque. El relleno de cada noche y la raya de su objetivo
 * usan la misma escala: el tope es la venta o el objetivo más alto del mes, así
 * una noche que pasó su objetivo se llena por encima de la raya.
 */
export function almanacCells(input: AlmanacInput): MonthGridCell[] {
  const { days, events, base, month, canWrite, selected } = input
  const byDay = new Map(input.projection.map((d) => [d.day, d]))
  let top = 0
  for (const d of days) {
    if (d.state === 'loaded' && d.cents !== null) top = Math.max(top, d.cents)
    if (d.targetCents !== null) top = Math.max(top, d.targetCents)
  }
  const scale = (cents: number | null): number | null =>
    cents !== null && cents > 0 && top > 0 ? Math.min(1, cents / top) : null
  const pick = (date: string) => hrefWith(`${base}/ventas`, { mes: month, dia: date })

  return days.map((d): MonthGridCell => {
    const title = longDayTitle(d.date)
    const source = byDay.get(d.date)
    const names = events?.[d.date] ?? []
    const note = names.length > 0 ? names.join(' · ') : (source?.note ?? null)
    const extra = [names.length > 0 ? names.join(', ') : null, source?.note ?? null]
      .filter(Boolean)
      .map((text) => ` ${text}.`)
      .join('')
    const common = {
      date: d.date,
      today: d.isToday,
      // La raya del objetivo va solo donde hay algo para comparar: la noche cargada. En un día
      // que viene (y en hoy) el objetivo se dice con palabras; en uno que falta, no va nada.
      marker: d.state === 'loaded' ? scale(d.targetCents) : null,
      dot: names.length > 0 || Boolean(source?.note),
      note: d.state === 'before' ? null : note,
      selected: selected === d.date,
    }
    const target = targetCaption(d.targetCents)

    switch (d.state) {
      case 'loaded': {
        const cents = d.cents ?? 0
        const badge = complianceBadge(source)
        const fill = scale(cents)
        return {
          ...common,
          state: 'loaded',
          value: cellAmount(cents),
          valueShort: cellShort(cents),
          badge,
          fill: fill === null ? null : Math.max(MIN_FILL, fill),
          href: pick(d.date),
          label: `${title}: ${formatCentsShort(cents)}, sin las comisiones estimadas.${
            badge ? ` ${badge.text} del objetivo.` : ''
          }${extra}`,
        }
      }
      case 'missing':
        return {
          ...common,
          state: 'missing',
          value: 'falta',
          valueShort: 'falta',
          href: canWrite ? `${base}/ventas/cierre?fecha=${d.date}` : undefined,
          label: `${title}: falta el cierre.${canWrite ? ' Abre la carga de ese día.' : ''}${extra}`,
        }
      case 'today':
        return {
          ...common,
          state: 'today',
          value: 'hoy',
          valueShort: 'hoy',
          caption: target,
          href: pick(d.date),
          label: `${title}: hoy, todavía sin cierre.${
            d.targetCents ? ` Objetivo ${formatCentsShort(d.targetCents)}.` : ''
          }${extra}`,
        }
      case 'future':
        return {
          ...common,
          state: 'future',
          caption: target,
          href: pick(d.date),
          label: `${title}: todavía no llegó.${
            d.targetCents ? ` Objetivo ${formatCentsShort(d.targetCents)}.` : ''
          }${extra}`,
        }
      default:
        return {
          date: d.date,
          state: 'before',
          dot: false,
          marker: null,
          label: `${title}: antes de empezar a llevar las cuentas.`,
        }
    }
  })
}
