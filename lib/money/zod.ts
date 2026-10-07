/**
 * zod para plata: pesos en el campo, centavos en el borde (kit §3.2 MoneyField
 * punto 7, Sprint 1 G.2).
 *
 * - `centsFromForm`: el `<input type="hidden">` canónico que emite MoneyField
 *   (`""` o dígitos en centavos) → entero o `null`.
 * - `pesosFromForm`: el mismo hidden en modo viejo (`submit="pesos"`,
 *   `"1234.50"`) → PESOS, para las acciones que todavía multiplican por 100.
 * - `centsField`: lo que la persona tipeó tal cual (`"1.234,50"`, `"US$175,26"`)
 *   → centavos, con `parseMoneyToCents` y sus mensajes.
 *
 * Mensajes escritos a mano en rioplatense (los mismos que muestra MoneyField,
 * salen de `moneyParseMessage`): zod no tiene locale global y sin mensaje propio
 * contesta en inglés.
 */

import { z } from 'zod'
import { formatPesos, type MoneyCurrency } from './format'
import {
  MONEY_MAX_CENTS,
  type MoneyParseFailure,
  moneyParseMessage,
  type ParseMoneyOptions,
  parseMoneyToCents,
} from './parse'

const UNREADABLE = 'No pudimos leer el importe. Volvé a escribirlo.'
const MISSING = moneyParseMessage({ ok: false, reason: 'vacio' })

/** El valor de un campo de formulario como texto; `null` si es un archivo u otra cosa. */
function formText(value: unknown): string | null {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export type CentsFromFormOptions = {
  optional?: boolean
  /** Centavos. Default 0, o −1e15 con `allowNegative`. */
  min?: number
  /** Centavos. Default y techo: 1e15. */
  max?: number
  allowNegative?: boolean
  /** Para escribir los bordes en los mensajes. Default `ARS`. */
  currency?: MoneyCurrency
}

/**
 * La clave ausente cuenta como vacía: un input `disabled` no viaja en el
 * FormData. Sin esto, con `optional` y la clave ausente en un `z.object`, zod 4
 * contesta «Invalid input: expected nonoptional» en inglés aunque la
 * transformación devuelva `null` (`z.unknown()` declara opcional la entrada y
 * la salida no lo es). Con el `preprocess` la entrada deja de ser opcional y la
 * transformación decide: `null` o «Falta el importe.».
 */
function absentAsEmpty<T>(schema: z.ZodType<T>): z.ZodType<T> {
  return z.preprocess((value) => (value === undefined ? '' : value), schema)
}

/** Por qué un importe ya leído no entra, o `null` si entra. */
function rangeFailure(cents: number, opts: CentsFromFormOptions): MoneyParseFailure | null {
  const min = opts.min ?? (opts.allowNegative ? -MONEY_MAX_CENTS : 0)
  const max = Math.min(opts.max ?? MONEY_MAX_CENTS, MONEY_MAX_CENTS)
  if (cents < 0 && !opts.allowNegative) return { ok: false, reason: 'negativo' }
  if (cents < min) return { ok: false, reason: 'fuera-de-rango', bound: 'min', limitCents: min }
  if (cents > max) return { ok: false, reason: 'fuera-de-rango', bound: 'max', limitCents: max }
  return null
}

/**
 * El hidden canónico de MoneyField (`"123450"`) → `123450`. `""` → `null` con
 * `optional`, o «Falta el importe.». Cualquier otra cosa en el hidden es un
 * bug o un formulario armado a mano, y se rechaza sin adivinar.
 */
export function centsFromForm(
  opts: CentsFromFormOptions & { optional: true },
): z.ZodType<number | null>
export function centsFromForm(opts?: CentsFromFormOptions): z.ZodType<number>
export function centsFromForm(opts: CentsFromFormOptions = {}): z.ZodType<number | null> {
  return absentAsEmpty(
    z.unknown().transform((value, ctx) => {
      const text = formText(value)
      if (text === '') {
        if (opts.optional) return null
        ctx.addIssue({ code: 'custom', message: MISSING })
        return z.NEVER
      }
      // Hasta 16 dígitos: el tope de 1e15 tiene 16 y así `Number` nunca redondea.
      if (text === null || !/^-?\d{1,16}$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: UNREADABLE })
        return z.NEVER
      }
      const cents = Number(text) || 0
      const failure = rangeFailure(cents, opts)
      if (failure) {
        ctx.addIssue({
          code: 'custom',
          message: moneyParseMessage(failure, text, { currency: opts.currency }),
        })
        return z.NEVER
      }
      return cents
    }),
  )
}

