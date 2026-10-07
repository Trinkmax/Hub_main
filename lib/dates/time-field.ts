/**
 * Lo que hace el TimeField del kit (§3.2) con lo que se tipea, puro: la máscara
 * de 24 h, las flechas por paso, la lista de horarios y la lectura con mínimo y
 * máximo. La lectura de la hora en sí es `parseTimeInput` (`parse.ts`).
 *
 * **Servicio de noche** (`crossesMidnight`): el bar abre a las 19 y cierra a
 * las 2, así que las 00:30 van DESPUÉS de las 23:45. Para comparar y ordenar,
 * las horas anteriores al «pivote» (el mínimo, o las 5 de la mañana, cuando
 * cambia el día de servicio) se corren 24 h hacia adelante.
 */

import { minutesToTime, timeToMinutes } from './civil'
import { parseTimeInput, TIME_INPUT_MESSAGE } from './parse'
import { SERVICE_DAY_ROLLOVER_HOUR } from './zone'

const DAY_MINUTES = 24 * 60

export type TimeOrderOptions = {
  /** `HH:mm`. Con `crossesMidnight` es el pivote: lo anterior va al día siguiente. */
  min?: string | null
  crossesMidnight?: boolean
}

function pivotMinutes(opts: TimeOrderOptions): number {
  const fromMin = opts.min ? timeToMinutes(opts.min) : null
  return fromMin ?? SERVICE_DAY_ROLLOVER_HOUR * 60
}

/**
 * La posición de una hora para comparar y ordenar: minutos desde las 00:00, o
 * corridos 24 h si es servicio de noche y cae antes del pivote. `null` si no es
 * una hora válida.
 */
export function timeOrder(time: string, opts: TimeOrderOptions = {}): number | null {
  const minutes = timeToMinutes(time)
  if (minutes === null) return null
  if (opts.crossesMidnight && minutes < pivotMinutes(opts)) return minutes + DAY_MINUTES
  return minutes
}

/**
 * La máscara del campo de hora, mientras se tipea al final (borrar o editar en
 * el medio no se toca). Los dos puntos se insertan solos cuando llega el primer
 * minuto, y solo si no hay ambigüedad:
 *
 * - `2130` → `21:30` · `930` → `9:30` (un 93 no es una hora) · `245` → `2:45`.
 * - `9` y `21` quedan como están: al salir se leen como `09:00` y `21:00`.
 * - Con punto o «h» (`21.30`, `21h30`) no se toca: se lee al salir del campo.
 */
export function maskTimeTyping(next: string, previous = ''): string {
  if (next.length <= previous.length) return next
  if (!/^[\d:]*$/.test(next)) return next

  let hour = ''
  let minute = ''
  let inMinutes = false
  for (const char of next) {
    if (char === ':') {
      if (!inMinutes && hour !== '') inMinutes = true
      continue
    }
    if (!inMinutes) {
      if (hour === '') {
        hour = char
        continue
      }
      if (hour.length === 1 && hour <= '2' && Number(hour + char) <= 23) {
        hour += char
        continue
      }
      // La hora ya no admite este dígito: arranca los minutos.
      inMinutes = true
    }
    if (minute.length < 2) minute += char
  }
  return inMinutes ? `${hour}:${minute}` : hour
}

export type TimeFieldRules = TimeOrderOptions & {
  /** `HH:mm` inclusivo. */
  max?: string | null
}

export type TimeFieldCheck =
  | { status: 'empty'; time: null; error: null }
  | { status: 'valid'; time: string; error: null }
  | { status: 'invalid'; time: string | null; error: string }

/** «las 21:30», pero «la 01:00» (la una). */
function atTime(time: string): string {
  return time.startsWith('01:') ? `la ${time}` : `las ${time}`
}

export function timeMinMessage(min: string): string {
  return `Tiene que ser desde ${atTime(min)}`
}

export function timeMaxMessage(max: string): string {
  return `Tiene que ser hasta ${atTime(max)}`
}

export const TIME_FIELD_MESSAGES = {
  unreadable: TIME_INPUT_MESSAGE,
  required: 'Falta la hora.',
} as const

/**
 * Lee el texto del campo: `2130`, `930`, `9`, `21.30`, `21h30`, `21:30`. Los
 * dos puntos colgando al final (`21:`) no cuentan.
 */
