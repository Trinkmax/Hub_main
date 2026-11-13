/**
 * El historial de precios, puro: de las filas de `menu_price_changes` (las escribe la base
 * sola, con un trigger, cada vez que cambia un precio) a lo que se lee en la pantalla:
 * «12/11 23:40 · $ 12.500 → $ 13.900 · Juan».
 *
 * En «Últimos cambios», un aumento de 200 productos no puede tapar todo lo demás: los cambios
 * hechos juntos se pliegan en un renglón («Subieron 46 productos, cerca de un 10 %»).
 */

import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'
import { formatCentsShort, NBSP } from '@/lib/money'

export type PriceChangeRow = {
  id: string
  itemId: string
  /** Vacío = el precio de la carta; con sucursal = su precio propio. */
  branchId: string | null
  oldCents: number | null
  newCents: number | null
  /** Los cambios hechos juntos comparten tanda (si la base la anotó). */
  batchId: string | null
  changedBy: string | null
  /** ISO. */
  createdAt: string
}

/** Qué pasó con el precio. */
export type HistoryWhat =
  /** Cambió el precio de la carta. */
  | 'menu'
  /** Una sucursal empezó a tener precio propio (antes seguía la carta). */
  | 'own-set'
  /** Cambió el precio propio de una sucursal. */
  | 'own-changed'
  /** Una sucursal volvió al precio de la carta. */
  | 'own-cleared'

export type HistoryChange = {
  kind: 'change'
  id: string
  itemId: string
  itemName: string
  /** «12/11 23:40». */
  when: string
  /** «23:40»: para cuando el día ya está dicho arriba. */
  time: string
  /** `yyyy-MM-dd` en la hora del bar. */
  day: string
  /** «Hoy», «Ayer», «Miércoles 11/11». */
  dayLabel: string
  who: string
  /** La sucursal, si lo que cambió fue su precio propio. */
  branchName: string | null
  what: HistoryWhat
  fromCents: number | null
  toCents: number | null
}

export type HistoryBatch = {
  kind: 'batch'
  id: string
  when: string
  time: string
  day: string
  dayLabel: string
  who: string
  /** La sucursal, si toda la tanda fue de precios propios de una sola. */
  branchName: string | null
  /** Productos distintos. */
  count: number
  direction: 'up' | 'down' | 'mixed'
  /** «10 %» si casi todos se movieron parecido; si no, vacío. */
  aboutPercent: string | null
  changes: HistoryChange[]
}

export type HistoryEntry = HistoryChange | HistoryBatch

export type HistoryContext = {
  itemNames: ReadonlyMap<string, string>
  branchNames: ReadonlyMap<string, string>
  /** `reservation_managers`: usuario → cómo se llama en el bar. */
  teamNames: ReadonlyMap<string, string>
  /** Quien está mirando: sin nombre cargado, sus cambios dicen «vos». */
  selfId: string | null
  timezone: string
  now: Date
}

export const UNKNOWN_PERSON = 'alguien del equipo'
const GONE_ITEM = 'Un producto que ya no está'
const GONE_BRANCH = 'una sucursal que ya no está'

/** Cambios del mismo usuario con menos de esto entre uno y otro se hicieron juntos. */
const BATCH_GAP_MS = 2_000
/** Desde cuántos productos se pliegan en un renglón. */
const BATCH_MIN = 4
/** Para decir «cerca de un 10 %»: cuántos tienen que estar a ±3 puntos de la mediana. */
const PERCENT_TOLERANCE = 3
const PERCENT_AGREEMENT = 0.8

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function whoOf(row: PriceChangeRow, ctx: HistoryContext): string {
  if (row.changedBy === null) return UNKNOWN_PERSON
  const name = ctx.teamNames.get(row.changedBy)?.trim()
  if (name) return name
  return row.changedBy === ctx.selfId ? 'vos' : UNKNOWN_PERSON
}

