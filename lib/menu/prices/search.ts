/**
 * El buscador de «Precios», puro: sin tildes ni mayúsculas, por nombre y por el camino de
 * la categoría («pizza» trae todas las pizzas aunque el producto se llame «Muzza»).
 *
 * Corre en el navegador sobre la carta ya cargada: tipear filtra al instante.
 */

const DIACRITICS = /[̀-ͯ]/g

/** «Ñoquis  de Papa» → «noquis de papa». */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Las palabras de lo que se tipeó, ya normalizadas. Vacío = no se está buscando. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearch(query)
  return normalized === '' ? [] : normalized.split(' ')
}

export type SearchDoc = {
  id: string
  name: string
  /** El camino de la categoría: «Comida › Hamburguesas». */
  path: string
}

export type SearchIndexEntry = { id: string; name: string; path: string; order: number }
export type SearchIndex = ReadonlyArray<SearchIndexEntry>

/** Normaliza una vez; el orden de entrada (el de la carta) desempata los resultados. */
export function buildSearchIndex(docs: ReadonlyArray<SearchDoc>): SearchIndex {
  return docs.map((doc, order) => ({
    id: doc.id,
    name: normalizeSearch(doc.name),
    path: normalizeSearch(doc.path),
    order,
  }))
}

const WORD_CHAR = /[a-z0-9]/

/** 0 = empieza con · 1 = empieza una palabra · 2 = está adentro · −1 = no está. */
function rankIn(haystack: string, token: string): number {
  let at = haystack.indexOf(token)
  if (at === -1) return -1
  if (at === 0) return 0
  while (at !== -1) {
    if (!WORD_CHAR.test(haystack.charAt(at - 1))) return 1
    at = haystack.indexOf(token, at + 1)
  }
  return 2
}

/**
 * Los productos que coinciden, del mejor al peor. Cada palabra tiene que estar en el nombre
 * o en la categoría; coincidir en el nombre pesa más. `null` = no hay búsqueda (se muestra la
 * carta entera, agrupada).
 */
export function searchPrices(index: SearchIndex, query: string): string[] | null {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return null
  const hits: Array<{ id: string; score: number; order: number }> = []
  for (const entry of index) {
    let score = 0
    let matches = true
    for (const token of tokens) {
      const inName = rankIn(entry.name, token)
      if (inName >= 0) {
        score += inName
        continue
      }
      const inPath = rankIn(entry.path, token)
      if (inPath < 0) {
        matches = false
        break
      }
      score += 3 + inPath
    }
    if (matches) hits.push({ id: entry.id, score, order: entry.order })
  }
  hits.sort((a, b) => a.score - b.score || a.order - b.order)
  return hits.map((hit) => hit.id)
}

/**
 * Dónde está lo buscado dentro de un texto, en posiciones del texto ORIGINAL (con tildes y
 * mayúsculas), para resaltarlo. Los tramos vienen ordenados y sin pisarse.
 */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const tokens = searchTokens(query)
  if (tokens.length === 0 || text === '') return []

  // El texto sin tildes, letra por letra, recordando de qué posición original salió cada una
  // (una letra puede volverse dos o ninguna al sacarle la tilde).
  let plain = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = text.charAt(i).normalize('NFD').replace(DIACRITICS, '').toLowerCase()
    for (const char of piece) {
      plain += /\s/.test(char) ? ' ' : char
      origin.push(i)
    }
  }

  const found: Array<[number, number]> = []
  for (const token of tokens) {
    let at = plain.indexOf(token)
    while (at !== -1) {
      const start = origin[at]
      const last = origin[at + token.length - 1]
      if (start !== undefined && last !== undefined) found.push([start, last + 1])
      at = plain.indexOf(token, at + token.length)
    }
  }
  if (found.length === 0) return []

  found.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const [start, end] of found) {
    const previous = merged[merged.length - 1]
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }
  return merged
}
