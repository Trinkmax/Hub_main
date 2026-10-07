/**
 * Período cerrado (kit §5.7; relevamiento: «una vez cerrado, ese mes no se
 * toca; las correcciones van con un asiento de ajuste»). Lo que necesitan los
 * campos de fecha de Administración para no dejar elegir un mes cerrado y
 * decir por qué. Puro, con tests.
 *
 * ```tsx
 * const closed = closedMonthGuard(closedMonths) // ['2026-08', '2026-09']
 * <DatePicker name="date" isDateDisabled={closed.isDateDisabled} disabledReason={closed.disabledReason} />
 * <PeriodPicker param="periodo" closedMonths={closedMonths} />
 * ```
 *
 * Las funciones viven en el componente cliente que arma el formulario (una
 * función no cruza de un Server Component a uno cliente): la página pasa la
 * lista de meses y el formulario llama a `closedMonthGuard`.
 */

import { capitalizeFirst, monthName } from '@/lib/dates/format'

/** `'2026-09'` o `'2026-09-01'` → `'2026-09'`; `null` si no es un mes. */
export function monthKey(value: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value.trim())
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null
}

/** «Septiembre está cerrado: la corrección va con un asiento de ajuste.» */
export function closedMonthReason(month: string): string {
  const key = monthKey(month)
  const name = key ? capitalizeFirst(monthName(Number(key.slice(5, 7)))) : 'Ese mes'
  return `${name} está cerrado: la corrección va con un asiento de ajuste.`
}

export type ClosedMonthGuard = {
  isClosed: (isoDay: string) => boolean
  /** Para `DatePicker isDateDisabled`. */
  isDateDisabled: (isoDay: string) => boolean
  /** Para `DatePicker disabledReason`: el motivo de un día de un mes cerrado, o `null`. */
  disabledReason: (isoDay: string) => string | null
}

/** Los meses cerrados (`'yyyy-MM'` o `'yyyy-MM-01'`) como guardas para los campos de fecha. */
export function closedMonthGuard(closedMonths: readonly string[]): ClosedMonthGuard {
  const closed = new Set(closedMonths.map(monthKey).filter((key): key is string => key !== null))
  const isClosed = (isoDay: string) => {
    const key = monthKey(isoDay)
    return key !== null && closed.has(key)
  }
  return {
    isClosed,
    isDateDisabled: isClosed,
    disabledReason: (isoDay) => (isClosed(isoDay) ? closedMonthReason(isoDay) : null),
  }
}
