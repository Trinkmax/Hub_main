/**
 * Búsqueda de los combos de Administración (proveedores, cuentas), pura:
 * sin tildes, sin mayúsculas, y el orden que espera la gente (empieza con →
 * empieza una palabra → contiene).
 */

/** «Señas Ñandú» → «senas nandu». */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 0 = empieza con · 1 = empieza una palabra · 2 = contiene · −1 = no está. */
export function rankText(haystack: string, needle: string): number {
  if (!needle) return 0
  const h = normalizeText(haystack)
  if (h.startsWith(needle)) return 0
  if (h.includes(` ${needle}`) || h.includes(`-${needle}`) || h.includes(`(${needle}`)) return 1
  return h.includes(needle) ? 2 : -1
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, '')
}

export type PartySearchable = {
  name: string
  tradeName?: string | null
  taxId?: string | null
}

/**
 * Proveedor o cliente: por razón social, nombre de fantasía o CUIT (con o sin
 * guiones, desde 2 dígitos). −1 si no coincide.
 */
export function rankParty(option: PartySearchable, query: string): number {
  const q = normalizeText(query)
  if (!q) return 0
  const ranks: number[] = []
  for (const text of [option.name, option.tradeName]) {
    if (!text) continue
    const r = rankText(text, q)
    if (r >= 0) ranks.push(r)
  }
  // Un CUIT se busca con números (y quizá guiones o puntos): «30-71», «3071876».
  const qDigits = digitsOf(q)
  if (option.taxId && qDigits.length >= 2 && /^[\d\s.-]+$/.test(q)) {
    const tax = digitsOf(option.taxId)
    if (tax.startsWith(qDigits)) ranks.push(0)
    else if (tax.includes(qDigits)) ranks.push(2)
  }
  return ranks.length > 0 ? Math.min(...ranks) : -1
}

export type AccountSearchable = { code: string; name: string }

/**
 * Cuenta: por código («1101» encuentra 1.1.01, «1.1» trae ese rubro) o por
 * nombre. Los códigos van primero. −1 si no coincide.
 */
export function rankAccount(option: AccountSearchable, query: string): number {
  const q = normalizeText(query)
  if (!q) return 0
  if (/^[\d.\s]+$/.test(q)) {
    const typed = q.replace(/\s/g, '')
    if (typed.includes('.')) {
      if (option.code === typed) return 0
      return option.code.startsWith(typed) ? 1 : -1
    }
    const compact = option.code.replace(/\./g, '')
    if (compact === typed) return 0
    return compact.startsWith(typed) ? 1 : -1
  }
  const r = rankText(option.name, q)
  return r < 0 ? -1 : 2 + r
}

/** Filtra y ordena (estable) por el rank; `limit` corta la lista visible. */
export function rankAndFilter<T>(
  items: readonly T[],
  query: string,
  rank: (item: T, query: string) => number,
  limit = 60,
): T[] {
  return items
    .map((item, index) => ({ item, index, r: rank(item, query) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.item)
}
