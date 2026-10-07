/**
 * Orden de las tablas del panel (kit HUB §3.6): por URL en el server, o en el
 * cliente con `useTableSort` para listas chicas que ya están en memoria.
 *
 * **Formato de la URL:** `?orden=<key>.<asc|desc>`, por ejemplo
 * `?orden=fecha.desc`. Es la misma forma que el `order=` de PostgREST, que es
 * lo que termina armando la consulta. La key sola (`?orden=fecha`) también se
 * acepta y toma el sentido inicial de esa columna. La key se valida SIEMPRE
 * contra la lista de la página: nunca llega a `.order()` algo que la página no
 * declaró.
 *
 * Puro y server-safe (sin `Intl`: el ICU de Node y el del navegador ordenan
 * distinto y un orden que cambia entre el server y el cliente rompe la
 * hidratación).
 */

import { PAGE_PARAM } from './pagination'
import {
  firstParam,
  hrefWithParams,
  type SearchParamsInput,
  type SearchParamValue,
  toSearchParams,
} from './url'

export type SortDir = 'asc' | 'desc'
export type SortState = { key: string; dir: SortDir }

/** El parámetro de la URL donde viaja el orden. */
export const SORT_PARAM = 'orden'

/**
 * Las keys que la página sabe ordenar: una lista (todas empiezan ascendentes)
 * o un mapa key → sentido inicial (las fechas empiezan descendentes y los
 * nombres ascendentes, §3.6).
 */
export type SortColumns = readonly string[] | Readonly<Record<string, SortDir>>

function isSortDir(value: unknown): value is SortDir {
  return value === 'asc' || value === 'desc'
}

/** El sentido inicial de una key declarada, o `undefined` si la página no la conoce. */
function initialDirOf(columns: SortColumns, key: string): SortDir | undefined {
  if (isStringList(columns)) return columns.includes(key) ? 'asc' : undefined
  // `Object.hasOwn`: «constructor» o «__proto__» en la URL no son columnas.
  if (!Object.hasOwn(columns, key)) return undefined
  const dir = columns[key]
  return isSortDir(dir) ? dir : undefined
}

function isStringList(columns: SortColumns): columns is readonly string[] {
  return Array.isArray(columns)
}

/**
 * Lee `?orden=` y devuelve el orden si la key es una de las declaradas; si no
 * (vacío, key desconocida, basura), el `fallback`.
 *
 * ```ts
 * const sort = parseSort(sp.orden, { nombre: 'asc', saldo: 'desc' }, { key: 'nombre', dir: 'asc' })
 * ```
 */
export function parseSort(
  raw: SearchParamValue,
  columns: SortColumns,
  fallback?: SortState,
): SortState | undefined {
  const value = firstParam(raw)?.trim()
  if (value) {
    const dot = value.lastIndexOf('.')
    const suffix = dot > 0 ? value.slice(dot + 1) : ''
    const key = isSortDir(suffix) ? value.slice(0, dot) : value
    const initial = initialDirOf(columns, key)
    if (initial !== undefined) return { key, dir: isSortDir(suffix) ? suffix : initial }
  }
  return fallback
}

/** `{ key: 'fecha', dir: 'desc' }` → `'fecha.desc'`. */
export function formatSort(sort: SortState): string {
  return `${sort.key}.${sort.dir}`
}

export function sameSort(
  a: SortState | null | undefined,
  b: SortState | null | undefined,
): boolean {
  if (!a || !b) return !a && !b
  return a.key === b.key && a.dir === b.dir
}

/**
 * El sentido que toma una columna al tocarla: si ya es la ordenada, alterna;
 * si no, arranca con su sentido inicial.
 */
export function nextSortDir(
  current: SortState | null | undefined,
  key: string,
  initialDir: SortDir = 'asc',
): SortDir {
  if (current && current.key === key) return current.dir === 'asc' ? 'desc' : 'asc'
  return initialDir
}

/** El `aria-sort` del `<th>` de esa key: solo la columna ordenada dice algo distinto de `none`. */
export function ariaSort(
  current: SortState | null | undefined,
  key: string,
): 'ascending' | 'descending' | 'none' {
  if (!current || current.key !== key) return 'none'
  return current.dir === 'asc' ? 'ascending' : 'descending'
}

export type SortHrefOptions = {
  /** Default `orden`. */
  param?: string
  /**
   * El parámetro de la página, que se borra al cambiar el orden: la página 3
   * de otro orden no es nada. Default `page`; `false` lo deja como está.
   */
  pageParam?: string | false
  /** El orden por defecto de la página: si el link vuelve a él, la URL queda limpia. */
  fallback?: SortState
}

