/**
 * Fechas en pantalla y en CSV, armadas a mano: `dd/MM/yyyy`, `dd/MM/yyyy HH:mm`
 * (hora de Córdoba), nombres de meses y días en castellano.
 *
 * Sin `Intl` ni `toLocale*`: el ICU del server y el del navegador no dan las
 * mismas cadenas («sept.» contra «sep.», mayúsculas, puntos) y eso rompe la
 * hidratación. Las fechas civiles se cortan del string (nunca
 * `new Date('yyyy-MM-dd')`, que en GMT−3 es el día anterior) y los instantes
 * pasan por `zone.ts`.
 */

import { isRealIsoDay, isRealYearMonth, weekdayOf } from './civil'
import { cordobaDateTime, type DateValue, readDateValue } from './zone'

export const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

export const MONTH_NAMES_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const

/** Indexados como `weekdayOf`: 0 = domingo. */
export const WEEKDAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const

export const WEEKDAY_NAMES_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const

/** Los encabezados del calendario («lu ma mi ju vi sá do»), indexados desde el domingo. */
export const WEEKDAY_NAMES_MIN = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'] as const

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `'septiembre'` → `'Septiembre'`. */
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `9` → `'septiembre'`. Vacío si el mes no existe. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? ''
}

/** `'2026-09-15'` → `'martes'`. Vacío si no es un día real. */
export function weekdayName(iso: string): string {
  return isRealIsoDay(iso) ? (WEEKDAY_NAMES[weekdayOf(iso)] ?? '') : ''
}

/** El mes (`yyyy-MM`) de un mes o de un día real; `null` si no es ninguno. */
function yearMonthOf(value: string): string | null {
  const ym = isRealIsoDay(value) ? value.slice(0, 7) : value
  return isRealYearMonth(ym) ? ym : null
}

/**
 * `'2026-09-15'` → `'15/09/2026'`, cortando el string: no puede correr un día.
 * Vacío si no es un `yyyy-MM-dd` (sirve igual para una celda de CSV sin dato).
 * No acepta timestamps a propósito: el día UTC de un instante no es el del bar
 * (para eso está `formatDate`).
 */
export function formatIsoDay(iso: string | null | undefined): string {
  if (!iso || !ISO_DAY_RE.test(iso)) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** `'2026-09-09'` → `'09/09'`. */
export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso || !ISO_DAY_RE.test(iso)) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/**
 * Una fecha como `dd/MM/yyyy`: un `date` civil se corta tal cual; un instante
 * (`timestamptz`, `Date`) se pasa al día de Córdoba. Vacío si no se lee.
 */
export function formatDate(value: DateValue | null | undefined): string {
  const read = readDateValue(value)
  if (!read) return ''
  if (read.kind === 'day' || read.kind === 'wall') return formatIsoDay(read.date)
  return formatIsoDay(cordobaDateTime(value)?.date)
}

/**
 * `'2026-09-10T17:32:00Z'` → `'10/09/2026 14:32'` (hora de Córdoba). Un valor
 * sin zona ya es hora de Córdoba. Un `date` civil no tiene hora: sale solo la
 * fecha, nunca un `00:00` inventado. Vacío si no se lee.
 */
export function formatDateTime(value: DateValue | null | undefined): string {
  const read = readDateValue(value)
  if (!read) return ''
  if (read.kind === 'day') return formatIsoDay(read.date)
  const parts = cordobaDateTime(value)
  return parts ? `${formatIsoDay(parts.date)} ${parts.time}` : ''
}

/** `'2026-09-10T17:32:00Z'` → `'14:32'` (hora de Córdoba). Vacío si no hay hora. */
export function formatTime(value: DateValue | null | undefined): string {
  return cordobaDateTime(value)?.time ?? ''
}

/**
 * `'2026-09-15'` → `'martes 15 de septiembre de 2026'`: la etiqueta accesible de
 * una celda del calendario. Vacío si no es un día real.
 */
export function formatLongDate(iso: string): string {
  if (!isRealIsoDay(iso)) return ''
  const day = Number(iso.slice(8, 10))
  return `${weekdayName(iso)} ${day} de ${monthName(Number(iso.slice(5, 7)))} de ${iso.slice(0, 4)}`
}

/** `'2026-09'` (o un día de ese mes) → `'septiembre de 2026'`: el título del calendario. */
export function formatMonthYear(value: string): string {
  const ym = yearMonthOf(value)
  return ym ? `${monthName(Number(ym.slice(5, 7)))} de ${ym.slice(0, 4)}` : ''
}

/** `'2026-09'` → `'Septiembre 2026'`: la etiqueta de un período mensual. */
export function formatMonthLabel(value: string): string {
  const ym = yearMonthOf(value)
  return ym ? `${capitalizeFirst(monthName(Number(ym.slice(5, 7))))} ${ym.slice(0, 4)}` : ''
}

/** `'2026-09-09'` → `'mié 09/09'`. */
export function formatWeekdayDayMonth(iso: string): string {
  if (!isRealIsoDay(iso)) return ''
  return `${WEEKDAY_NAMES_SHORT[weekdayOf(iso)] ?? ''} ${formatDayMonth(iso)}`
}

/**
 * Un rango civil, inclusivo:
 * - un solo día → `'15/09/2026'`
 * - mismo año → `'01/09 – 30/09/2026'`
 * - años distintos → `'28/12/2026 – 03/01/2027'`
 */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatIsoDay(from)
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatDayMonth(from)} – ${formatIsoDay(to)}`
  return `${formatIsoDay(from)} – ${formatIsoDay(to)}`
}
