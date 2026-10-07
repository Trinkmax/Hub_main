/**
 * Páginas de los libros largos (diario, mayor, IVA, subdiarios, historia):
 * las lecturas paginan por keyset (`?despues=` con el cursor de la última
 * fila, §F.0), así que no hay «página 3» directa: se avanza con «Siguiente»,
 * se vuelve a la primera y el «atrás» del navegador vuelve a la anterior.
 * Puro (lo prueban los tests).
 */

export type KeysetPageInfo = {
  /** Número de esta página (1 la primera). */
  page: number
  /** Páginas en total (≥ 1). */
  totalPages: number
  /** Primera y última fila de esta página (1-based); `0` y `0` si no hay filas. */
  firstRow: number
  lastRow: number
  isFirst: boolean
}

/**
 * Dónde está la página que se muestra. `seenBefore` = filas vistas antes de
 * esta (el `seen` del `?despues=`), `rows` = filas de esta página (sin el
 * «Saldo anterior»), `pageSize` = el límite fijo de ese libro.
 */
export function keysetPageInfo(input: {
  seenBefore: number
  rows: number
  totalRows: number
  pageSize: number
}): KeysetPageInfo {
  const size = Math.max(1, Math.trunc(input.pageSize))
  const seenBefore = Math.max(0, Math.trunc(input.seenBefore))
  const rows = Math.max(0, Math.trunc(input.rows))
  const total = Math.max(seenBefore + rows, Math.trunc(input.totalRows))
  const page = Math.floor(seenBefore / size) + 1
  const totalPages = Math.max(page, Math.ceil(total / size), 1)
  return {
    page,
    totalPages,
    firstRow: rows === 0 ? 0 : seenBefore + 1,
    lastRow: rows === 0 ? 0 : seenBefore + rows,
    isFirst: seenBefore === 0,
  }
}
