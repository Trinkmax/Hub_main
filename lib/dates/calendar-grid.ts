/**
 * La grilla del calendario del kit (§3.2 DatePicker y PeriodPicker), pura y en
 * strings: qué días dibuja cada mes, cómo se mueve el foco con el teclado y qué
 * marca un rango. La usan `components/ui/calendar.tsx` y sus tests.
 *
 * Todo sale de la aritmética civil de `civil.ts` (sin `Date`): la grilla de un
 * mes es la misma en el server, en el navegador y en cualquier zona horaria.
 * La semana arranca el **lunes** (`weekStartsOn: 1`, como date-fns `es`): el
 * bar piensa la semana de lunes a domingo y arrancar el domingo partiría el
 * fin de semana en dos.
 */

import {
  addDays,
  addMonths,
  addMonthsToYearMonth,
  daysInMonth,
  endOfMonth,
  isRealIsoDay,
  isRealYearMonth,
  startOfMonth,
  toIsoDay,
  toYearMonth,
  weekdayOf,
} from './civil'
import { WEEKDAY_NAMES, WEEKDAY_NAMES_MIN } from './format'

/** 0 = domingo · 1 = lunes (el default del kit). */
export type WeekStart = 0 | 1

export type CalendarDay = {
  /** `yyyy-MM-dd` */
  iso: string
  /** Número del día (1–31). */
  day: number
  /** `false` para los días del mes anterior o siguiente que completan la semana. */
  inMonth: boolean
  /** 0 = domingo … 6 = sábado. */
  weekday: number
}

export type CalendarWeeksOptions = {
  /** Default 1 (lunes). */
  weekStartsOn?: WeekStart
  /**
   * Seis semanas siempre (42 días). Default `true`: el popover no cambia de alto
   * al pasar de un mes de cuatro filas a uno de seis.
   */
  fixedWeeks?: boolean
}

/** Cuántos días hay que retroceder desde `iso` hasta el primer día de su semana. */
function offsetFromWeekStart(iso: string, weekStartsOn: WeekStart): number {
  return (weekdayOf(iso) - weekStartsOn + 7) % 7
}

/**
 * Las semanas que dibuja la grilla de `month` (`yyyy-MM`, o un día de ese mes).
 * Cada semana tiene 7 días, del lunes al domingo; los de otros meses vienen con
 * `inMonth: false`.
 */
export function calendarWeeks(month: string, opts: CalendarWeeksOptions = {}): CalendarDay[][] {
  const weekStartsOn = opts.weekStartsOn ?? 1
  const first = startOfMonth(month)
  const start = addDays(first, -offsetFromWeekStart(first, weekStartsOn))
  const visibleDays = offsetFromWeekStart(first, weekStartsOn) + daysInMonthOf(month)
  const weekCount = opts.fixedWeeks === false ? Math.ceil(visibleDays / 7) : 6
  const monthPrefix = first.slice(0, 7)

  const weeks: CalendarDay[][] = []
  let cursor = start
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      week.push({
        iso: cursor,
        day: Number(cursor.slice(8, 10)),
        inMonth: cursor.slice(0, 7) === monthPrefix,
        weekday: weekdayOf(cursor),
      })
      cursor = addDays(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}

function daysInMonthOf(month: string): number {
  const ym = month.slice(0, 7)
  return daysInMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))
}

export type WeekdayHeader = {
  /** «lu», «ma»… lo que se ve en el encabezado de la columna. */
  short: string
  /** «lunes», «martes»… va en el `abbr` del `<th>` para el lector de pantalla. */
  long: string
}

/** Los encabezados de las columnas, desde el primer día de la semana: «lu ma mi ju vi sá do». */
export function weekdayHeaders(weekStartsOn: WeekStart = 1): WeekdayHeader[] {
  return Array.from({ length: 7 }, (_, i) => {
    const weekday = (weekStartsOn + i) % 7
    return { short: WEEKDAY_NAMES_MIN[weekday] ?? '', long: WEEKDAY_NAMES[weekday] ?? '' }
  })
}

/** Primer día de la semana de `iso` según `weekStartsOn`. */
export function weekStartOf(iso: string, weekStartsOn: WeekStart = 1): string {
  return addDays(iso, -offsetFromWeekStart(iso, weekStartsOn))
}

/** Último día de la semana de `iso` según `weekStartsOn`. */
export function weekEndOf(iso: string, weekStartsOn: WeekStart = 1): string {
  return addDays(weekStartOf(iso, weekStartsOn), 6)
}

/**
 * A qué día va el foco con una tecla de la grilla (kit §3.2, «Teclas»), o
 * `null` si la tecla no es de la grilla:
 *
 * | Tecla | Hace |
 * |---|---|
 * | ← → | ±1 día |
 * | ↑ ↓ | ±7 días |
 * | Inicio, Fin | inicio o fin de la semana |
 * | RePág, AvPág | ±1 mes (el día se recorta al último del mes) |
 * | Mayús + RePág, Mayús + AvPág | ±1 año |
 */