function whatOf(row: PriceChangeRow): HistoryWhat {
  if (row.branchId === null) return 'menu'
  if (row.oldCents === null) return 'own-set'
  return row.newCents === null ? 'own-cleared' : 'own-changed'
}

type Clock = { today: string; yesterday: string; year: string; timezone: string }

function clockOf(ctx: HistoryContext): Clock {
  return {
    today: formatInTimeZone(ctx.now, ctx.timezone, 'yyyy-MM-dd'),
    yesterday: formatInTimeZone(
      new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000),
      ctx.timezone,
      'yyyy-MM-dd',
    ),
    year: formatInTimeZone(ctx.now, ctx.timezone, 'yyyy'),
    timezone: ctx.timezone,
  }
}

function datesOf(
  iso: string,
  clock: Clock,
): { when: string; time: string; day: string; dayLabel: string } {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return { when: '—', time: '—', day: '', dayLabel: 'Sin fecha' }
  }
  const sameYear = formatInTimeZone(date, clock.timezone, 'yyyy') === clock.year
  const day = formatInTimeZone(date, clock.timezone, 'yyyy-MM-dd')
  const time = formatInTimeZone(date, clock.timezone, 'HH:mm')
  const when = formatInTimeZone(date, clock.timezone, sameYear ? 'dd/MM HH:mm' : 'dd/MM/yy HH:mm')
  const dayLabel =
    day === clock.today
      ? 'Hoy'
      : day === clock.yesterday
        ? 'Ayer'
        : capitalize(
            formatInTimeZone(date, clock.timezone, sameYear ? 'EEEE d/M' : 'EEEE d/M/yy', {
              locale: es,
            }),
          )
  return { when, time, day, dayLabel }
}

