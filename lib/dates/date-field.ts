/**
 * Lo que hace el DatePicker del kit (§3.2) con lo que se tipea, puro: la
 * máscara que pone las barras sola, la lectura con mínimo, máximo y días
 * deshabilitados, y los mensajes. La lectura de la fecha en sí es
 * `parseDateInput` (`parse.ts`): acá se la envuelve con las reglas del campo.
 */

import { formatIsoDay } from './format'
import { DATE_INPUT_MESSAGES, parseDateInput } from './parse'

/**
 * Dígitos máximos de cada parte mientras se tipea. El día que empieza en 4–9 y
 * el mes que empieza en 2–9 tienen una sola cifra: así `4` + `9` da `4/9` y
 * `15/9` + `2` da `15/9/2` (el año), en vez de un mes 92 que no existe.
 */
function segmentMax(index: number, segment: string): number {
  if (index >= 2) return 4
  const first = segment[0]
  if (first === undefined) return 2
  if (index === 0) return first >= '4' ? 1 : 2
  return first >= '2' ? 1 : 2
}

/**
 * La máscara del campo de fecha. Se llama en cada cambio con lo nuevo y lo
 * anterior, y solo si el cursor está al final (editar en el medio no se toca):
 *
 * - **Las barras se insertan solas** cuando llega el dígito que ya no entra:
 *   `1509` → `15/09`, `15092026` → `15/09/2026`. Una barra tipeada a mano se
 *   respeta (`1/9`), y una de más se ignora (`15//`).
 * - El punto y la coma valen como barra (`15.9`, `15,9`): el teclado decimal
 *   del celular trae coma y no barra.
 * - Con guiones no se toca nada: es un `2026-09-15` o un `15-09-2026` pegado,
 *   que se lee tal cual al salir.
 * - Borrar nunca se reescribe (si no, la barra volvería a aparecer).
 */
export function maskDateTyping(next: string, previous = ''): string {
  const text = next.replace(/[.,]/g, '/')
  if (text.length <= previous.length) return text
  if (!/^[\d/]*$/.test(text)) return text

  const segments: string[] = ['']
  for (const char of text) {
    const index = segments.length - 1
    const segment = segments[index] ?? ''
    if (char === '/') {
      if (segment !== '' && segments.length < 3) segments.push('')
      continue
    }
    if (segment.length >= segmentMax(index, segment)) {
      // El año ya está completo: lo que sobra se descarta.
      if (segments.length < 3) segments.push(char)
      continue
    }
    segments[index] = segment + char
  }
  return segments.join('/')
}

export type DateFieldRules = {
  /** `yyyy-MM-dd` de hoy en Córdoba (completa el año de `15/9`). */
  today?: string
  /** ISO inclusivo. */
  min?: string | null
  /** ISO inclusivo. */
  max?: string | null
  isDateDisabled?: (iso: string) => boolean
  /** El motivo de un día deshabilitado, tal cual: «Septiembre está cerrado…». */
  disabledReason?: (iso: string) => string | null
}

export type DateFieldCheck =
  /** Vacío: no es un error (lo obligatorio lo dice `required`). */
  | { status: 'empty'; iso: null; error: null }
  | { status: 'valid'; iso: string; error: null }
  /**
   * No se puede usar. `iso` viene si el texto es una fecha que existe pero
   * queda afuera (antes del mínimo, después del máximo, deshabilitada): el
   * calendario la puede mostrar, el formulario no la manda.
   */
  | { status: 'invalid'; iso: string | null; error: string }

export const DATE_FIELD_MESSAGES = {
  disabled: 'Ese día no se puede elegir.',
  required: DATE_INPUT_MESSAGES.vacio,
} as const

/** `01/09/2026` → «Tiene que ser desde el 01/09/2026». */
export function dateMinMessage(min: string): string {
  return `Tiene que ser desde el ${formatIsoDay(min)}`
}

/** «Tiene que ser hasta el 30/09/2026». */
export function dateMaxMessage(max: string): string {
  return `Tiene que ser hasta el ${formatIsoDay(max)}`
}

/**
 * Lee el texto del campo con las reglas del DatePicker. Las barras o puntos que
 * quedan colgando al final (`15/9/`) no cuentan: es alguien que dejó de tipear.
 */
export function checkDateText(text: string, rules: DateFieldRules = {}): DateFieldCheck {
  const cleaned = text.trim().replace(/[/.\-\s]+$/, '')
  if (cleaned === '') return { status: 'empty', iso: null, error: null }
  const parsed = parseDateInput(cleaned, rules.today ? { today: rules.today } : {})
  if (!parsed.ok) {
    return { status: 'invalid', iso: null, error: DATE_INPUT_MESSAGES[parsed.reason] }
  }
  return checkIsoDay(parsed.iso, rules)
}

/** Las reglas de mínimo, máximo y días deshabilitados sobre una fecha ya leída. */
export function checkIsoDay(iso: string, rules: DateFieldRules = {}): DateFieldCheck {
  if (rules.min && iso < rules.min) {
    return { status: 'invalid', iso, error: dateMinMessage(rules.min) }
  }
  if (rules.max && iso > rules.max) {
    return { status: 'invalid', iso, error: dateMaxMessage(rules.max) }
  }
  if (rules.isDateDisabled?.(iso)) {
    return {
      status: 'invalid',
      iso,
      error: rules.disabledReason?.(iso) ?? DATE_FIELD_MESSAGES.disabled,
    }
  }
  return { status: 'valid', iso, error: null }
}

/** ¿Se puede elegir este día en la grilla? Mismas reglas que el texto. */
export function isSelectableDay(iso: string, rules: DateFieldRules = {}): boolean {
  return checkIsoDay(iso, rules).status === 'valid'
}