/** El link que deja la lista ordenada por `sort`, conservando el resto de los filtros. */
export function sortHref(
  pathname: string,
  searchParams: SearchParamsInput | undefined,
  sort: SortState,
  options: SortHrefOptions = {},
): string {
  const { param = SORT_PARAM, pageParam = PAGE_PARAM, fallback } = options
  const params = toSearchParams(searchParams)
  if (sameSort(sort, fallback)) params.delete(param)
  else params.set(param, formatSort(sort))
  if (pageParam !== false) params.delete(pageParam)
  return hrefWithParams(pathname, params)
}

/**
 * La función `sortHref` que espera `DataTable`, armada en la página (server):
 *
 * ```tsx
 * <DataTable sort={sort} sortHref={makeSortHref(`/${slug}/proveedores`, sp, { fallback })} … />
 * ```
 */
export function makeSortHref(
  pathname: string,
  searchParams: SearchParamsInput | undefined,
  options: SortHrefOptions = {},
): (key: string, dir: SortDir) => string {
  return (key, dir) => sortHref(pathname, searchParams, { key, dir }, options)
}

// ─── Orden en memoria (useTableSort) ─────────────────────────────────────────

export type SortValue = string | number | bigint | boolean | Date | null | undefined

/** Una función por key ordenable que devuelve el valor a comparar. */
export type SortAccessors<Row> = Readonly<Record<string, (row: Row) => SortValue>>

type PresentSortValue = Exclude<SortValue, null | undefined>

/** Faltante: `null`, `undefined`, `NaN` o una fecha inválida. Siempre va al final. */
function isMissing(value: SortValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return Number.isNaN(value)
  if (value instanceof Date) return Number.isNaN(value.getTime())
  return false
}

function isNumeric(value: unknown): value is number | bigint {
  return typeof value === 'number' || typeof value === 'bigint'
}

/**
 * Minúsculas y sin tildes, con la «ñ» después de la «n» (es una letra aparte
 * en castellano: «ñandú» va después de «nutria» y antes de «oca»).
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/ñ/g, 'n￿')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Dos tiras de dígitos por su valor, sin pasar por `Number` (no pierde precisión). */
function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, '')
  const y = b.replace(/^0+(?=\d)/, '')
  if (x.length !== y.length) return x.length < y.length ? -1 : 1
  if (x !== y) return x < y ? -1 : 1
  // Mismo valor («01» y «1»): primero el que tiene menos ceros adelante.
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

/**
 * Orden «natural» en castellano: sin tildes ni mayúsculas, «ñ» después de
 * «n» y los números por su valor («Mesa 2» antes de «Mesa 10»).
 */
export function compareText(a: string, b: string): number {
  const x = normalizeText(a).split(/(\d+)/)
  const y = normalizeText(b).split(/(\d+)/)
  const shared = Math.min(x.length, y.length)
  for (let i = 0; i < shared; i++) {
    const p = x[i] ?? ''
    const q = y[i] ?? ''
    if (p === q) continue
    // `split` con grupo de captura alterna texto (pares) y dígitos (impares).
    if (i % 2 === 1) return compareDigits(p, q)
    return p < q ? -1 : 1
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1
}

/** Compara dos valores presentes, en sentido ascendente. */
export function compareSortValues(a: PresentSortValue, b: PresentSortValue): number {
  if (typeof a === 'string' && typeof b === 'string') return compareText(a, b)
  if (a instanceof Date && b instanceof Date) return Math.sign(a.getTime() - b.getTime())
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  // `<` compara bien un bigint contra un number (el IVA en BigInt contra un conteo).
  if (isNumeric(a) && isNumeric(b)) return a < b ? -1 : a > b ? 1 : 0
  // Tipos mezclados: no debería pasar, pero el orden tiene que ser estable igual.
  return compareText(String(a), String(b))
}

/**
 * Una copia de `rows` ordenada por `sort`. Estable (los empates conservan el
 * orden de llegada) y con los faltantes siempre al final, en los dos sentidos:
 * «sin dato» no es ni el más chico ni el más grande. Con una key sin accessor
 * devuelve la copia sin tocar.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  accessors: SortAccessors<Row>,
  sort: SortState,
): Row[] {
  const accessor = Object.hasOwn(accessors, sort.key) ? accessors[sort.key] : undefined
  if (!accessor) return [...rows]
  const factor = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((x, y) => {
      const xMissing = isMissing(x.value)
      const yMissing = isMissing(y.value)
      if (xMissing || yMissing) {
        if (xMissing && yMissing) return x.index - y.index
        return xMissing ? 1 : -1
      }
      // Los dos están presentes: isMissing ya descartó null y undefined.
      const order = compareSortValues(x.value as PresentSortValue, y.value as PresentSortValue)
      return order === 0 ? x.index - y.index : order * factor
    })
    .map((entry) => entry.row)
}
