/**
 * Lo que la gente tipea o pega en un campo de números, leído sin sorpresas.
 *
 * - `parseLocaleNumber` / `canonicalInput`: se mudaron tal cual desde
 *   `lib/salon/event-marketing.ts` (que los reexporta). Devuelven `number` en
 *   unidades y los usa «Cómo nos fue» para pauta, dólar y conteos.
 * - `parseMoneyToCents`: el parser de plata del kit y de lo contable. Mismas
 *   reglas de separadores, pero devuelve CENTAVOS enteros armados con
 *   aritmética de strings: nunca `Math.round(x * 100)`. Es el único lugar del
 *   código que multiplica plata por 100 (Sprint 1 G.2).
 *
 * Puro: sin React ni DB. Sin `Intl`.
 */

import { decimalEsAr, decimalEsArAuto } from './decimal'
import { formatCents, type MoneyCurrency } from './format'

// ─── Números en unidades (movido desde event-marketing.ts) ───────────────────

export type NumberKind = 'money' | 'count' | 'rate'

export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: 'vacio' | 'ilegible' | 'negativo' | 'con-decimales' }

/** Primer grupo de 1 a 3 dígitos y el resto de exactamente 3. */
function validGroups(groups: ReadonlyArray<string>): boolean {
  return groups.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)))
}

/** Deja el número como lo entiende `Number` (`'1234.5'`), o `null` si es ambiguo. */
function normalizeSeparators(s: string): string | null {
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot === -1 && lastComma === -1) return s

  if (lastDot !== -1 && lastComma !== -1) {
    // Los dos: el último es el decimal y el otro solo puede separar miles.
    const decimal = lastDot > lastComma ? '.' : ','
    const group = decimal === '.' ? ',' : '.'
    const decimalAt = s.lastIndexOf(decimal)
    const intPart = s.slice(0, decimalAt)
    const fracPart = s.slice(decimalAt + 1)
    if (intPart.includes(decimal) || !/^\d+$/.test(fracPart)) return null
    const groups = intPart.split(group)
    return validGroups(groups) ? `${groups.join('')}.${fracPart}` : null
  }

  const sep = lastDot !== -1 ? '.' : ','
  const parts = s.split(sep)
  // Más de una vez: separa miles, y todos los grupos tienen que ser de 3.
  if (parts.length > 2) return validGroups(parts) ? parts.join('') : null
  const [intPart = '', fracPart = ''] = parts
  // Una vez y 3 dígitos atrás: miles (`1.450`, `8,420`). `1234.567` es ambiguo.
  if (/^\d{3}$/.test(fracPart)) return validGroups(parts) ? parts.join('') : null
  // Una vez y 1-2 dígitos: decimal (`175,26`, `175.26`, `1450,50`).
  if (/^\d{1,2}$/.test(fracPart)) return `${intPart || '0'}.${fracPart}`
  return null
}

/**
 * Lee lo que el dueño pega desde Meta o tipea a mano, en cualquiera de los
 * dos formatos. Ads Manager en es-LA muestra `US$175,26`; una planilla en
 * inglés, `1,234.50`. La regla "si hay coma, es el decimal" leía mal esto
 * último, así que cuando hay ambos separadores manda el ÚLTIMO, y cuando hay
 * uno solo lo deciden los dígitos que lo siguen (3 = miles; 1-2 = decimal).
 */
export function parseLocaleNumber(raw: string, kind: NumberKind): ParsedNumber {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, reason: 'vacio' }
  const firstDigit = trimmed.search(/\d/)
  // Un menos (o el signo tipográfico) antes del primer dígito. Un guion después
  // ("175,26 - USD") es texto y se descarta con el resto.
  if (firstDigit > 0 && /[-−]/.test(trimmed.slice(0, firstDigit)))
    return { ok: false, reason: 'negativo' }
  // Fuera US$, USD, $, letras, espacios y espacios duros: quedan dígitos y separadores.
  const cleaned = trimmed.replace(/[^\d.,]/g, '')
  if (!/\d/.test(cleaned)) return { ok: false, reason: 'ilegible' }
  const normalized = normalizeSeparators(cleaned)
  if (normalized === null) return { ok: false, reason: 'ilegible' }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return { ok: false, reason: 'ilegible' }
  if (kind === 'count' && !Number.isInteger(value)) return { ok: false, reason: 'con-decimales' }
  return { ok: true, value }
}