export function calendarKeyTarget(
  iso: string,
  key: string,
  opts: { shiftKey?: boolean; weekStartsOn?: WeekStart } = {},
): string | null {
  const weekStartsOn = opts.weekStartsOn ?? 1
  switch (key) {
    case 'ArrowLeft':
      return addDays(iso, -1)
    case 'ArrowRight':
      return addDays(iso, 1)
    case 'ArrowUp':
      return addDays(iso, -7)
    case 'ArrowDown':
      return addDays(iso, 7)
    case 'Home':
      return weekStartOf(iso, weekStartsOn)
    case 'End':
      return weekEndOf(iso, weekStartsOn)
    case 'PageUp':
      return addMonths(iso, opts.shiftKey ? -12 : -1)
    case 'PageDown':
      return addMonths(iso, opts.shiftKey ? 12 : 1)
    default:
      return null
  }
}

/** Recorta un día a `[min, max]` (ISO inclusivos; cualquiera de los dos puede faltar). */
export function clampIsoDay(iso: string, min?: string | null, max?: string | null): string {
  if (min && iso < min) return min
  if (max && iso > max) return max
  return iso
}

/** ¿Cae fuera de `[min, max]`? */
export function isOutsideRange(iso: string, min?: string | null, max?: string | null): boolean {
  return Boolean((min && iso < min) || (max && iso > max))
}

/**
 * El mismo día en otro mes, recortado al último día de ese mes y a `[min,
 * max]`: es a dónde va el foco cuando se cambia de mes con los botones.
 */
export function sameDayInMonth(
  iso: string,
  month: string,
  bounds: { min?: string | null; max?: string | null } = {},
): string {
  const ym = month.slice(0, 7)
  const year = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  const day = Math.min(Number(iso.slice(8, 10)) || 1, daysInMonth(year, m))
  return clampIsoDay(toIsoDay(year, m, day), bounds.min, bounds.max)
}

/** ¿Tiene `month` algún día adentro de `[min, max]`? Sirve para apagar «Mes anterior»/«Mes siguiente». */
export function monthHasDaysInRange(
  month: string,
  min?: string | null,
  max?: string | null,
): boolean {
  const from = startOfMonth(month)
  const to = endOfMonth(month)
  return !((max && from > max) || (min && to < min))
}

/** Los meses que se ven a la vez: `month` y los siguientes (`count` 1 o 2). */
export function visibleMonths(month: string, count: number): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) =>
    addMonthsToYearMonth(month.slice(0, 7), i),
  )
}

// ─── Grilla de meses (PeriodPicker) ──────────────────────────────────────────

/** Los 12 meses de `year` como `yyyy-MM`, para la grilla de 4 × 3. */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => toYearMonth(year, i + 1))
}

/**
 * A qué mes va el foco en la grilla de meses (4 columnas por defecto): ← → ±1,
 * ↑ ↓ ±una fila, Inicio y Fin a enero y diciembre, RePág y AvPág ±1 año.
 */
export function monthGridKeyTarget(
  month: string,
  key: string,
  opts: { columns?: number } = {},
): string | null {
  const columns = opts.columns ?? 4
  const ym = month.slice(0, 7)
  const year = Number(ym.slice(0, 4))
  switch (key) {
    case 'ArrowLeft':
      return addMonthsToYearMonth(ym, -1)
    case 'ArrowRight':
      return addMonthsToYearMonth(ym, 1)
    case 'ArrowUp':
      return addMonthsToYearMonth(ym, -columns)
    case 'ArrowDown':
      return addMonthsToYearMonth(ym, columns)
    case 'Home':
      return toYearMonth(year, 1)
    case 'End':
      return toYearMonth(year, 12)
    case 'PageUp':
      return addMonthsToYearMonth(ym, -12)
    case 'PageDown':
      return addMonthsToYearMonth(ym, 12)
    default:
      return null
  }
}

// ─── Rangos ──────────────────────────────────────────────────────────────────

export type RangeDraft = { from: string | null; to: string | null }

/**
 * Elegir un rango con dos toques: el primero lo arranca, el segundo lo cierra
 * (si va para atrás, se dan vuelta los bordes) y un tercero arranca uno nuevo.
 */
export function nextRangeDraft(draft: RangeDraft, iso: string): RangeDraft {
  if (!draft.from || draft.to) return { from: iso, to: null }
  return iso < draft.from ? { from: iso, to: draft.from } : { from: draft.from, to: iso }
}

export type RangeDayState = 'single' | 'start' | 'end' | 'inside' | null

/**
 * Dónde cae `iso` respecto de un rango. Con el rango a medio elegir, `preview`
 * (el día bajo el mouse o el foco) hace de segundo borde.
 */
export function rangeDayState(
  iso: string,
  draft: RangeDraft,
  preview?: string | null,
): RangeDayState {
  const { from } = draft
  if (!from) return null
  const otherEnd = draft.to ?? preview ?? null
  if (!otherEnd) return iso === from ? 'single' : null
  const start = otherEnd < from ? otherEnd : from
  const end = otherEnd < from ? from : otherEnd
  if (start === end) return iso === start ? 'single' : null
  if (iso === start) return 'start'
  if (iso === end) return 'end'
  return iso > start && iso < end ? 'inside' : null
}

/** ¿Es un `yyyy-MM-dd` o un `yyyy-MM` que existe? Para validar props de la grilla. */
export function isCalendarValue(value: unknown): value is string {
  return isRealIsoDay(value) || isRealYearMonth(value)
}
