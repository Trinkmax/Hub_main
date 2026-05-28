import type { SalonTableRow } from './queries'

/**
 * Normaliza un string para comparación case-insensitive y sin acentos.
 * "María Núñez" → "maria nunez"
 */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Devuelve true si la mesa matchea el query del buscador.
 * Matchea contra: label (número de mesa), alias (si la sesión tiene), y nombres
 * de customers asociados a la sesión activa. Query vacío → siempre true.
 */
export function matchesQuery(table: SalonTableRow, query: string): boolean {
  const q = normalize(query)
  if (q.length === 0) return true

  if (normalize(table.label).includes(q)) return true

  const sess = table.session
  if (sess) {
    if (sess.alias && normalize(sess.alias).includes(q)) return true
    for (const name of sess.customer_names) {
      if (normalize(name).includes(q)) return true
    }
  }
  return false
}

export function filterTables(tables: SalonTableRow[], query: string): SalonTableRow[] {
  const q = normalize(query)
  if (q.length === 0) return tables
  return tables.filter((t) => matchesQuery(t, q))
}
