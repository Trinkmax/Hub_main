/**
 * Utilidades de URL para las listas del panel (kit HUB §3.6). Puras y
 * server-safe: las usan el orden y la paginación por link, que se arman en el
 * Server Component de la página a partir de sus `searchParams`.
 *
 * Por qué viven acá y no en cada página: hoy hay tres paginadores escritos a
 * mano (clientes, registros de flows, reservas) que copian los parámetros de
 * a uno y se olvidan de los repetidos (`?tag=a&tag=b`). Un solo lugar que los
 * copie bien.
 */

/** Lo que trae un parámetro en el `searchParams` de una página de Next. */
export type SearchParamValue = string | readonly string[] | null | undefined

/**
 * Los `searchParams` (ya resueltos) de una página, o un `URLSearchParams`.
 * En Next 16 la página los recibe como `Promise`: se pasan después del `await`.
 */
export type SearchParamsInput =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>

/** El primer valor de un parámetro (`?page=2&page=3` → `'2'`). */
export function firstParam(value: SearchParamValue): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  return value[0]
}

/**
 * Copia los parámetros a un `URLSearchParams` nuevo. Los repetidos se copian
 * todos (un filtro múltiple sobrevive al cambio de página) y los `undefined`
 * no se escriben. Nunca muta la entrada.
 */
export function toSearchParams(input: SearchParamsInput | undefined): URLSearchParams {
  if (input === undefined) return new URLSearchParams()
  if (input instanceof URLSearchParams) return new URLSearchParams(input)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (typeof value === 'string') params.append(key, value)
    else for (const item of value) params.append(key, item)
  }
  return params
}

/** `pathname` + `?query`, sin el `?` colgado cuando no queda ningún parámetro. */
export function hrefWithParams(pathname: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