function toChange(row: PriceChangeRow, ctx: HistoryContext, clock: Clock): HistoryChange {
  return {
    kind: 'change',
    id: row.id,
    itemId: row.itemId,
    itemName: ctx.itemNames.get(row.itemId) ?? GONE_ITEM,
    ...datesOf(row.createdAt, clock),
    who: whoOf(row, ctx),
    branchName: row.branchId === null ? null : (ctx.branchNames.get(row.branchId) ?? GONE_BRANCH),
    what: whatOf(row),
    fromCents: row.oldCents,
    toCents: row.newCents,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const high = sorted[middle] ?? 0
  return sorted.length % 2 === 1 ? high : ((sorted[middle - 1] ?? high) + high) / 2
}

function toBatch(rows: PriceChangeRow[], ctx: HistoryContext, clock: Clock): HistoryBatch {
  const newest = rows[0] as PriceChangeRow
  const changes = rows.map((row) => toChange(row, ctx, clock))
  const first = changes[0] as HistoryChange

  const percents: number[] = []
  let ups = 0
  let downs = 0
  for (const row of rows) {
    if (row.oldCents === null || row.newCents === null) continue
    if (row.newCents > row.oldCents) ups += 1
    else if (row.newCents < row.oldCents) downs += 1
    if (row.oldCents > 0) percents.push(((row.newCents - row.oldCents) / row.oldCents) * 100)
  }
  const direction = ups > 0 && downs === 0 ? 'up' : downs > 0 && ups === 0 ? 'down' : 'mixed'

  let aboutPercent: string | null = null
  if (direction !== 'mixed' && percents.length > 0) {
    const middle = median(percents)
    const close = percents.filter((p) => Math.abs(p - middle) <= PERCENT_TOLERANCE).length
    const rounded = Math.round(Math.abs(middle))
    if (close / percents.length >= PERCENT_AGREEMENT && rounded > 0) {
      aboutPercent = `${rounded}${NBSP}%`
    }
  }

  const branchIds = new Set(rows.map((row) => row.branchId))
  const onlyBranch = branchIds.size === 1 ? newest.branchId : null
  return {
    kind: 'batch',
    id: `tanda:${newest.id}`,
    when: first.when,
    time: first.time,
    day: first.day,
    dayLabel: first.dayLabel,
    who: first.who,
    branchName: onlyBranch === null ? null : (ctx.branchNames.get(onlyBranch) ?? GONE_BRANCH),
    count: new Set(rows.map((row) => row.itemId)).size,
    direction,
    aboutPercent,
    changes,
  }
}

/** Quién hizo junto qué: la tanda que anotó la base o, si no la hay, la persona. */
function actorKey(row: PriceChangeRow): string {
  return row.batchId !== null ? `tanda:${row.batchId}` : `persona:${row.changedBy ?? ''}`
}

type Run = { rows: PriceChangeRow[]; indexes: number[] }

/**
 * Las filas como renglones para leer, de lo más nuevo a lo más viejo. Con `collapse`, los
 * cambios hechos juntos se pliegan en uno: los de una misma tanda anotada por la base o, si no
 * la anotó, los de una misma persona con menos de dos segundos entre uno y otro (dos personas
 * cambiando precios a la vez no se mezclan). `limit` cuenta renglones, no filas.
 */
export function shapeHistory(
  rows: ReadonlyArray<PriceChangeRow>,
  ctx: HistoryContext,
  opts: { collapse: boolean; limit: number },
): HistoryEntry[] {
  const clock = clockOf(ctx)
  const timeOf = (row: PriceChangeRow) => new Date(row.createdAt).getTime()
  const ordered = [...rows].sort(
    (a, b) => timeOf(b) - timeOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  // Cada renglón queda en el lugar de su fila más nueva.
  const placed: Array<{ index: number; entry: HistoryEntry }> = []
  const close = (run: Run) => {
    const distinct = new Set(run.rows.map((row) => row.itemId)).size
    if (opts.collapse && distinct >= BATCH_MIN) {
      placed.push({ index: run.indexes[0] ?? 0, entry: toBatch(run.rows, ctx, clock) })
      return
    }
    run.rows.forEach((row, at) => {
      placed.push({ index: run.indexes[at] ?? 0, entry: toChange(row, ctx, clock) })
    })
  }

  const open = new Map<string, Run>()
  ordered.forEach((row, index) => {
    const key = actorKey(row)
    const run = open.get(key)
    const last = run?.rows[run.rows.length - 1]
    const together =
      last !== undefined && (row.batchId !== null || timeOf(last) - timeOf(row) <= BATCH_GAP_MS)
    if (run && together) {
      run.rows.push(row)
      run.indexes.push(index)
      return
    }
    if (run) close(run)
    open.set(key, { rows: [row], indexes: [index] })
  })
  for (const run of open.values()) close(run)

  return placed
    .sort((a, b) => a.index - b.index)
    .slice(0, opts.limit)
    .map((item) => item.entry)
}

/**
 * «$ 12.500 → $ 13.900», con espacios duros: en un aviso o en una columna angosta el cambio
 * no se parte en dos renglones.
 */
export function priceArrow(fromCents: number | null, toCents: number | null): string {
  return `${formatCentsShort(fromCents)}${NBSP}→${NBSP}${formatCentsShort(toCents)}`
}

/** El cambio en una línea: «$ 12.500 → $ 13.900», «Precio propio: $ 14.000»… */
export function changeText(change: Pick<HistoryChange, 'what' | 'fromCents' | 'toCents'>): string {
  switch (change.what) {
    case 'own-set':
      return `Precio propio: ${formatCentsShort(change.toCents)}`
    case 'own-cleared':
      return `Volvió al precio de la carta (tenía ${formatCentsShort(change.fromCents)})`
    default:
      return priceArrow(change.fromCents, change.toCents)
  }
}

/** El título de una tanda: «Subieron 46 productos, cerca de un 10 %». */
export function batchText(
  batch: Pick<HistoryBatch, 'count' | 'direction' | 'aboutPercent'>,
): string {
  const verb =
    batch.direction === 'up' ? 'Subieron' : batch.direction === 'down' ? 'Bajaron' : 'Cambiaron'
  const about = batch.aboutPercent ? `, cerca de un ${batch.aboutPercent}` : ''
  return `${verb} ${batch.count} productos${about}`
}