export type PesosFromFormOptions = {
  optional?: boolean
  /** Pesos. Default 0. */
  min?: number
  /** Pesos. Default 1e13 (el mismo tope que los centavos). */
  max?: number
}

/** Un borde en pesos como se lee en un mensaje: entero si es redondo. */
function pesosBound(pesos: number): string {
  return formatPesos(pesos, { decimals: Number.isInteger(pesos) ? 0 : 2 })
}

/**
 * Modo viejo (`submit="pesos"`): el hidden trae `"1234.50"` y la acción espera
 * PESOS porque multiplica por 100 ella misma. Lo nuevo usa `centsFromForm`.
 */
export function pesosFromForm(
  opts: PesosFromFormOptions & { optional: true },
): z.ZodType<number | null>
export function pesosFromForm(opts?: PesosFromFormOptions): z.ZodType<number>
export function pesosFromForm(opts: PesosFromFormOptions = {}): z.ZodType<number | null> {
  return absentAsEmpty(
    z.unknown().transform((value, ctx) => {
      const text = formText(value)
      if (text === '') {
        if (opts.optional) return null
        ctx.addIssue({ code: 'custom', message: MISSING })
        return z.NEVER
      }
      if (text === null || !/^\d{1,14}(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: UNREADABLE })
        return z.NEVER
      }
      const pesos = Number(text)
      const min = opts.min ?? 0
      const max = opts.max ?? MONEY_MAX_CENTS / 100
      if (pesos < min) {
        ctx.addIssue({ code: 'custom', message: `Tiene que ser de ${pesosBound(min)} o más.` })
        return z.NEVER
      }
      if (pesos > max) {
        ctx.addIssue({ code: 'custom', message: `Tiene que ser de hasta ${pesosBound(max)}.` })
        return z.NEVER
      }
      return pesos
    }),
  )
}

export type CentsFieldOptions = ParseMoneyOptions & {
  optional?: boolean
  /** Para escribir los bordes en los mensajes. Default `ARS`. */
  currency?: MoneyCurrency
}

/**
 * Lo que la persona tipeó en pesos (`"1.234,50"`, `"$ 1.234"`, `"1,234.50"`) →
 * centavos enteros. Sirve para formularios sin MoneyField (un `<input>` común,
 * un import) y para validar en el server lo mismo que el campo validó al tipear.
 */
export function centsField(opts: CentsFieldOptions & { optional: true }): z.ZodType<number | null>
export function centsField(opts?: CentsFieldOptions): z.ZodType<number>
export function centsField(opts: CentsFieldOptions = {}): z.ZodType<number | null> {
  return absentAsEmpty(
    z.unknown().transform((value, ctx) => {
      if (value !== null && value !== undefined && typeof value !== 'string') {
        ctx.addIssue({ code: 'custom', message: UNREADABLE })
        return z.NEVER
      }
      const raw = value ?? ''
      const parsed = parseMoneyToCents(raw, opts)
      if (parsed.ok) return parsed.cents
      if (parsed.reason === 'vacio' && opts.optional) return null
      ctx.addIssue({
        code: 'custom',
        message: moneyParseMessage(parsed, raw, { currency: opts.currency }),
      })
      return z.NEVER
    }),
  )
}