/**
 * Cómo queda el input al salir del campo: `1,234.50` → `1.234,50`. Plata y
 * dólar van enteros si son redondos y con 2 decimales si no; los conteos,
 * enteros. Siempre vuelve a leerse igual con `parseLocaleNumber`.
 */
export function canonicalInput(value: number, kind: NumberKind): string {
  // Para conteos es exactamente `formatCount` de event-marketing.
  if (kind === 'count') return decimalEsAr(Math.round(value), 0, true)
  return decimalEsArAuto(value, true)
}

// ─── Plata en centavos ───────────────────────────────────────────────────────

/**
 * Tope por importe: 1e15 centavos ($ 10.000.000.000.000), el mismo que los
 * CHECK de las tablas `acc_*`. Por debajo de 2^53, así que entra exacto en un
 * `number`. Los formularios de negocio ponen su propio `maxCents` más chico.
 */
export const MONEY_MAX_CENTS = 1_000_000_000_000_000

export type MoneyParseReason =
  | 'vacio'
  | 'ilegible'
  | 'negativo'
  | 'con-decimales'
  | 'demasiados-decimales'
  | 'fuera-de-rango'

/**
 * Resultado de leer plata. El caso `fuera-de-rango` trae qué borde se pasó y
 * cuál era, para que el mensaje diga «de $ X o más» o «de hasta $ Y».
 */
export type MoneyParse =
  | { ok: true; cents: number }
  | { ok: false; reason: Exclude<MoneyParseReason, 'fuera-de-rango'> }
  | { ok: false; reason: 'fuera-de-rango'; bound: 'min' | 'max'; limitCents: number }

export type MoneyParseFailure = Extract<MoneyParse, { ok: false }>

export type ParseMoneyOptions = {
  /** Default `false`: en lo contable el sentido lo da Debe o Haber, no el signo. */
  allowNegative?: boolean
  /** Solo pesos enteros: con centavos distintos de cero da `con-decimales`. */
  wholePesos?: boolean
  /** Default: 0, o −1e15 con `allowNegative`. */
  minCents?: number
  /** Default y techo: 1e15 (`MONEY_MAX_CENTS`). */
  maxCents?: number
}

/** Signos que se leen como menos: guion, menos tipográfico y raya corta. */
const MINUS_CHARS = /[-\u2212\u2013]/

/**
 * ¿Es negativo? Mira solo lo que está antes del primer dígito y después del
 * último:
 * - paréntesis contables: `(1.234,50)` o `$ (1.234,50)`, como muestra Excel los
 *   negativos en formato contable. Sin esto se leerían como positivos, que es el
 *   peor error posible;
 * - un menos adelante: `-1.234,50`, `$ -5`, `−$ 5`;
 * - un menos pegado al final, sin nada atrás: `1.234,50-` (así exportan algunos
 *   sistemas). En `175,26 - USD` el guion es texto, como en `parseLocaleNumber`.
 */
function isNegative(text: string, firstDigit: number, lastDigit: number): boolean {
  const prefix = text.slice(0, firstDigit)
  const suffix = text.slice(lastDigit + 1)
  if (prefix.includes('(') && suffix.includes(')')) return true
  if (MINUS_CHARS.test(prefix)) return true
  return /^\s*[-\u2212\u2013]\s*$/.test(suffix)
}

/**
 * Pesos tipeados o pegados → centavos enteros, sin flotantes.
 *
 * Acepta `1.234,50` · `1234,5` · `1234.50` · `1,234.50` · `$ 1.234` ·
 * `US$175,26` · `1.234.567`, con espacios o espacios duros. Con dos
 * separadores manda el último; con uno solo, 3 dígitos atrás son miles y 1-2
 * son decimales (la lógica de `parseLocaleNumber`).
 *
 * Vacío no es cero: da `vacio`. Más de dos decimales da `demasiados-decimales`
 * (también `0,125`, que `parseLocaleNumber` leería como 125: con un cero
 * adelante no hay miles que agrupar). Letras o guiones entre los dígitos dan
 * `ilegible`; afuera (`US$`, `pesos`) se ignoran.
 */
