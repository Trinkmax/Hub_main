/**
 * La bandeja de «Importar»: qué se trajo de ARCA, de Mercado Pago y del banco,
 * qué falta traer, qué quedó esperando y qué toca ahora. Todo lo que dibuja la
 * pantalla (`importar/page.tsx`, las tres subidas) sale de acá, ya en palabras.
 *
 * Por qué existe: antes las tres tarjetas decían «Última: 08/10» y nada más. El
 * dato que sirve es el que NO está en ningún archivo: el hueco. Y hay una regla
 * que la pantalla vieja no conocía: nada anterior a la fecha de arranque del
 * bar se puede cargar, así que tampoco «falta».
 *
 * Reglas (las mismas de «Hoy te toca» del Resumen, para que las dos pantallas
 * digan lo mismo):
 * - Mercado Pago y banco tocan los lunes, o cualquier día si ya se venían
 *   subiendo y pasaron más de 8 días (`recent()` de `lib/accounting/onboarding`).
 * - ARCA toca del día 11 en adelante, por cada mes ya terminado que falte.
 *
 * Puro: sin React, sin lecturas, sin reloj (la fecha de hoy llega por parámetro).
 */

import {
  addDays,
  addMonthsToYearMonth,
  capitalizeFirst,
  daysBetween,
  endOfMonth,
  formatDayMonth,
  formatIsoDay,
  formatRange,
  isoDayInCordoba,
  isRealIsoDay,
  monthName,
  monthOf,
  startOfMonth,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'
import type { ImportBatchCounts, ImportBatchStatus } from '@/lib/imports/server/types'
import type { ImportSource } from '@/lib/imports/types'
import {
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importHref,
  importSourceHref,
  isUiImportSource,
  UI_IMPORT_SOURCES,
  type UiImportSource,
} from './labels'
import { count } from './progress'

// ─── Lo que entra ────────────────────────────────────────────────────────────

/** Un archivo subido, con lo que hace falta para la bandeja (sale de `listImportBatches`). */
export type InboxBatch = {
  id: string
  source: ImportSource
  status: ImportBatchStatus
  periodFrom: string | null
  periodTo: string | null
  counts: ImportBatchCounts | null
  /** Lo que todavía falta revisar o cargar. */
  pending: number
  createdAt: string
}

export type InboxTreasury = { id: string; name: string; kind: string; active?: boolean }

/** Los tonos de `StatusPill`. */
export type InboxTone = 'ok' | 'warn' | 'late' | 'info' | 'muted'

// ─── La tira de cobertura ────────────────────────────────────────────────────

export type CoverageState =
  | 'loaded'
  | 'review'
  | 'partial'
  | 'missing'
  | 'today'
  | 'future'
  | 'before'

/** Una marca de la tira: un día (Mercado Pago, banco) o un mes (ARCA). */
export type CoverageCell = {
  key: string
  /** Lo que va adentro del casillero de un mes («sep»); en días, `dd/MM`. */
  label: string
  /** El dato entero, para el globito y para lectores: «Lun 12/10: falta subir». */
  title: string
  state: CoverageState
  /** El archivo que lo cubre (solo en meses: cada casillero subido es un link). */
  href?: string
  /** Rótulo debajo de la marca (solo algunos: el primer día, los lunes, «ayer»). */
  tick?: string
}

// ─── Lo que sale ─────────────────────────────────────────────────────────────

export type InboxHero = {
  /** «FALTA BAJAR» / «SIN SUBIR»; `null` cuando está al día. */
  label: string | null
  value: string
  /** La unidad chica pegada al número («días», «meses»). */
  unit: string | null
  sentence: string
  /** Está al día: lleva tilde. */
  upToDate: boolean
  /** Ya toca: lleva la píldora «Te toca» (solo a quien puede cargar). */
  due: boolean
}

export type InboxNote = { text: string; link?: { label: string; href: string } }

/** Una hoja que quedó esperando en la bandeja. */
export type InboxSheet = {
  id: string
  href: string
  title: string
  detail: string
  kind: 'review' | 'staging'
}

export type InboxAction = { label: string; href: string }

export type InboxTray = {
  source: UiImportSource
  name: string
  /** La línea gris del rótulo: qué trae y cada cuánto. */
  line: string
  state: 'ok' | 'never' | 'blocked'
  /** Con `blocked`: qué falta antes de poder usarla. */
  blocked: string | null
  /** Con `never`: qué va a llegar acá. */
  empty: { title: string; text: string } | null
  hero: InboxHero | null
  strip: { granularity: 'day' | 'month'; cells: CoverageCell[]; ariaLabel: string } | null
  /** «Última vez: el 08/10 subiste septiembre.» */
  last: string | null
  notes: InboxNote[]
  waiting: InboxSheet[]
  /** Hojas que esperan y no entran a la vista. */
  waitingMore: number
  waitingMoreHref: string
  /** LA acción de la bandeja. `null` para quien solo lee. */
  action: InboxAction | null
  secondary: InboxAction | null
  /** «¿Cómo se baja?» (el paso 1 de la subida). `null` para quien solo lee. */
  howHref: string | null
}

export type InboxNext = {
  kind: 'resume' | 'review' | 'arca_month' | 'weekly'
  sentence: string
  action: InboxAction
}

export type Inbox = {
  trays: InboxTray[]
  next: InboxNext | null
  /** «Lo próximo: Mercado Pago, el lunes 19/10; las compras de octubre, desde el 11/11.» */
  agenda: string
  /** «Tus números arrancan el 12/10: todavía no hay nada atrasado.» (bar que recién arranca). */
  startNote: string | null
  /** Alguna vez se cargó algo desde un archivo. */
  everLoaded: boolean
}

export type InboxInput = {
  /** Hoy en Córdoba, `yyyy-MM-dd`. */
  today: string
  batches: readonly InboxBatch[]
  /** Las cajas activas; `null` si no se pudieron leer (no se bloquea nada). */
  treasuries: readonly InboxTreasury[] | null
  /** La fecha de arranque; `null` si no se pudo leer (no se recorta nada). */
  booksStartDate: string | null
  /** `null` = no se sabe (no se muestra el aviso). */
  hasCuit: boolean | null
  canWrite: boolean
  slug: string
}

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Del 11 en adelante ya están casi todas las facturas del mes anterior en ARCA. */
export const ARCA_FROM_DAY = 11
/** Cuántos meses hacia atrás se mira si falta alguno (ARCA deja pedir un año). */
const ARCA_BACK_MONTHS = 12
/** Meses de la tira de ARCA. */
const ARCA_STRIP_MONTHS = 6
/** Días de la tira de Mercado Pago y del banco. */
export const STRIP_DAYS = 35
/** Hasta cuántos días atrás deja pedir cada origen. */
const SOURCE_BACK_DAYS = { mp_release: 60, bank_statement: 90 } as const
/** Una subida de los últimos 8 días cuenta como «la de esta semana». */
const RECENT_DAYS = 8
/** Hojas que asoman en cada bandeja. */
const MAX_SHEETS = 2
/** Separación mínima (en marcas) entre dos rótulos de la tira de días. */
const TICK_GAP = 6

const TRAY_LINE: Readonly<Record<UiImportSource, string>> = {
  arca_recibidos: 'Las compras con factura · una vez por mes, del 11 en adelante',
  mp_release: 'Cobros, comisiones y retiros · una vez por semana',
  bank_statement: 'Comisiones, impuestos y transferencias · una vez por semana',
}

const TRAY_EMPTY: Readonly<Record<UiImportSource, { title: string; text: string; cta: string }>> = {
  arca_recibidos: {
    title: 'Todavía no subiste nada',
    text: 'Acá llegan las facturas que te hicieron tus proveedores, sin tipear ninguna. Son unos 5 minutos por mes. Trae solo lo que tiene factura: lo que compraste con remito o sin papel se carga con «＋ Cargar».',
    cta: 'Subir las compras de ARCA',
  },
  mp_release: {
    title: 'Todavía no subiste nada',
    text: 'Acá llega lo que cobraste por QR, Point y transferencias, lo que se quedó Mercado Pago y lo que te depositó, día por día. La primera vez te pregunto dos cosas.',
    cta: 'Subir el primer reporte',
  },
  bank_statement: {
    title: 'Todavía no subiste nada',
    text: 'Acá llegan las comisiones, los impuestos, las transferencias y los pagos del banco. Y te digo si tu saldo coincide con el de ellos.',
    cta: 'Subir los movimientos del banco',
  },
}

/** «Quedó un archivo {de ARCA} a medio subir.» */
const SOURCE_OF: Readonly<Record<UiImportSource, string>> = {
  arca_recibidos: 'de ARCA',
  mp_release: 'de Mercado Pago',
  bank_statement: 'del banco',
}

// ─── Fechas en palabras ──────────────────────────────────────────────────────

function valid(day: string | null | undefined): string | null {
  return typeof day === 'string' && isRealIsoDay(day) ? day : null
}

function monthWord(ym: string): string {
  return monthName(Number(ym.slice(5, 7)))
}

/** «agosto», «agosto y septiembre», «julio, agosto y septiembre». */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} y ${words[words.length - 1]}`
}

/** ¿El rango es un mes entero (del 1 al último día del mismo mes)? */
function wholeMonth(from: string, to: string): boolean {
  return monthOf(from) === monthOf(to) && from === startOfMonth(from) && to === endOfMonth(to)
}

/** El día de Córdoba de un instante (`created_at`). */
function dayOfInstant(instant: string): string | null {
  return valid(isoDayInCordoba(instant) ?? instant.slice(0, 10))
}

function mondayAfter(today: string): string {
  const ahead = (8 - weekdayOf(today)) % 7
  return addDays(today, ahead === 0 ? 7 : ahead)
}

function mondayWords(day: string): string {
  return `lunes ${formatDayMonth(day)}`
}

function daysWords(n: number): string {
  return n === 1 ? '1 día' : `${n} días`
}

/**
 * El período de un archivo, como título: «Septiembre» si es un mes entero; si
 * no, «07/10 – 08/10» (con el año solo si no es el de hoy). Sin fechas, «Sin fechas».
 */
export function batchPeriodLabel(
  batch: Pick<InboxBatch, 'periodFrom' | 'periodTo'>,
  today?: string | null,
): string {
  const from = valid(batch.periodFrom)
  const to = valid(batch.periodTo)
  if (!from || !to) return 'Sin fechas'
  const year = valid(today)?.slice(0, 4) ?? to.slice(0, 4)
  const sameYear = from.slice(0, 4) === year && to.slice(0, 4) === year
  if (wholeMonth(from, to)) {
    const name = capitalizeFirst(monthWord(from))
    return sameYear ? name : `${name} ${from.slice(0, 4)}`
  }
  if (!sameYear) return formatRange(from, to)
  return from === to ? formatDayMonth(from) : `${formatDayMonth(from)} – ${formatDayMonth(to)}`
}

/**
 * El período adentro de una oración: «de septiembre», «del 07/10 al 08/10»,
 * «del 08/10». Sin fechas, cadena vacía.
 */
export function periodWords(from: string | null, to: string | null): string {
  const a = valid(from)
  const b = valid(to)
  if (!a || !b) return ''
  if (wholeMonth(a, b)) return `de ${monthWord(a)}`
  return a === b ? `del ${formatDayMonth(a)}` : `del ${formatDayMonth(a)} al ${formatDayMonth(b)}`
}

/** De qué es un archivo, como sujeto: «las compras de septiembre», «Mercado Pago del 07/10 al 08/10». */
export function batchSubject(
  batch: Pick<InboxBatch, 'source' | 'periodFrom' | 'periodTo'>,
  bankName?: string | null,
): string {
  const period = periodWords(batch.periodFrom, batch.periodTo)
  const base =
    batch.source === 'mp_release'
      ? 'Mercado Pago'
      : batch.source === 'bank_statement'
        ? bankName?.trim() || 'el banco'
        : batch.source === 'arca_emitidos'
          ? 'las ventas de ARCA'
          : 'las compras'
  return period ? `${base} ${period}` : base
}

// ─── El estado de un archivo ─────────────────────────────────────────────────

export type BatchDisplayStatus = {
  key: 'staging' | 'review' | 'posting' | 'loaded' | 'nothing' | 'cancelled'
  label: string
  tone: InboxTone
  hint: string
}

/**
 * El estado de un archivo como se le dice al dueño. Resuelve en pantalla el
 * archivo «eterno»: si ya no le queda nada pendiente, no sigue «Para revisar»
 * aunque la base lo tenga así (cerrarlo de verdad necesita una migración).
 */
export function displayBatchStatus(
  batch: Pick<InboxBatch, 'status' | 'pending' | 'counts'>,
): BatchDisplayStatus {
  const posted = batch.counts?.posted ?? 0
  if (batch.status === 'cancelled') {
    return {
      key: 'cancelled',
      label: 'Descartado',
      tone: 'muted',
      hint: 'Se descartó: lo que ya se había cargado sigue registrado.',
    }
  }
  if (batch.status === 'staging') {
    return {
      key: 'staging',
      label: 'A medio subir',
      tone: 'warn',
      hint: 'No se terminó de subir. Volvé a subir el mismo archivo: sigo donde quedó.',
    }
  }
  if (batch.status !== 'done' && batch.pending > 0) {
    return batch.status === 'posting'
      ? {
          key: 'posting',
          label: 'A medio cargar',
          tone: 'warn',
          hint: 'Ya se cargó una parte: entrá para revisar y cargar lo que falta.',
        }
      : {
          key: 'review',
          label: 'Para revisar',
          tone: 'warn',
          hint: 'Ya está armado: revisalo y cargalo.',
        }
  }
  return posted > 0
    ? {
        key: 'loaded',
        label: 'Cargado',
        tone: 'ok',
        hint: 'Se cargó todo lo que había para cargar.',
      }
    : {
        key: 'nothing',
        label: 'Nada para cargar',
        tone: 'muted',
        hint: 'No quedó nada para cargar de este archivo.',
      }
}

/** Lo que espera adentro de un archivo: preguntas por contestar y listos para cargar. */
export function batchWaiting(batch: Pick<InboxBatch, 'counts' | 'pending'>): {
  questions: number
  ready: number
} {
  const c = batch.counts
  if (!c) return { questions: batch.pending, ready: 0 }
  return { questions: c.needsInput + c.stale + c.error, ready: c.ready + c.posting }
}

// ─── Cobertura ───────────────────────────────────────────────────────────────

type Span = { from: string; to: string; waiting: boolean; batchId: string }

/** Los archivos de un origen que cuentan (ni descartados ni emitidos), del más nuevo al más viejo. */
function ofSource(batches: readonly InboxBatch[], source: UiImportSource): InboxBatch[] {
  return batches
    .filter((b) => b.source === source && b.status !== 'cancelled')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/**
 * Lo que ya está traído: los archivos con período que no quedaron a medio
 * subir, recortados a la fecha de arranque (lo anterior no se puede cargar, así
 * que tampoco «cubre»).
 */
function coverage(batches: readonly InboxBatch[], start: string | null): Span[] {
  const out: Span[] = []
  for (const b of batches) {
    if (b.status === 'staging') continue
    const from = valid(b.periodFrom)
    const to = valid(b.periodTo)
    if (!from || !to || to < from) continue
    if (start && to < start) continue
    out.push({
      from: start && from < start ? start : from,
      to,
      waiting: b.pending > 0,
      batchId: b.id,
    })
  }
  return out
}

function spanOf(spans: readonly Span[], day: string): Span | null {
  return spans.find((s) => s.from <= day && day <= s.to) ?? null
}

/** El primer hueco (de atrás para adelante) entre dos días, o `null` si está todo cubierto. */
function latestGap(
  spans: readonly Span[],
  from: string,
  to: string,
): { from: string; to: string } | null {
  if (to < from) return null
  let end: string | null = null
  for (let day = to, guard = 0; day >= from && guard < 800; day = addDays(day, -1), guard++) {
    const covered = spanOf(spans, day) !== null
    if (!covered && end === null) end = day
    if (covered && end !== null) return { from: addDays(day, 1), to: end }
  }
  return end === null ? null : { from, to: end }
}

/** ¿Todos los días del rango están cubiertos? Y si alguno de los archivos espera revisión. */
function rangeState(
  spans: readonly Span[],
  from: string,
  to: string,
): {
  all: boolean
  any: boolean
  waiting: boolean
  batchId: string | null
  firstGap: string | null
} {
  let all = true
  let any = false
  let waiting = false
  let batchId: string | null = null
  let firstGap: string | null = null
  for (let day = from, guard = 0; day <= to && guard < 400; day = addDays(day, 1), guard++) {
    const span = spanOf(spans, day)
    if (span) {
      any = true
      waiting = waiting || span.waiting
      batchId = batchId ?? span.batchId
    } else {
      all = false
      firstGap = firstGap ?? day
    }
  }
  return { all, any, waiting, batchId, firstGap }
}

// ─── ARCA: por meses ─────────────────────────────────────────────────────────

type ArcaMonth = {
  month: string
  state: CoverageState
  /** Lo que cuenta de ese mes (desde el arranque) y todavía no está traído. */
  from: string
  to: string
  batchId: string | null
}

function arcaMonth(
  month: string,
  today: string,
  spans: readonly Span[],
  start: string | null,
): ArcaMonth {
  const first = startOfMonth(month)
  const last = endOfMonth(month)
  const from = start && start > first ? start : first
  const base = { month, from, to: last, batchId: null }
  if (start && start > last) return { ...base, state: 'before' }
  if (month === monthOf(today)) return { ...base, state: 'today' }
  if (month > monthOf(today)) return { ...base, state: 'future' }
  const r = rangeState(spans, from, last)
  if (r.all) return { ...base, state: r.waiting ? 'review' : 'loaded', batchId: r.batchId }
  // El mes terminó, pero recién del 11 del mes siguiente están casi todas sus facturas.
  const available = today >= addDays(last, ARCA_FROM_DAY)
  if (!available) return { ...base, state: 'future' }
  return {
    ...base,
    state: r.any ? 'partial' : 'missing',
    from: r.firstGap ?? from,
    batchId: r.batchId,
  }
}

function arcaMonths(today: string, spans: readonly Span[], start: string | null, back: number) {
  const out: ArcaMonth[] = []
  for (let i = back - 1; i >= 0; i--) {
    out.push(arcaMonth(addMonthsToYearMonth(monthOf(today), -i), today, spans, start))
  }
  return out
}

function isMissing(m: ArcaMonth): boolean {
  return m.state === 'missing' || m.state === 'partial'
}

/** El próximo mes que se va a poder bajar y desde qué día. */
function nextArca(today: string, spans: readonly Span[], start: string | null) {
  const current = monthOf(today)
  for (let i = -1; i <= 24; i++) {
    const month = addMonthsToYearMonth(current, i)
    const last = endOfMonth(month)
    if (start && start > last) continue
    const availableOn = addDays(last, ARCA_FROM_DAY)
    if (availableOn <= today) continue
    const first = start && start > startOfMonth(month) ? start : startOfMonth(month)
    if (last < today && rangeState(spans, first, last).all) continue
    return { month, availableOn, from: first, to: last }
  }
  const month = addMonthsToYearMonth(current, 1)
  return {
    month,
    availableOn: addDays(endOfMonth(month), ARCA_FROM_DAY),
    from: startOfMonth(month),
    to: endOfMonth(month),
  }
}

const MONTH_STATE_WORDS: Readonly<Record<CoverageState, string>> = {
  loaded: 'subido',
  review: 'subido, falta revisarlo',
  partial: 'subido a medias',
  missing: 'falta bajarlo',
  today: 'en curso',
  future: 'todavía no se baja',
  before: 'de antes de arrancar',
}

function arcaStrip(input: InboxInput, spans: readonly Span[], start: string | null) {
  const months = arcaMonths(input.today, spans, start, ARCA_STRIP_MONTHS)
  const cells: CoverageCell[] = months.map((m) => {
    const name = capitalizeFirst(monthWord(m.month))
    const words =
      m.state === 'today' || m.state === 'future'
        ? `se baja desde el ${formatDayMonth(addDays(endOfMonth(m.month), ARCA_FROM_DAY))}`
        : MONTH_STATE_WORDS[m.state]
    return {
      key: m.month,
      label: monthWord(m.month).slice(0, 3),
      title: `${name}: ${words}`,
      state: m.state,
      ...(m.batchId && (m.state === 'loaded' || m.state === 'review' || m.state === 'partial')
        ? { href: importBatchHref(input.slug, m.batchId) }
        : {}),
    }
  })
  const missing = months.filter(isMissing).map((m) => monthWord(m.month))
  const loaded = months.filter((m) => m.state === 'loaded' || m.state === 'review').length
  const ariaLabel = [
    `Los últimos ${months.length} meses.`,
    loaded > 0 ? `${count(loaded, 'mes subido', 'meses subidos')}.` : 'Ningún mes subido todavía.',
    missing.length > 0 ? `Falta bajar ${joinWords(missing)}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { granularity: 'month' as const, cells, ariaLabel }
}

