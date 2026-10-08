/**
 * Títulos de columnas: normalizar, clasificar con reglas y encontrar la fila de
 * títulos (`arca-mis-comprobantes.md` §9.1–§9.3, `banco.md` §3.2).
 *
 * Los archivos cambian de generación, de idioma y de herramienta (CSV, Excel,
 * «pasado por Excel»), así que nunca se busca un título exacto: se normaliza y
 * se prueban expresiones regulares en orden. La fila de títulos se BUSCA en las
 * primeras filas (los Excel traen una fila de título y los bancos metadatos).
 */

import { sha256HexSync } from './hash'
import type { Cell } from './types'

/**
 * `"Imp. Neto Gravado IVA 10,5%"` → `'imp neto gravado iva 10.5%'`.
 *
 * NFD sin diacríticos → minúsculas → espacios raros a espacio → decimales
 * unificados (`10,5`/`10.5` → `10.5`) → fuera `°º` → toda puntuación salvo el
 * `.` entre dígitos, `%` y `/` pasa a espacio (`_` también: `NET_CREDIT_AMOUNT`
 * → `net credit amount`) → fuera las palabras
 * `de|del|la|el` → espacios colapsados.
 */
export function normalizeHeader(s: Cell | undefined): string {
  return (
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[    ]/g, ' ')
      .replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2')
      .replace(/[°º]/g, ' ')
      .replace(/[^a-z0-9.%/ ]+/g, ' ')
      // Puntos que no están entre dígitos. Sin «lookbehind»: un Safari anterior a
      // 16.4 no compila la expresión y se caería el módulo entero.
      .replace(/\.(?!\d)/g, ' ')
      .replace(/(^|[^0-9])\.(?=\d)/g, '$1 ')
      .replace(/\b(de|del|la|el)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Una regla: si la expresión calza con el título normalizado, la columna es `K`. */
export type HeaderRule<K extends string> = readonly [RegExp, K]

/** La clave canónica de un título, o `null`. Gana la primera regla que calza. */
export function classifyHeader<K extends string>(
  cell: Cell | undefined,
  rules: readonly HeaderRule<K>[],
): K | null {
  const n = normalizeHeader(cell)
  if (n === '') return null
  for (const [re, key] of rules) if (re.test(n)) return key
  return null
}

/** Columnas de una fila de títulos: cada clave a su índice (gana la primera columna). */
export function mapHeaderRow<K extends string>(
  row: readonly Cell[],
  rules: readonly HeaderRule<K>[],
): Partial<Record<K, number>> {
  const map: Partial<Record<K, number>> = {}
  row.forEach((cell, j) => {
    const key = classifyHeader(cell, rules)
    if (key !== null && map[key] === undefined) map[key] = j
  })
  return map
}

export type HeaderMatch<K extends string> = {
  /** Índice (desde 0) de la fila de títulos. */
  readonly index: number
  readonly columns: Partial<Record<K, number>>
  /** Cuántas columnas se reconocieron. */
  readonly score: number
}

/**
 * Busca la fila de títulos en las primeras `maxScan` filas: la que cumple
 * `accept` y reconoce más columnas (a igualdad, la primera).
 */
export function findHeaderRow<K extends string>(
  rows: readonly (readonly Cell[])[],
  rules: readonly HeaderRule<K>[],
  accept: (columns: Partial<Record<K, number>>) => boolean,
  maxScan = 10,
): HeaderMatch<K> | null {
  let best: HeaderMatch<K> | null = null
  const limit = Math.min(rows.length, maxScan)
  for (let i = 0; i < limit; i++) {
    const columns = mapHeaderRow(rows[i] ?? [], rules)
    if (!accept(columns)) continue
    const score = Object.keys(columns).length
    if (!best || score > best.score) best = { index: i, columns, score }
  }
  return best
}

/**
 * Firma de un formato: SHA-256 de los títulos normalizados y el separador (o el
 * contenedor: `xlsx`, `html`). Es la que se guarda en `acc_import_layouts` para
 * no volver a preguntar qué es cada columna (diseño §4.3.2).
 */
export function headerSignature(row: readonly Cell[], delimiter: string): string {
  const cells = row.map((c) => normalizeHeader(c))
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
  return sha256HexSync(`${cells.join('\u001f')}\u001e${delimiter}`)
}

// ─── Reglas de Mis Comprobantes y Portal IVA (§9.3) ──────────────────────────

export type McColumn =
  | 'fecha'
  | 'tipo'
  | 'pto_vta'
  | 'nro_desde'
  | 'nro_hasta'
  | 'nro_comprobante'
  | 'cod_aut'
  | 'tipo_doc_emisor'
  | 'tipo_doc_receptor'
  | 'nro_doc_emisor'
  | 'nro_doc_receptor'
  | 'denom_emisor'
  | 'denom_receptor'
  | 'tipo_cambio'
  | 'moneda'
  | 'neto_0'
  | 'neto_2_5'
  | 'neto_5'
  | 'neto_10_5'
  | 'neto_21'
  | 'neto_27'
  | 'iva_2_5'
  | 'iva_5'
  | 'iva_10_5'
  | 'iva_21'
  | 'iva_27'
  | 'neto_gravado_total'
  | 'no_gravado'
  | 'exento'
  | 'otros_tributos'
  | 'iva_total'
  | 'total'
  | 'cf_computable'
  | 'perc_iibb'
  | 'perc_iva'
  | 'perc_otros_nac'
  | 'imp_municipales'
  | 'imp_internos'

const neto = (rate: string): RegExp =>
  new RegExp(`^(imp |importe )?neto grav(ado)? iva ${rate}\\s*%$`)
const iva = (rate: string): RegExp => new RegExp(`^(importe )?iva ${rate}\\s*%$`)

/**
 * En orden: gana la primera. `iva` a secas (G1/G2) es el TOTAL y nunca calza con
 * las reglas por alícuota (que exigen el `%`).
 */
export const MC_HEADER_RULES: readonly HeaderRule<McColumn>[] = [
  [/^fecha( emision)?$/, 'fecha'],
  [/^tipo( comprobante)?$/, 'tipo'],
  [/^(punto venta|pto vta|pto venta|punto vta)$/, 'pto_vta'],
  [/^(numero|nro|n) desde$/, 'nro_desde'],
  [/^(numero|nro|n) hasta$/, 'nro_hasta'],
  [/^(numero|nro|n|no) comprobante$/, 'nro_comprobante'],
  [/^(cod|codigo) autorizacion$|^cae$/, 'cod_aut'],
  [/^tipo (doc|documento) (emisor|vendedor)$/, 'tipo_doc_emisor'],
  [/^tipo (doc|documento) receptor$/, 'tipo_doc_receptor'],
  [/^(nro|numero|n|no) (doc|documento) (emisor|vendedor)$/, 'nro_doc_emisor'],
  [/^(nro|numero|n|no) (doc|documento) receptor$/, 'nro_doc_receptor'],
  [/^denominacion (emisor|vendedor)$/, 'denom_emisor'],
  [/^denominacion receptor$/, 'denom_receptor'],
  [/^tipo cambio$/, 'tipo_cambio'],
  [/^moneda( original)?$/, 'moneda'],
  [neto('0'), 'neto_0'],
  [neto('2\\.5'), 'neto_2_5'],
  [neto('5'), 'neto_5'],
  [neto('10\\.5'), 'neto_10_5'],
  [neto('21'), 'neto_21'],
  [neto('27'), 'neto_27'],
  [iva('2\\.5'), 'iva_2_5'],
  [iva('5'), 'iva_5'],
  [iva('10\\.5'), 'iva_10_5'],
  [iva('21'), 'iva_21'],
  [iva('27'), 'iva_27'],
  [/^(imp |importe )?neto gravado( total)?$|^total neto gravado$/, 'neto_gravado_total'],
  [/^(imp |importe )?neto no gravado$|^importe no gravado$/, 'no_gravado'],
  [/^(imp |importe )?op exentas$|^importe exento$/, 'exento'],
  [/^(importe )?otros tributos$/, 'otros_tributos'],
  [/^(total )?iva$/, 'iva_total'],
  [/^(imp|importe) total$/, 'total'],
  // Solo el CSV de compras de Portal IVA (Libro IVA Digital):
  [/^credito fiscal computable$/, 'cf_computable'],
  [/^importe percepciones ingresos brutos$/, 'perc_iibb'],
  [/^importe percepciones o pagos a cuenta iva$/, 'perc_iva'],
  [/^importe per o pagos a cta otros imp nac$/, 'perc_otros_nac'],
  [/^importe impuestos municipales$/, 'imp_municipales'],
  [/^importe impuestos internos$/, 'imp_internos'],
]

/**
 * Las columnas sin las que no es un archivo de comprobantes: fecha, tipo, total
 * y el punto de venta (o el «PPPPP-NNNNNNNN» unificado en una sola columna, como
 * salió el Excel unos días de sep-2025).
 */
export function isMcHeader(columns: Partial<Record<McColumn, number>>): boolean {
  return (
    columns.fecha !== undefined &&
    columns.tipo !== undefined &&
    (columns.pto_vta !== undefined || columns.nro_comprobante !== undefined) &&
    columns.total !== undefined
  )
}
