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
import type { CashTotals, ProjectionDay } from '@/lib/accounting/projection'
import type { DayEvents } from '@/lib/accounting/queries/projection'
import { capitalizeFirst, isRealIsoDay, monthName, weekdayName } from '@/lib/dates'
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

/** De $ 100.000 a $ 999.999: tres cifras y «mil» no entran en un casillero de 42 px. */
const SHORT_AS_MILLIONS_FROM_CENTS = 10_000_000
const ONE_MILLION_CENTS = 100_000_000

/**
 * El importe de un casillero en el celular, sin el «$»: «1,1 M», «85 mil». Entre
 * $ 100.000 y $ 1 M va en millones con un decimal («0,8 M»): «806 mil» se cortaba
 * contra el borde, y así todo el mes se lee en la misma unidad. El importe entero
 * está en la noche elegida y en el `label` del casillero.
 */
export function cellShort(cents: number): string {
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
      marker: scale(d.targetCents),
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