export function parseMoneyToCents(
  raw: string | null | undefined,
  opts: ParseMoneyOptions = {},
): MoneyParse {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return { ok: false, reason: 'vacio' }
  const firstDigit = trimmed.search(/\d/)
  if (firstDigit === -1) return { ok: false, reason: 'ilegible' }
  const lastDigit = trimmed.search(/\d\D*$/)
  // Entre el primer y el último dígito solo puede haber separadores y espacios.
  // `parseLocaleNumber` tira todo lo demás; con plata eso convertía un CUIT
  // pegado por error (`20-12345678-6`) en veinte mil millones de pesos.
  if (/[^\d.,\s]/.test(trimmed.slice(firstDigit, lastDigit + 1))) {
    return { ok: false, reason: 'ilegible' }
  }
  const negative = isNegative(trimmed, firstDigit, lastDigit)
  if (negative && !opts.allowNegative) return { ok: false, reason: 'negativo' }

  // Fuera `US$`, `$`, paréntesis, letras, espacios y espacios duros: quedan
  // dígitos y separadores.
  const cleaned = trimmed.replace(/[^\d.,]/g, '')
  if (/^0*[.,]\d{3,}$/.test(cleaned)) return { ok: false, reason: 'demasiados-decimales' }
  const normalized = normalizeSeparators(cleaned)
  if (normalized === null) return { ok: false, reason: 'ilegible' }
  const [intRaw = '', fracRaw = ''] = normalized.split('.')
  if (fracRaw.length > 2) return { ok: false, reason: 'demasiados-decimales' }
  if (opts.wholePesos && /[1-9]/.test(fracRaw)) return { ok: false, reason: 'con-decimales' }

  // BigInt adentro: un entero de 20 dígitos no entra exacto en un `number` y el
  // tope tiene que compararse sin perder precisión.
  const absCents = BigInt(intRaw || '0') * 100n + BigInt(fracRaw.padEnd(2, '0'))
  const cents = negative ? -absCents : absCents

  const max = Math.min(Math.floor(opts.maxCents ?? MONEY_MAX_CENTS), MONEY_MAX_CENTS)
  const defaultMin = opts.allowNegative ? -MONEY_MAX_CENTS : 0
  const min = Math.max(Math.ceil(opts.minCents ?? defaultMin), -MONEY_MAX_CENTS)
  if (cents > BigInt(max))
    return { ok: false, reason: 'fuera-de-rango', bound: 'max', limitCents: max }
  if (cents < BigInt(min))
    return { ok: false, reason: 'fuera-de-rango', bound: 'min', limitCents: min }
  // `|| 0`: un «-0,00» permitido no tiene que volver como −0.
  return { ok: true, cents: Number(cents) || 0 }
}

/** Un borde de rango como se lee en un mensaje: entero si es redondo. */
function boundText(cents: number, currency: MoneyCurrency): string {
  return formatCents(cents, { decimals: cents % 100 === 0 ? 0 : 2, currency })
}

/**
 * El mensaje de error de un campo de plata, en la voz de la casa (kit, MoneyField).
 * `raw` es lo que la persona escribió: el de `ilegible` se lo muestra tal cual.
 */
export function moneyParseMessage(
  failure: MoneyParseFailure,
  raw = '',
  opts: { currency?: MoneyCurrency } = {},
): string {
  switch (failure.reason) {
    case 'vacio':
      return 'Falta el importe.'
    case 'ilegible':
      return `No entendemos «${raw.trim()}». Escribilo como 1.234,50.`
    case 'negativo':
      return 'Tiene que ser un importe positivo.'
    case 'con-decimales':
      return 'Tiene que ser un importe sin centavos.'
    case 'demasiados-decimales':
      return 'Usá hasta dos decimales.'
    case 'fuera-de-rango': {
      const limit = boundText(failure.limitCents, opts.currency ?? 'ARS')
      return failure.bound === 'min'
        ? `Tiene que ser de ${limit} o más.`
        : `Tiene que ser de hasta ${limit}.`
    }
  }
}
