import {
  formatMonthLabel,
  formatRange,
  isRealIsoDay,
  isRealYearMonth,
  maxIsoDay,
  periodErrorMessage,
  resolvePeriod,
  startOfMonth,
} from '@/lib/dates'
import { NBSP } from '@/lib/money'
import { dayField, money, monthField } from '../types'

/**
 * Lo que comparten las herramientas de mirar. Puro: lo prueba `tex-read-common.test.ts`.
 *
 * Cada tipo de dato se dice siempre igual: el período sale de `resolvePeriod` (el mismo de las
 * pantallas), la plata de `money` y las fechas de `dayText`.
 */

/** Tope de un período: lo mismo que aceptan las pantallas y los exportes. */
const MAX_PERIOD_DAYS = 400

/** Los parámetros del período, en una sola forma para todas las herramientas. */
export const periodFields = {
  mes: monthField('Mes yyyy-MM. Sin período, el mes en curso.').optional(),
  desde: dayField('Desde, yyyy-MM-dd.').optional(),
  hasta: dayField('Hasta, yyyy-MM-dd.').optional(),
}

export type PeriodInput = { mes?: string; desde?: string; hasta?: string }

export type TexPeriod =
  | {
      ok: true
      from: string
      to: string
      /** `yyyy-MM` si se pidió un mes entero. */
      month: string | null
      /** «Octubre 2026» · «01/10 – 15/10/2026». */
      label: string
    }
  | { ok: false; message: string }

/**
 * El período que pide Tex; sin nada, el mes en curso. Con una sola punta se completa la otra (como
 * lo dice la gente: «desde el 15»), y lo que no es una fecha real vuelve con su mensaje.
 */
export function texPeriod(input: PeriodInput, today: string): TexPeriod {
  // Lo que no es una fecha real se deja pasar tal cual: `resolvePeriod` dice que no existe.
  const desde =
    input.desde ??
    (input.hasta ? (isRealIsoDay(input.hasta) ? startOfMonth(input.hasta) : input.hasta) : null)
  const hasta =
    input.hasta ??
    (input.desde ? (isRealIsoDay(input.desde) ? maxIsoDay(input.desde, today) : input.desde) : null)
  const resolved = resolvePeriod(
    { mes: input.mes, desde, hasta },
    { today, maxDays: MAX_PERIOD_DAYS },
  )
  if (!resolved.ok) {
    return {
      ok: false,
      message: periodErrorMessage(resolved.error, { maxDays: MAX_PERIOD_DAYS }),
    }
  }
  const { period, from, to } = resolved
  return period.kind === 'month'
    ? { ok: true, from, to, month: period.month, label: formatMonthLabel(from) }
    : { ok: true, from, to, month: null, label: formatRange(from, to) }
}

/** Un mes pedido, o el de `today`. */
export function texMonth(
  raw: string | undefined,
  today: string,
): { ok: true; month: string } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, month: today.slice(0, 7) }
  return isRealYearMonth(raw)
    ? { ok: true, month: raw }
    : { ok: false, message: periodErrorMessage('mes-invalido') }
}

/** Los textos de pantalla traen espacios duros: acá gastan tokens y no dicen nada. */
export function plain(text: string): string {
  return text.replaceAll(NBSP, ' ')
}

/** Un importe si hay algo: en una fila, un cero solo gasta tokens. */
export function moneyIf(cents: number | null | undefined): string | undefined {
  return cents ? money(cents) : undefined
}

/**
 * Un saldo con su lado: `$ 1.000 deudor`, `$ 1.000 acreedor`. Es como lo lee la contadora, y evita un
 * menos que hay que interpretar según la cuenta.
 */
export function sideBalance(netCents: number): string {
  if (netCents === 0) return money(0)
  return `${money(Math.abs(netCents))} ${netCents > 0 ? 'deudor' : 'acreedor'}`
}

/** Una fila sin lo que no tiene dato. */
export function compact<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(row) as Array<keyof T>) {
    const value = row[key]
    if (value !== null && value !== undefined) out[key] = value
  }
  return out
}

/**
 * Lo que entra cómodo en una respuesta. Arriba de 14.000 caracteres el ciclo la corta a la mitad de un
 * renglón (`MAX_TOOL_RESULT_CHARS`): Tex leería un JSON roto.
 */
export const RESPONSE_MAX_CHARS = 12_000

/**
 * Como `capped`, pero también por tamaño: las filas que traen textos largos o muy dispares (un asiento
 * de un cierre tiene muchas líneas) se cortan acá, enteras, y Tex sabe que hay más.
 */
export function cappedBySize<T>(
  rows: readonly T[],
  maxRows: number,
  maxChars: number = RESPONSE_MAX_CHARS,
): { filas: T[]; hay_mas: boolean } {
  const filas: T[] = []
  let chars = 0
  for (const row of rows) {
    chars += JSON.stringify(row).length
    if (filas.length >= maxRows || (chars > maxChars && filas.length > 0)) {
      return { filas, hay_mas: true }
    }
    filas.push(row)
  }
  return { filas, hay_mas: false }
}

/** Las listas que el sistema da de vieja a nueva: lo que importa es lo último. */
export function newestFirst<T>(
  rows: readonly T[],
  maxRows: number,
  maxChars: number = RESPONSE_MAX_CHARS,
): { filas: T[]; hay_mas: boolean } {
  return cappedBySize([...rows].reverse(), maxRows, maxChars)
}

/** Un texto libre, corto: una descripción no puede comerse el presupuesto de la respuesta. */
export function shortText(text: string | null | undefined, max = 90): string | undefined {
  const value = text?.trim()
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
