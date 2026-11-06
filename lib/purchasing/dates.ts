/**
 * Fechas de Compras, en días civiles de Córdoba (`yyyy-MM-dd`). Puro.
 */
import { addDays, formatDayMonth, WEEKDAY_NAMES, WEEKDAY_NAMES_SHORT, weekdayOf } from '@/lib/dates'

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

/**
 * Hasta qué día tienen que alcanzar los eventos de un conteo: el día anterior al próximo conteo (el de
 * lunes cubre hasta el martes si se vuelve a contar el miércoles). Sin días de conteo, una semana.
 */
export function defaultEventsUntil(countDate: string, countWeekdays: readonly number[]): string {
  if (!countWeekdays.length) return addDays(countDate, 6)
  for (let i = 1; i <= 7; i++) {
    const day = addDays(countDate, i)
    if (countWeekdays.includes(weekdayOf(day))) return addDays(day, -1)
  }
  return addDays(countDate, 6)
}

/** «hoy», «mañana» o «jue 29/10». */
export function relativeDayLabel(date: string, today: string): string {
  if (date === today) return 'hoy'
  if (date === addDays(today, 1)) return 'mañana'
  return `${WEEKDAY_NAMES_SHORT[weekdayOf(date)] ?? ''} ${formatDayMonth(date)}`
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
