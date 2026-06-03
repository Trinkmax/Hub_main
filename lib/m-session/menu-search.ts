import type { ActiveSessionStateData } from './actions'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]

/** Búsqueda plana sobre toda la carta: nombre + descripción. */
export function searchMenuItems(categories: Category[], query: string): Item[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []
  const out: Item[] = []
  for (const cat of categories) {
    for (const it of cat.items) {
      const haystack = `${it.name} ${it.description ?? ''}`.toLowerCase()
      if (haystack.includes(q)) out.push(it)
    }
  }
  return out
}
