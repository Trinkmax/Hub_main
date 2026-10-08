/**
 * Importes de los archivos → centavos enteros, sin pasar por `float`
 * (`arca-mis-comprobantes.md` §9.4, `banco.md` §3.3, `mercadopago.md` §2.8).
 *
 * A diferencia de `parseMoneyToCents` (lo que tipea una persona), acá el
 * separador decimal lo decide el ARCHIVO, no cada valor: Mis Comprobantes usa
 * coma, Mercado Pago punto y los bancos cualquiera de los dos. Por eso:
 * - `','` y `'.'`: el otro signo solo puede separar miles (en grupos de 3);
 * - `'auto'`: para un valor suelto (`banco.md` §3.3): con los dos signos manda
 *   el último; con uno solo, 1 o 2 dígitos atrás es decimal y 3 son miles; lo
 *   ambiguo se rechaza en vez de adivinar. Mejor todavía: `detectDecimalMark`
 *   sobre toda la columna y después el modo fijo.
 *
 * Además:
 * - acepta `$`, `ARS`, `U$S`, `US$`, `USD`, espacios y espacios duros;
 * - negativos con `-` adelante, `-` al final (`1.234,56-`, el saldo deudor del
 *   PDF de BNA) o entre paréntesis (`(1.234,56)`, formato contable de Excel);
 * - **rechaza la notación científica** (`7,54833E+13`): es la marca de un CSV
 *   que pasó por Excel;
 * - más de dos decimales se redondean al centavo, la mitad lejos del cero, y se
 *   avisa (`rounded`);
 * - las celdas numéricas de un XLSX se leen por su representación decimal más
 *   corta (`String(5814.05)` = `'5814.05'`), no con `Math.round(v * 100)`, que
 *   redondea mal `1.005`.
 */

import { MONEY_MAX_CENTS } from '@/lib/money/parse'

export type DecimalMark = ',' | '.'
export type DecimalMode = DecimalMark | 'auto'

export type AmountFailure = 'empty' | 'scientific' | 'invalid' | 'ambiguous' | 'out_of_range'

export type AmountParse =
  | { readonly ok: true; readonly cents: number; readonly rounded: boolean }
  | { readonly ok: false; readonly reason: AmountFailure }

const MAX = BigInt(MONEY_MAX_CENTS)

/** Espacios duros, finos y de ancho cero → espacio común. */
const ODD_SPACES = /[    ​]/g
const MINUS = /[-−–—]/
const CURRENCY_PREFIX = /^(?:ars|u\$s|us\$|u\$d|usd|\$)\s*/i
const CURRENCY_SUFFIX = /\s*(?:ars|u\$s|us\$|usd|\$)$/i
const SCIENTIFIC = /^\d+(?:[.,]\d+)?e[+-]?\d+$/i

type Parts = { int: string; frac: string }

/** `'1.234.567'` → `'1234567'` si los grupos son de 3; `null` si no. */
function ungroup(intPart: string, sep: string): string | null {
  if (!intPart.includes(sep)) return /^\d+$/.test(intPart) ? intPart : null
  const groups = intPart.split(sep)
  const ok = groups.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)))
  return ok ? groups.join('') : null
}

/** Separa entero y decimales con un separador decimal fijo. */
function splitFixed(core: string, decimal: DecimalMark): Parts | 'ambiguous' | null {
  const group = decimal === ',' ? '.' : ','
  const at = core.indexOf(decimal)
  if (at !== core.lastIndexOf(decimal)) return null
  if (at === -1) {
    const int = ungroup(core, group)
    if (int !== null) return { int, frac: '' }
    // `1234.56` en un archivo con coma decimal: el archivo no es lo que dice.
    return /^\d+[.,]\d{1,2}$/.test(core) ? 'ambiguous' : null
  }
  const intRaw = core.slice(0, at)
  const frac = core.slice(at + 1)
  if (!/^\d*$/.test(frac) || (intRaw === '' && frac === '')) return null
  if (intRaw.includes(decimal)) return null
  const int = intRaw === '' ? '0' : ungroup(intRaw, group)
  return int === null ? null : { int, frac }
}