// ─── Mercado Pago y banco: por días ──────────────────────────────────────────

type WeeklyFacts = {
  /** El primer día que se puede pedir: el arranque, o el tope del origen si queda después. */
  windowStart: string
  /** Manda el tope del origen (60 o 90 días), no el arranque. */
  capped: boolean
  yesterday: string
  /** Desde qué día falta (el siguiente a lo último subido); `null` si no falta nada. */
  since: string | null
  days: number
  /** Por qué se pide desde ese día: sigue a lo último subido, es el arranque o es el tope del origen. */
  reason: 'after_last' | 'start' | 'cap'
  gap: { from: string; to: string } | null
}

function weeklyFacts(
  source: 'mp_release' | 'bank_statement',
  today: string,
  spans: readonly Span[],
  start: string | null,
): WeeklyFacts {
  const yesterday = addDays(today, -1)
  const capStart = addDays(today, -SOURCE_BACK_DAYS[source])
  const capped = !start || capStart > start
  const windowStart = capped ? capStart : (start as string)
  const lastTo = spans.reduce<string | null>(
    (max, s) => (max === null || s.to > max ? s.to : max),
    null,
  )
  const after = lastTo ? addDays(lastTo, 1) : null
  const followsLast = after !== null && after >= windowStart
  const sinceDay = followsLast ? after : windowStart
  const days = sinceDay <= yesterday ? daysBetween(sinceDay, yesterday) + 1 : 0
  const gapEnd = lastTo && lastTo < yesterday ? lastTo : yesterday
  return {
    windowStart,
    capped,
    yesterday,
    since: days > 0 ? sinceDay : null,
    days,
    reason: followsLast ? 'after_last' : capped ? 'cap' : 'start',
    gap: followsLast ? latestGap(spans, windowStart, gapEnd) : null,
  }
}

