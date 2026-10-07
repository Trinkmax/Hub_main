import { isRealIsoDay } from '@/lib/dates/civil'
import { capitalizeFirst, formatWeekdayDayMonth, monthName, weekdayName } from '@/lib/dates/format'

/**
 * Las etiquetas de día de la agenda (lista de reservas y calendario), armadas a
 * mano con `lib/dates` y sin `Intl`: el ICU del server y el del navegador no
 * dan las mismas cadenas («sáb.» contra «sáb») y eso rompía la hidratación.
 * Las fechas son civiles (`yyyy-MM-dd`), así que no hay zona horaria que
 * corra un día.
 */

/**
 * `'2026-07-31'` → `'Vie 31/07'`: encabezados de día y barras de rango. Es
 * `formatDayLabel` de `lib/dates` (la misma del tablero de señas y del contador
 * del día), con el nombre que ya usa la agenda.
 */
export { formatDayLabel as dayLabel } from '@/lib/dates/format'

/** `'2026-07-31'` → `'vie 31/07'`: para meterlo en una frase («Almuerzo del vie 31/07»). */
export function dayLabelInline(iso: string): string {
  return formatWeekdayDayMonth(iso)
}

/** `'2026-09-10'` → `'jueves 10 de septiembre'`: los aria-label (la celda solo muestra el número). */
export function longDayLabel(iso: string): string {
  if (!isRealIsoDay(iso)) return iso
  return `${weekdayName(iso)} ${Number(iso.slice(8, 10))} de ${monthName(Number(iso.slice(5, 7)))}`
}

/** `'2026-09-10'` → `'Jueves 10 de septiembre'`: el título de la vista del día. */
export function longDayTitle(iso: string): string {
  return capitalizeFirst(longDayLabel(iso))
}
