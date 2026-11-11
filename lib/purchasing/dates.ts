/**
 * Fechas de Compras, en días civiles de Córdoba (`yyyy-MM-dd`). Puro.
 */
import {
  addDays,
  daysBetween,
  formatDayMonth,
  WEEKDAY_NAMES,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'

/**
 * El primer día de entrega del proveedor desde `today + leadDays` (lo que se pide hoy llega, como
 * pronto, mañana). Sin días cargados no hay fecha: el WhatsApp le pregunta cuándo puede.
 */
export function nextDeliveryDate(
  today: string,
  weekdays: readonly number[],
  leadDays = 1,
): string | null {
  if (!weekdays.length) return null
  const start = addDays(today, Math.max(0, leadDays))
  for (let i = 0; i < 14; i++) {
    const day = addDays(start, i)
    if (weekdays.includes(weekdayOf(day))) return day
  }
  return null
}

/**
 * La entrega que va en el WhatsApp: la del borrador si todavía está por delante; si quedó vieja (el
 * borrador esperó unos días), la próxima del proveedor. El panel y el servidor usan esta misma cuenta, así
 * el mensaje que se abre es el que queda guardado.
 */
export function effectiveDeliveryDate(
  draftDate: string | null,
  supplier: { deliveryWeekdays: readonly number[]; leadDays: number } | null,
  today: string,
): string | null {
  const earliest = addDays(today, supplier && supplier.leadDays > 0 ? 1 : 0)
  if (draftDate && draftDate >= earliest) return draftDate
  return supplier ? nextDeliveryDate(today, supplier.deliveryWeekdays, supplier.leadDays) : null
}

/** Lo que decide qué eventos entran en cada conteo (los Ajustes de Compras). */
export type CountSchedule = {
  /** 0 = domingo … 6 = sábado. */
  countWeekdays: readonly number[]
  /** Por día de conteo, cuántos días después termina su ventana de eventos (domingo → 4 = el jueves). */
  countWindows: Readonly<Record<number, number>>
  /** La mercadería tiene que llegar estos días antes del evento. */
  arriveDaysBefore: number
}

/** El próximo día de conteo después de `day` (sin contar ese día). `null` sin días de conteo. */
export function nextCountDate(day: string, countWeekdays: readonly number[]): string | null {
  for (let i = 1; i <= 7; i++) {
    const next = addDays(day, i)
    if (countWeekdays.includes(weekdayOf(next))) return next
  }
  return null
}

/**
 * Hasta qué día tienen que alcanzar los eventos de un conteo hecho ese día. La ventana que fijó quien compra
 * para ese día de la semana («el del domingo, hasta el jueves») o, si no hay, hasta el día antes de que el
 * próximo conteo pueda traer la mercadería a tiempo: con 2 días antes, el del domingo cubre hasta el jueves si
 * se vuelve a contar el miércoles. Sin días de conteo, una semana.
 */
export function defaultEventsUntil(countDate: string, schedule: CountSchedule): string {
  const fixed = schedule.countWindows[weekdayOf(countDate)]
  if (fixed != null) return addDays(countDate, fixed)
  const next = nextCountDate(countDate, schedule.countWeekdays)
  if (!next) return addDays(countDate, 6)
  const until = addDays(next, schedule.arriveDaysBefore - 1)
  return until < countDate ? countDate : until
}

/** Un día cualquiera con ese día de la semana (el domingo 08/11/2026 + n), para cuentas por día de la semana. */
function sampleDay(weekday: number): string {
  return addDays('2026-11-08', ((weekday % 7) + 7) % 7)
}

/** Cuántos días después del conteo termina su ventana, para un día de conteo de la semana. */
export function countWindowDays(weekday: number, schedule: CountSchedule): number {
  const day = sampleDay(weekday)
  return daysBetween(day, defaultEventsUntil(day, schedule))
}

/**
 * «Los domingos cubre los eventos hasta el jueves; los miércoles, hasta el lunes.» De domingo a sábado, como
 * arranca la semana de conteos. Vacío sin días de conteo.
 */
export function countWindowsText(schedule: CountSchedule): string {
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => schedule.countWeekdays.includes(d))
  const parts = days.map((d, i) => {
    const until = WEEKDAY_NAMES[(d + countWindowDays(d, schedule)) % 7] ?? ''
    const plural = d === 6 || d === 0 ? `los ${WEEKDAY_NAMES[d]}s` : `los ${WEEKDAY_NAMES[d]}`
    return i === 0
      ? `${plural} cubre los eventos hasta el ${until}`
      : `${plural}, hasta el ${until}`
  })
  if (!parts.length) return ''
  const text = parts.join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/**
 * El último día de entrega del proveedor que no pasa de `day`. `null` sin días de entrega (no se sabe).
 */
export function latestDeliveryOnOrBefore(day: string, weekdays: readonly number[]): string | null {
  for (let i = 0; i < 7; i++) {
    const candidate = addDays(day, -i)
    if (weekdays.includes(weekdayOf(candidate))) return candidate
  }
  return null
}

/** «hoy», «mañana» o «jue 29/10». */
export function relativeDayLabel(date: string, today: string): string {
  if (date === today) return 'hoy'
  if (date === addDays(today, 1)) return 'mañana'
  return `${WEEKDAY_NAMES_SHORT[weekdayOf(date)] ?? ''} ${formatDayMonth(date)}`
}

/** «hoy», «mañana» o «el jue 29/10»: para «hasta …» y «llega …». */
export function onDayLabel(date: string, today: string): string {
  const label = relativeDayLabel(date, today)
  return label === 'hoy' || label === 'mañana' ? label : `el ${label}`
}

/** «miércoles 28/10»: la fecha del WhatsApp. */
export function longDayLabel(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date)] ?? ''} ${formatDayMonth(date)}`
}

/** «lunes y miércoles», «lunes, miércoles y viernes». Vacío si no hay. */
export function weekdaysText(weekdays: readonly number[]): string {
  const sorted = [...new Set(weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  const names = sorted.map((d) => WEEKDAY_NAMES[d] ?? '').filter(Boolean)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** Los días de la semana en el orden en que se leen en Argentina (de lunes a domingo). */
export const WEEKDAYS_MONDAY_FIRST: readonly number[] = [1, 2, 3, 4, 5, 6, 0]