const DAY_STATE_WORDS: Readonly<Record<CoverageState, string>> = {
  loaded: 'subido',
  review: 'subido, falta revisarlo',
  partial: 'subido a medias',
  missing: 'falta subir',
  today: 'hoy',
  future: 'todavía no toca',
  before: 'de antes de arrancar',
}

function dayTitle(day: string): string {
  return capitalizeFirst(`${WEEKDAY_NAMES_SHORT[weekdayOf(day)] ?? ''} ${formatDayMonth(day)}`)
}

/**
 * Los rótulos de la tira de días: «ayer», el primer día y los lunes, sin que
 * dos queden pegados (gana «ayer», después el primero).
 */
function dayTicks(days: readonly string[], yesterday: string): Map<number, string> {
  const ticks = new Map<number, string>()
  const place = (index: number, text: string) => {
    if (index < 0 || index >= days.length) return
    for (const taken of ticks.keys()) if (Math.abs(taken - index) < TICK_GAP) return
    ticks.set(index, text)
  }
  place(days.indexOf(yesterday), 'ayer')
  place(0, formatDayMonth(days[0]))
  days.forEach((day, index) => {
    if (weekdayOf(day) === 1) place(index, formatDayMonth(day))
  })
  return ticks
}

function dayStrip(today: string, spans: readonly Span[], start: string | null, name: string) {
  const days: string[] = []
  for (let i = STRIP_DAYS - 1; i >= 0; i--) days.push(addDays(today, -i))
  const ticks = dayTicks(days, addDays(today, -1))
  let loaded = 0
  let missing = 0
  const cells: CoverageCell[] = days.map((day, index) => {
    const span = spanOf(spans, day)
    const state: CoverageState =
      day === today
        ? 'today'
        : start && day < start
          ? 'before'
          : span
            ? span.waiting
              ? 'review'
              : 'loaded'
            : 'missing'
    if (state === 'loaded' || state === 'review') loaded++
    if (state === 'missing') missing++
    const tick = ticks.get(index)
    return {
      key: day,
      label: formatDayMonth(day),
      title: `${dayTitle(day)}: ${DAY_STATE_WORDS[state]}`,
      state,
      ...(tick ? { tick } : {}),
    }
  })
  const ariaLabel = [
    `${name}, los últimos ${STRIP_DAYS} días.`,
    loaded > 0 ? `${count(loaded, 'día subido', 'días subidos')}.` : 'Ningún día subido todavía.',
    missing > 0 ? `${count(missing, 'día sin subir', 'días sin subir')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { granularity: 'day' as const, cells, ariaLabel }
}

/** Lo que usa `recent()` de `lib/accounting/onboarding`: la última subida es de esta semana. */
function recent(lastAt: string | null, today: string): boolean {
  const day = lastAt ? dayOfInstant(lastAt) : null
  return day !== null && daysBetween(day, today) <= RECENT_DAYS
}

// ─── Cada bandeja ────────────────────────────────────────────────────────────

function sheetsOf(input: InboxInput, list: readonly InboxBatch[]) {
  const waiting = list
    .filter((b) => b.status === 'staging' || b.pending > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  const sheets: InboxSheet[] = waiting.slice(0, MAX_SHEETS).map((b) => {
    if (b.status === 'staging') {
      return {
        id: b.id,
        href: importBatchHref(input.slug, b.id),
        title: 'A medio subir',
        detail: 'Volvé a subir el mismo archivo: sigo donde quedó.',
        kind: 'staging',
      }
    }
    const { questions, ready } = batchWaiting(b)
    const parts = [
      questions > 0 ? `${questions} con una pregunta` : null,
      ready > 0 ? count(ready, 'listo', 'listos') : null,
    ].filter(Boolean)
    return {
      id: b.id,
      href: importBatchHref(input.slug, b.id),
      title: batchPeriodLabel(b, input.today),
      detail: parts.length > 0 ? parts.join(' · ') : count(b.pending, 'pendiente', 'pendientes'),
      kind: 'review',
    }
  })
  return { waiting, sheets, more: Math.max(0, waiting.length - MAX_SHEETS) }
}

function lastLine(
  list: readonly InboxBatch[],
  today: string,
): { text: string; batch: InboxBatch } | null {
  const batch = list.find((b) => b.status !== 'staging') ?? null
  if (!batch) return null
  const when = dayOfInstant(batch.createdAt)
  const period = periodWords(batch.periodFrom, batch.periodTo)
  const what = period ? ` subiste ${period.replace(/^de /, '')}` : ' subiste un archivo'
  const day = when
    ? `el ${when.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(when) : formatIsoDay(when)}`
    : ''
  return { text: `Última vez: ${day}${what}.`, batch }
}

type TrayContext = {
  input: InboxInput
  start: string | null
  base: string
}

function uploadLabel(source: UiImportSource): string {
  return IMPORT_SOURCE_COPY[source].cta
}

function trayFrame(ctx: TrayContext, source: UiImportSource, list: readonly InboxBatch[]) {
  const { input } = ctx
  const { waiting, sheets, more } = sheetsOf(input, list)
  const uploadHref = importSourceHref(input.slug, source)
  const oldest = waiting[0] ?? null
  const action: InboxAction | null = !input.canWrite
    ? null
    : oldest
      ? oldest.status === 'staging'
        ? { label: 'Terminar de subirlo', href: uploadHref }
        : { label: 'Seguir revisando', href: importBatchHref(input.slug, oldest.id) }
      : { label: uploadLabel(source), href: uploadHref }
  return {
    waiting: sheets,
    waitingMore: more,
    waitingMoreHref: `${importHref(input.slug)}?origen=${source}#historial`,
    action,
    secondary:
      input.canWrite && oldest && oldest.status !== 'staging'
        ? { label: 'Subir otro archivo', href: uploadHref }
        : null,
    howHref: input.canWrite ? `${uploadHref}#paso-1` : null,
  }
}

