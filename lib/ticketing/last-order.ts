/**
 * La última compra que salió a Mercado Pago desde este celular. Si Mercado Pago la
 * rechaza y la persona vuelve con «Atrás» o abre de nuevo la película, no llega a su
 * entrada, que es donde está cómo transferir: esto le deja el link a mano.
 *
 * Solo una conveniencia: sin almacenamiento (modo privado) no aparece el link y nada más.
 */
const KEY = 'hub-entradas-last-order'
// Más que el lugar guardado: después de vencerse todavía puede estar transfiriendo.
const MAX_AGE_MS = 3 * 60 * 60_000

export function saveLastOrder(film: string, id: string, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ film, id, at: now }))
  } catch {
    // Almacenamiento bloqueado.
  }
}

export function readLastOrder(film: string, now: number = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as { film?: unknown; id?: unknown; at?: unknown }
    if (stored.film !== film || typeof stored.id !== 'string' || typeof stored.at !== 'number') {
      return null
    }
    return now - stored.at <= MAX_AGE_MS ? stored.id : null
  } catch {
    return null
  }
}

export function clearLastOrder(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Almacenamiento bloqueado.
  }
}
