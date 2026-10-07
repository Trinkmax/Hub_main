/**
 * Punto de venta y número de comprobante: `0003-00001290`.
 *
 * - Punto de venta: 0 a 99.999 (`acc_documents.point_of_sale`). ARCA hoy lo
 *   imprime con 5 dígitos (`00003`); los comprobantes viejos y Thinkeon, con 4
 *   (`0003`). Se leen los dos igual.
 * - Número: 1 a 99.999.999, siempre 8 dígitos.
 *
 * Lo usan CodeField (kit), el pegado de Thinkeon en el cierre del día y los
 * textos de los comprobantes («Factura A 0003-00001290»).
 */

export const POINT_OF_SALE_MAX = 99_999
export const VOUCHER_NUMBER_MAX = 99_999_999

/** Dígitos del punto de venta en el formato de ARCA vigente. */
export const POINT_OF_SALE_DIGITS = 5
export const VOUCHER_NUMBER_DIGITS = 8

/** Ceros a la izquierda; con un valor que no es un entero no negativo devuelve el texto tal cual. */
function padDigits(value: number | string, width: number): string {
  const text = typeof value === 'number' ? String(value) : value.trim()
  if (!/^\d+$/.test(text)) return text
  return text.padStart(width, '0')
}

/** `3` → `'00003'` (CodeField, kind `pv`). Con `width = 4` → `'0003'`. */
export function padPv(value: number | string, width: number = POINT_OF_SALE_DIGITS): string {
  return padDigits(value, width)
}

/** `1290` → `'00001290'` (CodeField, kind `doc-number`). */
export function padDocNumber(
  value: number | string,
  width: number = VOUCHER_NUMBER_DIGITS,
): string {
  return padDigits(value, width)
}

/** `'00003'` → `3`; `null` si no es un punto de venta válido (0 a 99.999). */
export function parsePointOfSale(input: string | number | null | undefined): number | null {
  const text = typeof input === 'number' ? String(input) : (input ?? '').trim()
  if (!/^\d{1,5}$/.test(text)) return null
  return Number(text)
}

/** `'00001290'` → `1290`; `null` si no es un número válido (1 a 99.999.999). */
export function parseDocNumber(input: string | number | null | undefined): number | null {
  const text = typeof input === 'number' ? String(input) : (input ?? '').trim()
  if (!/^\d{1,8}$/.test(text)) return null
  const n = Number(text)
  return n >= 1 ? n : null
}

/**
 * `(3, 1290)` → `'0003-00001290'`. El punto de venta va con 4 dígitos si entra
 * (como lo escriben las facturas y Thinkeon) y con 5 si no; `posWidth: 5` lo
 * fuerza al formato de ARCA (`'00003-00001290'`).
 */
export function formatVoucherNumber(
  pointOfSale: number,
  number: number,
  opts: { posWidth?: 4 | 5 } = {},
): string {
  return `${padPv(pointOfSale, opts.posWidth ?? 4)}-${padDocNumber(number)}`
}

export type VoucherNumber = { pointOfSale: number; number: number }

/**
 * Punto de venta y número separados por guion, raya, barra o espacio. Lo que
 * venga antes del primer dígito («Factura A », «FA », «C-») se ignora.
 */
const VOUCHER_RE = /^\D*?(\d{1,5})\s*[-–—/\s]\s*(\d{1,8})$/
/** Los 12 o 13 dígitos pegados: 4 o 5 del punto de venta y 8 del número. */
const VOUCHER_COMPACT_RE = /^\D*?(\d{4,5})(\d{8})$/

/**
 * `'0003-00001290'` → `{ pointOfSale: 3, number: 1290 }`. También `'00003-00001290'`,
 * `'3-1290'`, `'0003 00001290'`, `'Factura A 0003-00001290'` y los 12 o 13
 * dígitos pegados (`'000300001290'`). `null` si no se lee o está fuera de rango.
 */
export function parseVoucherNumber(input: string | null | undefined): VoucherNumber | null {
  const text = (input ?? '').trim()
  const m = VOUCHER_RE.exec(text) ?? VOUCHER_COMPACT_RE.exec(text)
  if (!m) return null
  const pointOfSale = parsePointOfSale(m[1])
  const number = parseDocNumber(m[2])
  if (pointOfSale === null || number === null) return null
  return { pointOfSale, number }
}

export type VoucherRangeIssue = 'ilegible' | 'puntos-distintos' | 'invertido'

export type VoucherRangeParse =
  | { ok: true; pointOfSale: number; from: number; to: number; count: number }
  | { ok: false; reason: VoucherRangeIssue }

/**
 * Separadores entre el «desde» y el «hasta», del más claro al más ambiguo. Un
 * guion pegado no está: es el que separa punto de venta y número.
 */
const RANGE_SEPARATORS: readonly RegExp[] = [
  /\s+(?:a|al|hasta)\s+/gi,
  /\s*\.\.\s*/g,
  /\s+[-–—]\s+/g,
  /\s*[–—]\s*/g,
]

/** El rango de un corte puntual, o `null` si ese corte no deja dos números legibles. */
function rangeFromParts(left: string, right: string): VoucherRangeParse | null {
  const first = parseVoucherNumber(left)
  if (!first) return null
  const rightText = right.trim()
  let to: number | null
  if (/^\d{1,8}$/.test(rightText)) {
    to = parseDocNumber(rightText)
  } else {
    const second = parseVoucherNumber(rightText)
    if (!second) return null
    if (second.pointOfSale !== first.pointOfSale) return { ok: false, reason: 'puntos-distintos' }
    to = second.number
  }
  if (to === null) return null
  if (to < first.number) return { ok: false, reason: 'invertido' }
  return {
    ok: true,
    pointOfSale: first.pointOfSale,
    from: first.number,
    to,
    count: to - first.number + 1,
  }
}

/**
 * `'0003-00014501 a 0003-00014662'` → `{ pointOfSale: 3, from: 14501, to: 14662, count: 162 }`
 * (lo que se pega de Thinkeon en el cierre del día). Separadores: «a», «al»,
 * «hasta», «..», un guion o una raya con espacios. El «hasta» puede venir sin
 * punto de venta (`'0003-00014501 a 00014662'`); si trae uno, tiene que ser el
 * mismo.
 */
export function parseVoucherRange(input: string | null | undefined): VoucherRangeParse {
  const text = (input ?? '').trim()
  for (const separator of RANGE_SEPARATORS) {
    // Se prueban todos los cortes: en «Factura A 0003-… a 0003-…» la primera
    // «A» es la letra del comprobante, no el separador.
    for (const match of text.matchAll(separator)) {
      const result = rangeFromParts(
        text.slice(0, match.index),
        text.slice(match.index + match[0].length),
      )
      if (result) return result
    }
  }
  return { ok: false, reason: 'ilegible' }
}

/** `(3, 14501, 14662)` → `'0003-00014501 a 0003-00014662'`. */
export function formatVoucherRange(
  pointOfSale: number,
  from: number,
  to: number,
  opts: { posWidth?: 4 | 5 } = {},
): string {
  return `${formatVoucherNumber(pointOfSale, from, opts)} a ${formatVoucherNumber(pointOfSale, to, opts)}`
}

export const VOUCHER_RANGE_MESSAGES: Readonly<Record<VoucherRangeIssue, string>> = {
  ilegible: 'Escribí el rango como 0003-00014501 a 0003-00014662.',
  'puntos-distintos': 'Los dos números tienen que ser del mismo punto de venta.',
  invertido: 'El «hasta» no puede ser menor que el «desde».',
}