function preStartNote(last: InboxBatch | null, start: string | null): InboxNote | null {
  const to = valid(last?.periodTo)
  if (!start || !to || to >= start) return null
  return {
    text: `Eso es de antes del ${formatDayMonth(start)}, cuando arrancan tus números: no entra.`,
  }
}

function neverTray(ctx: TrayContext, source: UiImportSource, name: string): InboxTray {
  const { input } = ctx
  const empty = TRAY_EMPTY[source]
  const uploadHref = importSourceHref(input.slug, source)
  return {
    source,
    name,
    line: TRAY_LINE[source],
    state: 'never',
    blocked: null,
    empty: { title: empty.title, text: empty.text },
    hero: null,
    strip: null,
    last: null,
    notes: [],
    waiting: [],
    waitingMore: 0,
    waitingMoreHref: `${importHref(input.slug)}?origen=${source}#historial`,
    action: input.canWrite ? { label: empty.cta, href: uploadHref } : null,
    secondary: null,
    howHref: input.canWrite ? `${uploadHref}#paso-1` : null,
  }
}

function arcaTray(
  ctx: TrayContext,
  list: readonly InboxBatch[],
): { tray: InboxTray; missing: ArcaMonth[] } {
  const { input, start, base } = ctx
  const source = 'arca_recibidos' as const
  if (list.length === 0) return { tray: neverTray(ctx, source, 'ARCA'), missing: [] }
  const spans = coverage(list, start)
  const missing = arcaMonths(input.today, spans, start, ARCA_BACK_MONTHS).filter(isMissing)
  const next = nextArca(input.today, spans, start)
  const hero: InboxHero =
    missing.length === 0
      ? {
          label: null,
          value: 'Al día',
          unit: null,
          sentence: `${capitalizeFirst(monthWord(next.month))} se baja desde el ${formatDayMonth(next.availableOn)}.`,
          upToDate: true,
          due: false,
        }
      : missing.length === 1
        ? {
            label: 'Falta bajar',
            value: capitalizeFirst(monthWord(missing[0]?.month ?? '')),
            unit: null,
            sentence: 'Ya están casi todas las facturas del mes.',
            upToDate: false,
            due: input.canWrite,
          }
        : {
            label: 'Falta bajar',
            value: String(missing.length),
            unit: 'meses',
            sentence: `${capitalizeFirst(joinWords(missing.map((m) => monthWord(m.month))))}.`,
            upToDate: false,
            due: input.canWrite,
          }
  const last = lastLine(list, input.today)
  const notes: InboxNote[] = []
  const pre = preStartNote(last?.batch ?? null, start)
  if (pre) notes.push(pre)
  if (input.hasCuit === false && input.canWrite) {
    notes.push({
      text: 'Sin el CUIT del bar no puedo chequear que el archivo sea tuyo.',
      link: { label: 'Cargalo', href: `${base}/ajustes?tab=sas` },
    })
  }
  return {
    missing,
    tray: {
      source,
      name: 'ARCA',
      line: TRAY_LINE[source],
      state: 'ok',
      blocked: null,
      empty: null,
      hero,
      strip: arcaStrip(input, spans, start),
      last: last?.text ?? null,
      notes: notes.slice(0, 2),
      ...trayFrame(ctx, source, list),
    },
  }
}

