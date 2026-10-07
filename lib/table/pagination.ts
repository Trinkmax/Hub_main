/**
 * Paginación por URL de las listas del panel (kit HUB §3.6). Pura y
 * server-safe: la usa `<Pagination>` (que es server-safe) y la página que arma
 * la consulta con `.range(from, to)`.
 *
 * El parámetro sigue siendo `?page=N`, como en los tres paginadores escritos a
 * mano de hoy (clientes, registros de flows y reservas): los links viejos no
 * se rompen. La página 1 no escribe el parámetro (URL limpia).
 */

import { formatNumber } from '@/lib/format/number-kind'
import {
  firstParam,
  hrefWithParams,
  type SearchParamsInput,
  type SearchParamValue,
  toSearchParams,
} from './url'

/** El parámetro de la URL donde viaja la página. */
export const PAGE_PARAM = 'page'

/**
 * `?page=` → número de página (desde 1). Basura, negativos, decimales o
 * vacío → 1. Con `max`, no pasa de ahí (el último lote de la lista).
 */
export function parsePage(raw: SearchParamValue, options: { max?: number } = {}): number {
  const value = firstParam(raw)?.trim()
  if (!value || !/^\d+$/.test(value)) return 1
  const page = Number(value)
  if (!Number.isSafeInteger(page) || page < 1) return 1
  if (options.max === undefined) return page
  return Math.min(page, Math.max(1, Math.floor(options.max)))
}

/** Cantidad de páginas. Una lista vacía tiene una página (vacía), nunca cero. */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1
  return Math.ceil(total / pageSize)
}

/** La página dentro de 1…`count` (un link viejo a la página 40 de 29 muestra la 29). */
export function clampPage(page: number, count: number): number {
  const whole = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.min(Math.max(1, whole), Math.max(1, Math.floor(count)))
}

/**
 * Las filas de una página para PostgREST: `.range(from, to)` es de base 0 e
 * inclusivo.
 */
export function pageSlice(page: number, pageSize: number): { from: number; to: number } {
  const whole = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
  const size = Math.max(1, Math.floor(pageSize))
  const from = (whole - 1) * size
  return { from, to: from + size - 1 }
}

/** Primera y última fila visibles (desde 1). Con la lista vacía, `0` y `0`. */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { first: number; last: number } {
  if (!Number.isFinite(total) || total <= 0) return { first: 0, last: 0 }
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1
  const current = clampPage(page, pageCount(total, size))
  const first = (current - 1) * size + 1
  return { first, last: Math.min(total, current * size) }
}

/** «1–25 de 702» (miles con punto, raya corta). Una sola fila: «26 de 26». Vacía: «0 de 0». */
export function rangeLabel(page: number, pageSize: number, total: number): string {
  const { first, last } = pageRange(page, pageSize, total)
  if (first === 0) return '0 de 0'
  const span = first === last ? formatNumber(first) : `${formatNumber(first)}–${formatNumber(last)}`
  return `${span} de ${formatNumber(total)}`
}

export type PaginationItem = number | 'start-ellipsis' | 'end-ellipsis'

function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/**
 * Los números que se dibujan: los extremos, la actual con sus vecinas y «…»
 * donde se saltea. Siempre la misma cantidad de lugares (7 con los valores
 * por defecto): la fila no salta de ancho al cambiar de página.
 *
 * `paginationItems(15, 29)` → `[1, 'start-ellipsis', 14, 15, 16, 'end-ellipsis', 29]`
 */
export function paginationItems(
  page: number,
  count: number,
  options: { siblings?: number; boundaries?: number } = {},
): PaginationItem[] {
  const siblings = Math.max(0, Math.floor(options.siblings ?? 1))
  const boundaries = Math.max(1, Math.floor(options.boundaries ?? 1))
  const total = Math.max(1, Math.floor(count))
  const current = clampPage(page, total)
  // Lugares: extremos + vecinas + la actual + dos elipsis. Si entran todas, sin «…».
  if (total <= boundaries * 2 + siblings * 2 + 3) return range(1, total)

  const siblingsStart = Math.max(
    Math.min(current - siblings, total - boundaries - siblings * 2 - 1),
    boundaries + 2,
  )
  const siblingsEnd = Math.min(
    Math.max(current + siblings, boundaries + siblings * 2 + 2),
    total - boundaries - 1,
  )
  const start: PaginationItem[] =
    siblingsStart > boundaries + 2 ? ['start-ellipsis'] : [boundaries + 1]
  const end: PaginationItem[] =
    siblingsEnd < total - boundaries - 1 ? ['end-ellipsis'] : [total - boundaries]

  return [
    ...range(1, boundaries),
    ...start,
    ...range(siblingsStart, siblingsEnd),
    ...end,
    ...range(total - boundaries + 1, total),
  ]
}

export type PageHrefOptions = {
  /** Default `page`. */
  param?: string
}

/** El link a una página, conservando filtros y orden. La 1 saca el parámetro. */
export function pageHref(
  pathname: string,
  searchParams: SearchParamsInput | undefined,
  page: number,
  options: PageHrefOptions = {},
): string {
  const param = options.param ?? PAGE_PARAM
  const params = toSearchParams(searchParams)
  const whole = Number.isFinite(page) ? Math.floor(page) : 1
  if (whole <= 1) params.delete(param)
  else params.set(param, String(whole))
  return hrefWithParams(pathname, params)
}

/**
 * El `hrefFor` que espera `<Pagination>`, armado en la página (server):
 *
 * ```tsx
 * <Pagination page={page} pageSize={25} total={total} hrefFor={makePageHref(`/${slug}/clientes`, sp)} />
 * ```
 */
export function makePageHref(
  pathname: string,
  searchParams: SearchParamsInput | undefined,
  options: PageHrefOptions = {},
): (page: number) => string {
  return (page) => pageHref(pathname, searchParams, page, options)
}
