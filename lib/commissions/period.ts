/**
 * Período de liquidación de comisiones (puro: sin DB, sin React).
 *
 * El dueño le paga a la gestora "del 15 al 15", pero el ciclo se le mueve: si
 * ya liquidó del 15/08 al 15/09 y después necesita ver del 1 al 15 de
 * septiembre, ningún ciclo fijo se lo da. Por eso el período es un rango libre
 * (`?from=&to=`) y esta función es el ÚNICO lugar donde se decide qué rango se
 * está mirando — la liquidación, el detalle del gestor y "Mis números" la
 * comparten para no divergir nunca en los bordes.
 *
 * Todo viaja como `yyyy-MM-dd`, que es el tipo real de
 * `salon_reservations.reservation_date` (`date`, sin hora) y se compara como
 * string, sin conversión de zona. La aritmética va sobre `Date.UTC` a propósito:
 * las funciones locales de `Date` operan sobre el TZ del runtime y un rango
 * calculado en Vercel (UTC) podía correrse un día respecto del navegador.
 */

import { isRealIsoDay } from '@/lib/salon/date-presets'

export type CommissionPeriod = {
  /** `yyyy-MM-dd` inclusive. */
  from: string
  /** `yyyy-MM-dd` inclusive. */
  to: string
  /** Texto es-AR listo para el header, ya armado a mano (ver `periodLabel`). */
  label: string
  /** Días que abarca el período, inclusive de los dos bordes. */
  days: number
}

/**
 * Tope duro del rango. 400 días = poco más de un año: cubre cualquier
 * liquidación atrasada real y frena un `?from=1900-01-01` (tipeado a mano o
 * pegado mal) que le pediría al Postgres el ledger entero para dibujar una
 * torta. Al recortar lo decimos en el label: un total silenciosamente parcial
 * sería plata mal contada.
 */
export const MAX_COMMISSION_PERIOD_DAYS = 400

const MS_PER_DAY = 86_400_000

/**
 * Nombres armados a mano en vez de `Intl`: el label se renderiza en el server
 * (Node, ICU full) y se re-hidrata en el browser, y las diferencias de ICU
 * entre los dos ("septiembre" vs "sept.") disparan un mismatch de hidratación.
 */
const MONTHS = [
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

/** Índice = `getUTCDay()`: 0 domingo … 6 sábado. */
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function parseIsoDay(iso: string): Date {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  return new Date(Date.UTC(y, m - 1, d))
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, delta: number): string {
  const d = parseIsoDay(iso)
  return toIsoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta)))
}

/** Días del rango, inclusive de los dos bordes (`from === to` → 1). */
function dayCount(from: string, to: string): number {
  return Math.round((parseIsoDay(to).getTime() - parseIsoDay(from).getTime()) / MS_PER_DAY) + 1
}