type WeeklyResult = {
  tray: InboxTray
  /** Toca hoy (la regla de «Hoy te toca»). */
  due: boolean
  /** Ya se subió alguna vez. */
  used: boolean
  blocked: boolean
  facts: WeeklyFacts | null
}

function weeklyTray(
  ctx: TrayContext,
  source: 'mp_release' | 'bank_statement',
  list: readonly InboxBatch[],
): WeeklyResult {
  const { input, start, base } = ctx
  const kind = source === 'mp_release' ? 'wallet' : 'bank'
  const own = (input.treasuries ?? []).filter((t) => t.kind === kind && t.active !== false)
  const only = own.length === 1 ? own[0] : undefined
  const name = source === 'mp_release' ? 'Mercado Pago' : (only?.name ?? 'Banco')
  const blocked = input.treasuries !== null && own.length === 0

  if (blocked) {
    const text =
      source === 'mp_release'
        ? 'Primero agregá tu cuenta de Mercado Pago.'
        : 'Primero decime cuál es tu cuenta del banco.'
    return {
      due: false,
      used: list.length > 0,
      blocked: true,
      facts: null,
      tray: {
        source,
        name,
        line: TRAY_LINE[source],
        state: 'blocked',
        blocked: text,
        empty: null,
        hero: null,
        strip: null,
        last: null,
        notes: [],
        waiting: [],
        waitingMore: 0,
        waitingMoreHref: `${importHref(input.slug)}?origen=${source}#historial`,
        action: input.canWrite
          ? { label: 'Agregar la cuenta', href: `${base}/ajustes?tab=cajas` }
          : null,
        secondary: null,
        howHref: null,
      },
    }
  }

  const spans = coverage(list, start)
  const facts = weeklyFacts(source, input.today, spans, start)
  const used = list.length > 0
  const monday = weekdayOf(input.today) === 1
  const due = facts.days > 0 && !recent(list[0]?.createdAt ?? null, input.today) && (monday || used)

  if (!used) {
    return { due, used, blocked: false, facts, tray: neverTray(ctx, source, name) }
  }

  const hero: InboxHero =
    facts.since === null
      ? {
          label: null,
          value: 'Al día',
          unit: null,
          sentence:
            facts.windowStart > facts.yesterday
              ? 'Todavía no hay nada para traer.'
              : 'Subiste hasta ayer.',
          upToDate: true,
          due: false,
        }
      : {
          label: 'Sin subir',
          value: String(facts.days),
          unit: facts.days === 1 ? 'día' : 'días',
          sentence: `${
            facts.days === 1
              ? `Falta ayer, ${formatDayMonth(facts.yesterday)}.`
              : `Del ${formatDayMonth(facts.since)} a ayer.`
          }${due ? '' : ` Toca el ${mondayWords(mondayAfter(input.today))}.`}`,
          upToDate: false,
          due: due && input.canWrite,
        }
  const last = lastLine(list, input.today)
  const notes: InboxNote[] = []
  const pre = preStartNote(last?.batch ?? null, start)
  if (pre) notes.push(pre)
  if (facts.gap) {
    notes.push({
      text:
        facts.gap.from === facts.gap.to
          ? `También falta el ${formatDayMonth(facts.gap.from)}.`
          : `También falta del ${formatDayMonth(facts.gap.from)} al ${formatDayMonth(facts.gap.to)}.`,
    })
  }
  return {
    due,
    used,
    blocked: false,
    facts,
    tray: {
      source,
      name,
      line: TRAY_LINE[source],
      state: 'ok',
      blocked: null,
      empty: null,
      hero,
      strip: dayStrip(input.today, spans, start, name),
      last: last?.text ?? null,
      notes: notes.slice(0, 2),
      ...trayFrame(ctx, source, list),
    },
  }
}

