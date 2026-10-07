/**
 * Los cierres del día de un período (H.9, F.10 `missing_daily_close`). Puro:
 * lo usan el calendario de Ventas y la pantalla del cierre.
 *
 * - El día de servicio en curso no «falta» (antes de las 5:00 es ayer: la
 *   noche no terminó).
 * - Faltan los días desde `max(inicio de las cuentas, día de servicio − 30)`
 *   hasta el día anterior al de servicio que no tienen ningún cierre.
 */

import { addDays, eachIsoDay, maxIsoDay } from '@/lib/dates'

/** Cuántos días para atrás se buscan cierres que faltan (F.10). */
export const MISSING_WINDOW_DAYS = 30

export type DayCloses = { totalCents: number; documentIds: string[] }

/** Los cierres vigentes agrupados por día (un día puede tener varios turnos). */
export function closesByDay(
  docs: ReadonlyArray<{ id: string; accountingDate: string; totalCents: number }>,
): Map<string, DayCloses> {
  const out = new Map<string, DayCloses>()
  for (const doc of docs) {
    const prev = out.get(doc.accountingDate)
    if (prev) {
      prev.totalCents += doc.totalCents
      prev.documentIds.push(doc.id)
    } else {
      out.set(doc.accountingDate, { totalCents: doc.totalCents, documentIds: [doc.id] })
    }
  }
  return out
}

export type DayStatus =
  | { kind: 'before' }
  | { kind: 'future' }
  | { kind: 'in-progress' }
  | { kind: 'closed'; closes: DayCloses }
  | { kind: 'missing'; recent: boolean }

/** Qué pasa con un día: antes de las cuentas, cargado, en curso, futuro o falta. */
export function dayStatus(
  day: string,
  ctx: { closes: ReadonlyMap<string, DayCloses>; booksStart: string; serviceDay: string },
): DayStatus {
  const closes = ctx.closes.get(day)
  if (closes) return { kind: 'closed', closes }
  if (day < ctx.booksStart) return { kind: 'before' }
  if (day > ctx.serviceDay) return { kind: 'future' }
  if (day === ctx.serviceDay) return { kind: 'in-progress' }
  return {
    kind: 'missing',
    recent: day >= addDays(ctx.serviceDay, -MISSING_WINDOW_DAYS),
  }
}

/** Los días que faltan, del más viejo al más nuevo (los de la ventana de 30 días). */
export function missingDays(ctx: {
  closedDays: ReadonlySet<string>
  booksStart: string
  serviceDay: string
}): string[] {
  const from = maxIsoDay(ctx.booksStart, addDays(ctx.serviceDay, -MISSING_WINDOW_DAYS))
  const to = addDays(ctx.serviceDay, -1)
  if (from > to) return []
  return eachIsoDay(from, to).filter((day) => !ctx.closedDays.has(day))
}
