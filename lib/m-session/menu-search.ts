import type { ActiveSessionStateData } from './actions'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]
export type SearchHit = Item & { path: string }

/**
 * Búsqueda plana sobre toda la carta: nombre + descripción. Cada resultado lleva
 * la ruta completa de su categoría ("Bebidas › Vinos") para desambiguar ítems
 * homónimos en distintas subcategorías. `get_session_state` devuelve TODAS las
 * categorías (de cualquier nivel) con sus ítems directos, así que recorrerlas
 * planas alcanza todos los ítems.
 */
export function searchMenuItems(categories: Category[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []

  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const parentById = new Map(categories.map((c) => [c.id, c.parent_id]))
  const pathOf = (id: string): string => {
    const parts: string[] = []
    let cur: string | null = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      parts.unshift(nameById.get(cur) ?? '')
      cur = parentById.get(cur) ?? null
    }
    return parts.filter(Boolean).join(' › ')
  }

  const out: SearchHit[] = []
  for (const cat of categories) {
    const path = pathOf(cat.id)
    for (const it of cat.items) {
      const haystack = `${it.name} ${it.description ?? ''}`.toLowerCase()
      if (haystack.includes(q)) out.push({ ...it, path })
    }
  }
  return out
}