// ─── «Te toca» y la agenda ───────────────────────────────────────────────────

function unitOfSource(source: ImportSource, n: number): string {
  const [one, many] =
    source === 'arca_recibidos' || source === 'arca_emitidos'
      ? (['comprobante', 'comprobantes'] as const)
      : (['movimiento', 'movimientos'] as const)
  return n === 1 ? one : many
}

function reviewNext(
  input: InboxInput,
  pending: readonly InboxBatch[],
  bankName: string | null,
): InboxNext {
  const first = pending[0] as InboxBatch
  const subject = batchSubject(first, bankName)
  const action = { label: 'Seguir revisando', href: importBatchHref(input.slug, first.id) }
  if (pending.length > 1) {
    return {
      kind: 'review',
      sentence: `Tenés ${pending.length} archivos a medio revisar. Empezá por ${subject}.`,
      action,
    }
  }
  const { questions, ready } = batchWaiting(first)
  const plural = first.source === 'arca_recibidos' || first.source === 'arca_emitidos'
  const verb = plural ? 'tienen' : 'tiene'
  const name = capitalizeFirst(subject)
  const sentence =
    questions > 0
      ? `${name} ${verb} ${questions} ${unitOfSource(first.source, questions)} con una pregunta${
          ready > 0 ? ` y ${count(ready, 'listo', 'listos')} para cargar` : ''
        }.`
      : `${name} ${verb} ${ready} ${unitOfSource(first.source, ready)} ${ready === 1 ? 'listo' : 'listos'} para cargar.`
  return { kind: 'review', sentence, action }
}

