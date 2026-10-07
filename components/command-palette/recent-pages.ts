import { matchesPath } from '@/components/shell/nav-active'
import type { CommandEntry } from './command-config'

/**
 * «Recientes» de ⌘K (§4.4): las últimas páginas que abrió esta persona en este
 * bar, en este navegador.
 *
 * - Se guarda el `id` de la entrada de la paleta, no la URL: no quedan ids de
 *   clientes ni de comprobantes en el navegador, y al mostrarla se vuelve a
 *   chequear contra lo que esa persona puede ver hoy (rol, flags, acceso a
 *   Administración). Lo que ya no ve, no aparece.
 * - Es una comodidad por persona: `localStorage`, siempre envuelto en
 *   try/catch (en una ventana privada o con el storage bloqueado tira), y si
 *   no hay nada la paleta se ve igual.
 */

export const RECENT_LIMIT = 5

/** Uno de más: la página abierta no se muestra (ir adonde ya estás no sirve). */
const STORED_LIMIT = RECENT_LIMIT + 1

const STORAGE_PREFIX = 'hub:cmdk:recientes:'

export function recentStorageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug}`
}

/** Lo guardado → ids sin repetir. Cualquier cosa rara → lista vacía. */
export function parseRecentIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const ids: string[] = []
    for (const value of parsed) {
      if (typeof value === 'string' && value && !ids.includes(value)) ids.push(value)
      if (ids.length === STORED_LIMIT) break
    }
    return ids
  } catch {
    return []
  }
}

/** La más nueva primero, sin repetir, con tope. */
export function pushRecentId(ids: ReadonlyArray<string>, id: string): string[] {
  return [id, ...ids.filter((existing) => existing !== id)].slice(0, STORED_LIMIT)
}

export function readRecentIds(slug: string): string[] {
  try {
    return parseRecentIds(window.localStorage.getItem(recentStorageKey(slug)))
  } catch {
    return []
  }
}

export function writeRecentIds(slug: string, ids: ReadonlyArray<string>): void {
  try {
    window.localStorage.setItem(recentStorageKey(slug), JSON.stringify(ids))
  } catch {
    // sin storage no hay «Recientes»; la paleta anda igual
  }
}

/**
 * La página de la paleta que corresponde a esta ruta: la de path más largo
 * que la contiene (`/hub/clientes/abc` → «Personas»). Solo páginas
 * (`navigate`), nunca acciones ni hojas. El inicio del bar (`/hub`) matchea
 * solo exacto: si no, sería el prefijo de todo.
 */
export function pageEntryForPath(
  pathname: string,
  slug: string,
  entries: ReadonlyArray<CommandEntry>,
): CommandEntry | null {
  const root = `/${slug}`
  let best: CommandEntry | null = null
  let bestLength = 0
  for (const entry of entries) {
    if (entry.type !== 'navigate' || entry.sheetAction) continue
    const path = entry.href(slug).split('?')[0] ?? ''
    if (!path) continue
    const matches = path === root ? pathname === root : matchesPath(pathname, path)
    if (matches && path.length > bestLength) {
      best = entry
      bestLength = path.length
    }
  }
  return best
}

/**
 * Los ids guardados → las entradas que esta persona puede ver hoy (las
 * `entries` ya vienen filtradas), sin la página abierta y con tope.
 */
export function recentEntries(
  ids: ReadonlyArray<string>,
  entries: ReadonlyArray<CommandEntry>,
  currentId?: string | null,
): CommandEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const out: CommandEntry[] = []
  for (const id of ids) {
    if (id === currentId) continue
    const entry = byId.get(id)
    if (entry && entry.type === 'navigate' && !entry.sheetAction) out.push(entry)
    if (out.length === RECENT_LIMIT) break
  }
  return out
}