/** El separador decimal de un valor suelto (`banco.md` §3.3), o `ambiguous`. */
function splitAuto(core: string): Parts | 'ambiguous' | null {
  const lastDot = core.lastIndexOf('.')
  const lastComma = core.lastIndexOf(',')
  if (lastDot === -1 && lastComma === -1) return /^\d+$/.test(core) ? { int: core, frac: '' } : null
  if (lastDot !== -1 && lastComma !== -1) {
    return splitFixed(core, lastDot > lastComma ? '.' : ',')
  }
  const sep = lastDot !== -1 ? '.' : ','
  const count = core.split(sep).length - 1
  if (count > 1) {
    const int = ungroup(core, sep)
    return int === null ? null : { int, frac: '' }
  }
  const after = core.length - core.indexOf(sep) - 1
  if (after === 1 || after === 2) return splitFixed(core, sep)
  // `0,125` no puede ser «ciento veinticinco» con separador de miles: es ambiguo.
  if (after === 3 && !/^0+[.,]/.test(core)) {
    const int = ungroup(core, sep)
    return int === null ? null : { int, frac: '' }
  }
  return 'ambiguous'
}

/** Entero y decimales (en texto) → centavos con redondeo a la mitad lejos del cero. */
function toCents(parts: Parts, negative: boolean): AmountParse {
  const frac2 = `${parts.frac}00`.slice(0, 2)
  const rest = parts.frac.slice(2)
  let cents = BigInt(parts.int || '0') * 100n + BigInt(frac2)
  if (rest !== '' && Number(rest[0]) >= 5) cents += 1n
  const rounded = /[1-9]/.test(rest)
  if (cents > MAX) return { ok: false, reason: 'out_of_range' }
  const signed = negative ? -cents : cents
  return { ok: true, cents: Number(signed) || 0, rounded }
}

/** Un número de un XLSX → texto decimal sin exponente, o `null` si no es representable. */
function numberText(v: number): string | null {
  if (!Number.isFinite(v)) return null
  const abs = Math.abs(v)
  const s = String(abs)
  if (!/e/i.test(s)) return s
  if (abs < 1) return abs.toFixed(20)
  return null
}

/**
 * Lee un importe. `raw` puede ser texto (CSV, HTML, celdas de texto de Excel) o
 * número (celdas numéricas de XLSX). Ver el encabezado del archivo.
 */