export function checkTimeText(text: string, rules: TimeFieldRules = {}): TimeFieldCheck {
  const cleaned = text.trim().replace(/[:.\s]+$/, '')
  if (cleaned === '') return { status: 'empty', time: null, error: null }
  const parsed = parseTimeInput(cleaned)
  if (!parsed.ok) return { status: 'invalid', time: null, error: TIME_INPUT_MESSAGE }
  const order = timeOrder(parsed.time, rules)
  const minOrder = rules.min ? timeOrder(rules.min, rules) : null
  const maxOrder = rules.max ? timeOrder(rules.max, rules) : null
  const belowMin = order !== null && minOrder !== null && order < minOrder
  const aboveMax = order !== null && maxOrder !== null && order > maxOrder
  if (!belowMin && !aboveMax) return { status: 'valid', time: parsed.time, error: null }

  // De noche, una hora afuera de la ventana (entre el cierre y la apertura)
  // queda «después» del máximo en el orden, pero lo útil es nombrar el borde
  // más cercano: las 18:30 están a media hora de abrir, no 16 h después de cerrar.
  if (rules.crossesMidnight && rules.min && rules.max) {
    const minutes = timeToMinutes(parsed.time) ?? 0
    const untilOpening = ((timeToMinutes(rules.min) ?? 0) - minutes + DAY_MINUTES) % DAY_MINUTES
    const sinceClosing = (minutes - (timeToMinutes(rules.max) ?? 0) + DAY_MINUTES) % DAY_MINUTES
    const error =
      untilOpening <= sinceClosing ? timeMinMessage(rules.min) : timeMaxMessage(rules.max)
    return { status: 'invalid', time: parsed.time, error }
  }
  if (belowMin && rules.min) {
    return { status: 'invalid', time: parsed.time, error: timeMinMessage(rules.min) }
  }
  return {
    status: 'invalid',
    time: parsed.time,
    error: rules.max ? timeMaxMessage(rules.max) : TIME_INPUT_MESSAGE,
  }
}

export type StepTimeOptions = TimeFieldRules & {
  /** Minutos. Default 15. */
  step?: number
}

/**
 * Los bordes en «orden». Sin mínimo: las 00:00 (o el pivote, de noche). Sin
 * máximo: el último paso antes de que termine el día (de noche, el día de
 * servicio: hasta el pivote de mañana).
 */
function orderBounds(opts: StepTimeOptions, step: number): { lo: number; hi: number } {
  const dayStart = opts.crossesMidnight ? pivotMinutes(opts) : 0
  const lo = opts.min ? (timeOrder(opts.min, opts) ?? dayStart) : dayStart
  const hi = opts.max ? (timeOrder(opts.max, opts) ?? lo) : dayStart + DAY_MINUTES - step
  return { lo, hi: Math.max(lo, hi) }
}

/**
 * La hora siguiente (`direction` 1) o anterior (−1) con las flechas: de a
 * `step` minutos, alineada a la grilla del paso (21:07 sube a 21:15 y baja a
 * 21:00); con Mayús (`delta: 60`) suma o resta una hora justa (21:30 → 22:30).
 * Siempre dentro de `min` y `max`. Sin bordes da la vuelta al reloj, como el
 * `<input type="time">`. Vacío arranca en el mínimo (o las 00:00) al subir y
 * en el máximo (o el último paso) al bajar.
 */
export function stepTimeValue(
  current: string | null,
  direction: 1 | -1,
  opts: StepTimeOptions & { delta?: number } = {},
): string {
  const step = Math.max(1, Math.round(opts.step ?? 15))
  const delta = Math.max(1, Math.round(opts.delta ?? step))
  const bounded = Boolean(opts.min || opts.max)
  const { lo, hi } = orderBounds(opts, step)
  const order = current ? timeOrder(current, opts) : null

  if (order === null) return minutesToTime(direction > 0 ? lo : hi)

  let next: number
  if (delta !== step) {
    next = order + direction * delta
  } else {
    const aligned = order % step === 0
    if (direction > 0) next = aligned ? order + step : Math.ceil(order / step) * step
    else next = aligned ? order - step : Math.floor(order / step) * step
  }

  if (!bounded) return minutesToTime(next)
  return minutesToTime(Math.min(hi, Math.max(lo, next)))
}

/**
 * Los horarios de la lista: de `min` a `max` cada `step` minutos (con servicio
 * de noche, cruzando la medianoche). Sin mínimo arranca a las 00:00 (o en el
 * pivote); sin máximo, sigue hasta completar el día.
 */
export function timeSuggestions(opts: StepTimeOptions = {}): string[] {
  const step = Math.max(5, Math.round(opts.step ?? 15))
  const { lo, hi } = orderBounds(opts, step)
  const out: string[] = []
  for (let order = lo; order <= hi && out.length < DAY_MINUTES / step + 1; order += step) {
    out.push(minutesToTime(order))
  }
  return out
}

/** El horario de la lista más cercano a `time` (el igual o el siguiente), para llevarlo a la vista. */
export function nearestSuggestionIndex(
  suggestions: readonly string[],
  time: string | null,
  opts: TimeOrderOptions = {},
): number {
  if (!time || suggestions.length === 0) return -1
  const target = timeOrder(time, opts)
  if (target === null) return -1
  const index = suggestions.findIndex((s) => (timeOrder(s, opts) ?? -1) >= target)
  return index === -1 ? suggestions.length - 1 : index
}