/**
 * Todo lo que dibuja la bandeja: las tres bandejas (siempre en el mismo orden),
 * lo que toca ahora (una sola cosa, la más urgente) y la agenda.
 */
export function buildInbox(input: InboxInput): Inbox {
  const start = valid(input.booksStartDate)
  const base = `/${input.slug}/administracion`
  const ctx: TrayContext = { input, start, base }
  const lists = Object.fromEntries(
    UI_IMPORT_SOURCES.map((s) => [s, ofSource(input.batches, s)]),
  ) as Record<UiImportSource, InboxBatch[]>

  const arca = arcaTray(ctx, lists.arca_recibidos)
  const mp = weeklyTray(ctx, 'mp_release', lists.mp_release)
  const bank = weeklyTray(ctx, 'bank_statement', lists.bank_statement)
  const trays = [arca.tray, mp.tray, bank.tray]
  const bankName = bank.tray.name === 'Banco' ? null : bank.tray.name

  const everLoaded = input.batches.some((b) => (b.counts?.posted ?? 0) > 0)
  const arcaSpans = coverage(lists.arca_recibidos, start)
  // Sin ningún archivo de ARCA también puede faltar un mes (la bandeja «nunca usada»).
  const arcaMissing =
    lists.arca_recibidos.length > 0
      ? arca.missing
      : arcaMonths(input.today, arcaSpans, start, ARCA_BACK_MONTHS).filter(isMissing)
  const arcaDue = Number(input.today.slice(8, 10)) >= ARCA_FROM_DAY && arcaMissing.length > 0

  let next: InboxNext | null = null
  if (input.canWrite) {
    const ui = input.batches
      .filter((b) => isUiImportSource(b.source) && b.status !== 'cancelled')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    const staging = ui.find((b) => b.status === 'staging') ?? null
    const pending = ui.filter((b) => b.status !== 'staging' && b.pending > 0)
    if (staging && isUiImportSource(staging.source)) {
      next = {
        kind: 'resume',
        sentence: `Quedó un archivo ${SOURCE_OF[staging.source]} a medio subir.`,
        action: {
          label: 'Terminar de subirlo',
          href: importSourceHref(input.slug, staging.source),
        },
      }
    } else if (pending.length > 0) {
      next = reviewNext(input, pending, bankName)
    } else if (arcaDue) {
      const names = arcaMissing.map((m) => monthWord(m.month))
      const first = !lists.arca_recibidos.some((b) => (b.counts?.posted ?? 0) > 0)
      next = {
        kind: 'arca_month',
        sentence: first
          ? `Empezá por las compras de ${joinWords(names)} de ARCA: son todas las facturas que te hicieron, sin tipear ninguna.`
          : `Ya se pueden bajar las compras de ${joinWords(names)} de ARCA.`,
        action: {
          label:
            names.length === 1 ? `Subir las compras de ${names[0]}` : 'Subir las compras de ARCA',
          href: importSourceHref(input.slug, 'arca_recibidos'),
        },
      }
    } else if (mp.due || bank.due) {
      const pick = mp.due ? mp : bank
      const source = mp.due ? ('mp_release' as const) : ('bank_statement' as const)
      const name = source === 'mp_release' ? 'Mercado Pago' : 'el banco'
      const days = pick.facts?.days ?? 0
      next = {
        kind: 'weekly',
        sentence:
          mp.due && bank.due
            ? weekdayOf(input.today) === 1
              ? 'Hoy tocan Mercado Pago y el banco. Empezá por Mercado Pago.'
              : 'Tocan Mercado Pago y el banco. Empezá por Mercado Pago.'
            : pick.used
              ? `Hace ${daysWords(days)} que no subís ${name}.`
              : `Hoy toca ${name}: ya hay ${daysWords(days)} para traer.`,
        action: {
          label: uploadLabel(source),
          href: importSourceHref(input.slug, source),
        },
      }
    }
  }

  // La agenda: lo semanal que el bar puede subir, el próximo lunes; ARCA, el 11 que sigue.
  const weekly = [mp.blocked ? null : 'Mercado Pago', bank.blocked ? null : 'el banco'].filter(
    (name): name is string => name !== null,
  )
  const arcaNext = nextArca(input.today, arcaSpans, start)
  const parts = [
    weekly.length > 0 ? `${joinWords(weekly)}, el ${mondayWords(mondayAfter(input.today))}` : null,
    `las compras de ${monthWord(arcaNext.month)}, desde el ${formatDayMonth(arcaNext.availableOn)}`,
  ].filter(Boolean)
  const agenda = `Lo próximo: ${parts.join('; ')}.`

  return {
    trays,
    next,
    agenda,
    startNote:
      !everLoaded && start
        ? next
          ? `Tus números arrancan el ${formatDayMonth(start)}.`
          : `Tus números arrancan el ${formatDayMonth(start)}: todavía no hay nada atrasado.`
        : null,
    everLoaded,
  }
}