export function parseAmount(raw: unknown, decimal: DecimalMode = 'auto'): AmountParse {
  if (raw === null || raw === undefined) return { ok: false, reason: 'empty' }
  if (typeof raw === 'number') {
    const text = numberText(raw)
    if (text === null) return { ok: false, reason: 'out_of_range' }
    const parts = splitFixed(text, '.')
    if (parts === null || parts === 'ambiguous') return { ok: false, reason: 'invalid' }
    return toCents(parts, raw < 0)
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid' }

  let s = raw.replace(ODD_SPACES, ' ').trim()
  // Excel a veces exporta `="0012"` para que no se coma los ceros.
  const formula = /^="(.*)"$/.exec(s)
  if (formula) s = (formula[1] ?? '').trim()
  if (s === '' || /^[-−–—]$/.test(s)) return { ok: false, reason: 'empty' }

  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  if (s.startsWith('+')) s = s.slice(1).trim()
  if (MINUS.test(s[0] ?? '')) {
    negative = !negative
    s = s.slice(1).trim()
  }
  s = s.replace(CURRENCY_PREFIX, '').replace(CURRENCY_SUFFIX, '').trim()
  // El signo puede venir después del símbolo («$ -5») o al final («1.234,56-»).
  if (MINUS.test(s[0] ?? '')) {
    negative = !negative
    s = s.slice(1).trim()
  }
  if (MINUS.test(s[s.length - 1] ?? '')) {
    negative = !negative
    s = s.slice(0, -1).trim()
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = !negative
    s = s.slice(1, -1).trim()
  }
  const core = s.replace(/\s+/g, '')
  if (core === '') return { ok: false, reason: 'invalid' }
  if (SCIENTIFIC.test(core)) return { ok: false, reason: 'scientific' }
  if (!/^[\d.,]+$/.test(core) || !/\d/.test(core)) return { ok: false, reason: 'invalid' }

  const parts = decimal === 'auto' ? splitAuto(core) : splitFixed(core, decimal)
  if (parts === 'ambiguous') return { ok: false, reason: 'ambiguous' }
  if (parts === null) return { ok: false, reason: 'invalid' }
  return toCents(parts, negative)
}

/** Atajo: centavos o `null` (vacío, ilegible, científico o ambiguo). */
export function parseAmountToCents(raw: unknown, decimal: DecimalMode = 'auto'): number | null {
  const r = parseAmount(raw, decimal)
  return r.ok ? r.cents : null
}

/**
 * Decide el separador decimal de una columna de importes (o de todo el archivo).
 * Vota cada valor de texto: con los dos signos, el último es el decimal; con uno
 * solo y 1 o 2 dígitos atrás, ese es el decimal; con uno solo y 3 dígitos atrás,
 * ese es de miles (voto débil para el otro). Devuelve `null` si nadie votó.
 */
export function detectDecimalMark(values: Iterable<unknown>): DecimalMark | null {
  let comma = 0
  let dot = 0
  let weakComma = 0
  let weakDot = 0
  for (const v of values) {
    if (typeof v !== 'string') continue
    const s = v.replace(ODD_SPACES, '').replace(/[^\d.,]/g, '')
    const lastDot = s.lastIndexOf('.')
    const lastComma = s.lastIndexOf(',')
    if (lastDot === -1 && lastComma === -1) continue
    if (lastDot !== -1 && lastComma !== -1) {
      if (lastDot > lastComma) dot++
      else comma++
      continue
    }
    const sep = lastDot !== -1 ? '.' : ','
    const parts = s.split(sep)
    const after = (parts[parts.length - 1] ?? '').length
    if (parts.length === 2 && (after === 1 || after === 2)) {
      if (sep === '.') dot++
      else comma++
    } else if (after === 3) {
      if (sep === '.') weakComma++
      else weakDot++
    }
  }
  if (comma === 0 && dot === 0) {
    if (weakComma === weakDot) return null
    return weakComma > weakDot ? ',' : '.'
  }
  return comma >= dot ? ',' : '.'
}

// ─── Decimales exactos (tipo de cambio) ──────────────────────────────────────

/**
 * Un decimal exacto como texto canónico: punto decimal, sin miles, sin ceros de
 * más (`'1475,006'` → `'1475.006'`, `'1,00'` → `'1'`). Para el tipo de cambio,
 * que se guarda como `numeric` y no en centavos. `null` si no se entiende.
 */
export function parseDecimal(raw: unknown, decimal: DecimalMode = 'auto'): string | null {
  let parts: Parts | 'ambiguous' | null
  let negative = false
  if (typeof raw === 'number') {
    const text = numberText(raw)
    if (text === null) return null
    parts = splitFixed(text, '.')
    negative = raw < 0
  } else if (typeof raw === 'string') {
    let s = raw.replace(ODD_SPACES, ' ').trim()
    if (MINUS.test(s[0] ?? '')) {
      negative = true
      s = s.slice(1).trim()
    }
    const core = s.replace(/\s+/g, '')
    if (core === '' || SCIENTIFIC.test(core) || !/^[\d.,]+$/.test(core)) return null
    if (decimal === 'auto') {
      // Para un tipo de cambio (`1475,006`, `1465,0222`) un solo signo siempre es el
      // decimal: nadie escribe un tipo de cambio con separador de miles y sin decimales.
      const lastDot = core.lastIndexOf('.')
      const lastComma = core.lastIndexOf(',')
      parts =
        lastDot !== -1 && lastComma !== -1
          ? splitFixed(core, lastDot > lastComma ? '.' : ',')
          : splitFixed(core, lastDot !== -1 ? '.' : ',')
    } else {
      parts = splitFixed(core, decimal)
    }
  } else {
    return null
  }
  if (parts === null || parts === 'ambiguous') return null
  const int = parts.int.replace(/^0+(?=\d)/, '') || '0'
  const frac = parts.frac.replace(/0+$/, '')
  const body = frac === '' ? int : `${int}.${frac}`
  return negative && body !== '0' ? `-${body}` : body
}

/**
 * Centavos × un decimal exacto (el tipo de cambio), redondeando a la mitad lejos
 * del cero: `convertCents(26426, '1465.0222')` → 38714677 (264,26 USD → $ 387.146,77).
 * Tira `RangeError` si el tipo de cambio no es un decimal canónico o si el
 * resultado no entra en un entero seguro.
 */
export function convertCents(cents: number, rate: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(rate)
  if (!m || !Number.isSafeInteger(cents)) throw new RangeError('Tipo de cambio o importe inválido')
  const frac = m[3] ?? ''
  const scaled = BigInt(`${m[2]}${frac}`) * (m[1] === '-' ? -1n : 1n)
  const scale = 10n ** BigInt(frac.length)
  const product = BigInt(cents) * scaled
  const negative = product < 0n
  const abs = negative ? -product : product
  let q = abs / scale
  if ((abs % scale) * 2n >= scale) q += 1n
  const result = negative ? -q : q
  if (result > MAX || result < -MAX)
    throw new RangeError('El importe convertido es demasiado grande')
  return Number(result) || 0
}