/** Primer y último día del mes que contiene a `iso`. */
function monthBoundsOf(iso: string): { from: string; to: string } {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  // Día 0 del mes siguiente = último día de este mes (resuelve febrero y bisiestos).
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${pad2(month)}-01`, to: `${year}-${pad2(month)}-${pad2(last)}` }
}

/** `yyyy-MM-dd` válido de verdad, o `null`. `2026-02-31` cae acá. */
function normalizeDay(value: string | undefined): string | null {
  if (!value) return null
  return isRealIsoDay(value) ? value : null
}

/**
 * `?month=YYYY-MM` legacy → día 1 de ese mes. Reusa `isRealIsoDay` para no
 * duplicar la validación de año/mes (`2026-13` se cae solo).
 */
function normalizeMonth(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null
  const firstDay = `${value}-01`
  return isRealIsoDay(firstDay) ? firstDay : null
}

/**
 * `yyyy-MM-dd` → `dd/MM/yyyy` (formato de la casa). Sin `Intl`, sin `Date`:
 * cortar el string no puede correr un día.
 */
function formatDdMmYyyy(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/**
 * Cómo se lee el período arriba de la liquidación:
 *   - un solo día            → `martes 15/09/2026`
 *   - mismo mes y año        → `1 al 15 de septiembre de 2026`
 *   - meses distintos        → `15/08/2026 → 15/09/2026`
 *
 * El caso del medio es el que más se usa (el dueño piensa "del 1 al 15") y es
 * el que más se agradece leer en castellano; cuando el rango cruza de mes,
 * escribirlo en palabras se vuelve largo y confuso, así que van las dos fechas.
 */
export function periodLabel(from: string, to: string): string {
  if (from === to) {
    const weekday = WEEKDAYS[parseIsoDay(from).getUTCDay()] ?? ''
    return `${weekday} ${formatDdMmYyyy(from)}`
  }
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  if (sameMonth) {
    const month = MONTHS[Number(from.slice(5, 7)) - 1] ?? ''
    // Sin cero a la izquierda: "1 al 15", no "01 al 15".
    const dayFrom = Number(from.slice(8, 10))
    const dayTo = Number(to.slice(8, 10))
    return `${dayFrom} al ${dayTo} de ${month} de ${from.slice(0, 4)}`
  }
  return `${formatDdMmYyyy(from)} → ${formatDdMmYyyy(to)}`
}

/**
 * Qué rango hay que mostrar, dado lo que vino en la URL.
 *
 * Orden de decisión (el primero que aplica gana):
 *   1. `from` y `to` válidos → mandan tal cual. Si vienen al revés se dan
 *      vuelta en vez de devolver vacío: el dueño va a tipear mal alguna vez y
 *      una pantalla en cero se lee como "no hay comisiones", que es mentira.
 *   2. Uno solo de los dos → el otro completa el MES de ese día. Elegir "un
 *      día" arranca mostrando el mes al que pertenece, que es lo que espera
 *      quien todavía no terminó de elegir el rango.
 *   3. `?month=YYYY-MM` → mes completo. Es el formato viejo de esta pantalla:
 *      los bookmarks y los links que ya circulan tienen que seguir abriendo.
 *   4. Nada → el mes en curso según `today` (que viene de `todayInCordoba()`,
 *      el calendario del bar; no `new Date()` del server, que en UTC ya cambió
 *      de día mientras en Córdoba son las 21:30).
 * Y al final, siempre, el tope de `MAX_COMMISSION_PERIOD_DAYS`.
 */
export function resolveCommissionPeriod(
  input: { from?: string; to?: string; month?: string },
  today: string,
): CommissionPeriod {
  // `today` llega de `todayInCordoba()` y siempre es real; el fallback es solo
  // para no reventar si alguien la llama con basura.
  const anchor = normalizeDay(today) ?? new Date().toISOString().slice(0, 10)
  const rawFrom = normalizeDay(input.from)
  const rawTo = normalizeDay(input.to)

  const onlyOne = rawFrom ?? rawTo

  let from: string
  let to: string
  if (rawFrom && rawTo) {
    // Dados vuelta: se ordenan (comparación de strings = comparación de fechas
    // en `yyyy-MM-dd`).
    from = rawFrom <= rawTo ? rawFrom : rawTo
    to = rawFrom <= rawTo ? rawTo : rawFrom
  } else if (onlyOne) {
    const bounds = monthBoundsOf(onlyOne)
    from = rawFrom ?? bounds.from
    to = rawTo ?? bounds.to
  } else {
    const bounds = monthBoundsOf(normalizeMonth(input.month) ?? anchor)
    from = bounds.from
    to = bounds.to
  }

  const days = dayCount(from, to)
  if (days > MAX_COMMISSION_PERIOD_DAYS) {
    const clampedTo = addDays(from, MAX_COMMISSION_PERIOD_DAYS - 1)
    return {
      from,
      to: clampedTo,
      days: MAX_COMMISSION_PERIOD_DAYS,
      label: `${periodLabel(from, clampedTo)} (recortado a ${MAX_COMMISSION_PERIOD_DAYS} días)`,
    }
  }

  return { from, to, days, label: periodLabel(from, to) }
}

/**
 * Corre el rango su propio largo, hacia atrás (`-1`) o hacia adelante (`+1`),
 * sin huecos ni solapes: del 1–15 se pasa al 16–30, y del 15/08–15/09 al
 * 16/09–16/10. Es lo que necesita un "período anterior" cuando el ciclo no es
 * un mes calendario y por lo tanto no se puede restar "un mes".
 */
export function shiftPeriod(
  period: { from: string; to: string },
  direction: -1 | 1,
): { from: string; to: string } {
  const length = dayCount(period.from, period.to)
  if (direction === 1) {
    const from = addDays(period.to, 1)
    return { from, to: addDays(from, length - 1) }
  }
  const to = addDays(period.from, -1)
  return { from: addDays(to, -(length - 1)), to }
}
