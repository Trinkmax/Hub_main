/**
 * Lo que se tipea en un campo de fecha o de hora (kit §3.2, DatePicker y
 * TimeField), leído a valores canónicos: `'yyyy-MM-dd'` y `'HH:mm'`, los mismos
 * que mandan `<input type="date">` y `<input type="time">`, así las acciones no
 * cambian. Puro y sin `Intl`.
 */

import { isRealIsoDay, toIsoDay } from './civil'
import { todayInCordoba } from './zone'

export type DateInputReason = 'vacio' | 'ilegible' | 'inexistente'

export type DateInputParse = { ok: true; iso: string } | { ok: false; reason: DateInputReason }

export const DATE_INPUT_MESSAGES: Readonly<Record<DateInputReason, string>> = {
  vacio: 'Falta la fecha.',
  ilegible: 'Escribí la fecha como dd/mm/aaaa.',
  inexistente: 'Esa fecha no existe',
}

/**
 * Un año de dos cifras: `26` → 2026. Para que un cumpleaños tipeado `15/9/85`
 * no termine en 2085, lo que caería más de 20 años en el futuro va al siglo
 * pasado (`85` → 1985 en 2026).
 */
function expandYear(twoDigits: number, todayYear: number): number {
  const candidate = 2000 + twoDigits
  return candidate <= todayYear + 20 ? candidate : 1900 + twoDigits
}

/**
 * `15/09/2026`, `15/9`, `15/9/26`, `15-09-2026`, `15.09.2026`, `2026-09-15` o
 * los dígitos que deja la máscara (`15092026`) → `'2026-09-15'`. Sin año, el
 * de hoy en Córdoba (`today`, default `todayInCordoba()`).
 */
export function parseDateInput(text: string, opts: { today?: string } = {}): DateInputParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'vacio' }
  const today = opts.today ?? todayInCordoba()
  const todayYear = Number(today.slice(0, 4))

  let year: number
  let month: number
  let day: number

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  const dmy = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(trimmed)
  const digits = /^\d+$/.test(trimmed) ? trimmed : null

  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (dmy) {
    day = Number(dmy[1])
    month = Number(dmy[2])
    const y = dmy[3]
    year =
      y === undefined ? todayYear : y.length === 2 ? expandYear(Number(y), todayYear) : Number(y)
  } else if (digits && (digits.length === 4 || digits.length === 6 || digits.length === 8)) {
    day = Number(digits.slice(0, 2))
    month = Number(digits.slice(2, 4))
    const y = digits.slice(4)
    year = y === '' ? todayYear : y.length === 2 ? expandYear(Number(y), todayYear) : Number(y)
  } else {
    return { ok: false, reason: 'ilegible' }
  }

  const result = toIsoDay(year, month, day)
  return isRealIsoDay(result) ? { ok: true, iso: result } : { ok: false, reason: 'inexistente' }
}

export type TimeInputParse =
  | { ok: true; time: string }
  | { ok: false; reason: 'vacio' | 'ilegible' }

export const TIME_INPUT_MESSAGE = 'Usá formato 24 h, por ejemplo 21:30'

function toTime(hours: number, minutes: number): TimeInputParse {
  if (hours > 23 || minutes > 59) return { ok: false, reason: 'ilegible' }
  return {
    ok: true,
    time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  }
}

/**
 * 24 h siempre: `2130` → `21:30` · `930` → `09:30` · `9` → `09:00` ·
 * `21.30` y `21h30` → `21:30` · `21hs` → `21:00` · `21:30:00` (Postgres) → `21:30`.
 */
export function parseTimeInput(text: string): TimeInputParse {
  const t = text.trim().toLowerCase()
  if (t === '') return { ok: false, reason: 'vacio' }
  const separated = /^(\d{1,2})\s*[:.h]\s*(\d{2})(?::\d{2})?\s*(?:hs?\.?)?$/.exec(t)
  if (separated) return toTime(Number(separated[1]), Number(separated[2]))
  const hoursOnly = /^(\d{1,2})\s*(?:hs?\.?)?$/.exec(t)
  if (hoursOnly) return toTime(Number(hoursOnly[1]), 0)
  const compact = /^(\d{1,2})(\d{2})$/.exec(t)
  if (compact) return toTime(Number(compact[1]), Number(compact[2]))
  return { ok: false, reason: 'ilegible' }
}