// ─── Qué fechas pedir (paso 1 de cada subida) ────────────────────────────────

export type WantedRange = {
  /** Las dos fichas «Desde / Hasta». `null` = no hay nada para pedir hoy. */
  from: string | null
  to: string | null
  sentence: string
  /** Una línea más: el tope del origen o un hueco de más atrás. */
  extra: string | null
}

/**
 * Qué fechas pedirle a ARCA, a Mercado Pago o al banco. Nunca propone una fecha
 * anterior al arranque del bar; si el tope del origen queda después, manda el tope.
 */
export function wantedRange(
  source: UiImportSource,
  batches: readonly InboxBatch[],
  today: string,
  booksStartDate: string | null,
): WantedRange {
  const start = valid(booksStartDate)
  const list = ofSource(batches, source)
  const spans = coverage(list, start)
  const yesterday = addDays(today, -1)

  if (source === 'arca_recibidos') {
    const missing = arcaMonths(today, spans, start, ARCA_BACK_MONTHS).filter(isMissing)
    const first = missing[0]
    const last = missing[missing.length - 1]
    if (first && last && missing.length > 1) {
      return {
        from: first.from,
        to: last.to,
        sentence: `Son ${joinWords(missing.map((m) => monthWord(m.month)))}. ARCA deja pedir hasta un año de una vez.`,
        extra: null,
      }
    }
    if (first) {
      const whole = first.from === startOfMonth(first.month)
      const previous = first.month === addMonthsToYearMonth(monthOf(today), -1)
      const name = monthWord(first.month)
      return {
        from: first.from,
        to: first.to,
        sentence: !whole
          ? start && first.from === start
            ? `En ARCA poné las fechas a mano, del ${formatDayMonth(first.from)} al ${formatDayMonth(first.to)}: tus números arrancan el ${formatDayMonth(start)} y lo anterior no se puede cargar.`
            : `En ARCA poné las fechas a mano, del ${formatDayMonth(first.from)} al ${formatDayMonth(first.to)}: lo anterior de ${name} ya lo subiste.`
          : previous
            ? `Es ${name} entero. En ARCA elegí «Mes Pasado».`
            : `Es ${name} entero. En ARCA poné las fechas a mano.`,
        extra: null,
      }
    }
    const next = nextArca(today, spans, start)
    const nextName = capitalizeFirst(monthWord(next.month))
    const loaded = arcaMonths(today, spans, start, ARCA_BACK_MONTHS)
      .filter((m) => m.state === 'loaded' || m.state === 'review')
      .pop()
    const ahead =
      next.from <= yesterday
        ? ` Si querés adelantar, pedí del ${formatDayMonth(next.from)} a ayer: lo repetido no se carga dos veces.`
        : ''
    return {
      from: null,
      to: null,
      sentence: `${
        loaded ? `${capitalizeFirst(monthWord(loaded.month))} ya lo subiste. ` : ''
      }${nextName} se baja desde el ${formatDayMonth(next.availableOn)}.${ahead}`,
      extra: null,
    }
  }

  const facts = weeklyFacts(source, today, spans, start)
  const limit =
    source === 'mp_release'
      ? 'Deja pedir hasta 60 días por reporte.'
      : 'Muchos bancos guardan solo 3 meses: no lo dejes pasar.'
  if (facts.since === null) {
    return {
      from: null,
      to: null,
      sentence:
        facts.windowStart > facts.yesterday
          ? start
            ? `Tus números arrancan el ${formatIsoDay(start)}: todavía no hay nada para bajar.`
            : 'Todavía no hay nada para bajar.'
          : 'Ya subiste hasta ayer: hoy no hay nada nuevo para bajar.',
      extra: null,
    }
  }
  if (facts.reason !== 'after_last') {
    return {
      from: facts.since,
      to: facts.yesterday,
      sentence:
        facts.reason === 'start' && start
          ? `Desde el ${formatIsoDay(start)}, que es cuando arrancan tus números, hasta ayer.`
          : source === 'mp_release'
            ? 'Es lo más atrás que deja pedir Mercado Pago (60 días por reporte), hasta ayer.'
            : 'Es lo más atrás que guardan muchos bancos (3 meses), hasta ayer.',
      extra: null,
    }
  }
  return {
    from: facts.since,
    to: facts.yesterday,
    sentence: `Desde el día siguiente a lo último que subiste, hasta ayer. ${limit}`,
    extra: facts.gap
      ? facts.gap.from === facts.gap.to
        ? `Si querés completar lo de antes, pedí también el ${formatDayMonth(facts.gap.from)}.`
        : `Si querés completar lo de antes, pedí también del ${formatDayMonth(facts.gap.from)} al ${formatDayMonth(facts.gap.to)}.`
      : null,
  }
}

// ─── Lo que un archivo trae de antes del arranque ────────────────────────────

const ROW_DATE_FIELD: Readonly<Record<UiImportSource, string>> = {
  arca_recibidos: 'issueDate',
  mp_release: 'businessDate',
  bank_statement: 'date',
}

/**
 * Cuántos renglones de un archivo ya leído tienen fecha anterior al arranque
 * del bar: esos no se van a poder cargar. Se cuenta en el navegador, con la
 * fecha que cada lector ya dejó en la fila; no cambia nada de lo que se manda.
 */
export function rowsBeforeStart(
  source: UiImportSource,
  rows: ReadonlyArray<{ data: unknown }>,
  booksStartDate: string | null | undefined,
): number {
  const start = valid(booksStartDate)
  if (!start) return 0
  const field = ROW_DATE_FIELD[source]
  let n = 0
  for (const row of rows) {
    const data = row.data
    if (typeof data !== 'object' || data === null) continue
    const day = (data as Record<string, unknown>)[field]
    if (typeof day === 'string' && isRealIsoDay(day) && day < start) n++
  }
  return n
}
