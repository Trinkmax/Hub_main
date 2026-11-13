import { cartReducer, type Draft } from '@/lib/pos/order/cart'
import {
  entryDraftLines,
  isDisposable,
  type OutboxEntry,
  restoreOrder,
  STORAGE_PREFIX,
  type StoredOrder,
  serializeOrder,
  storageKey,
} from '@/lib/pos/order/outbox'

/**
 * Lo que no llegó al servidor, guardado en el celular (por mesa abierta). Acá vive lo único que toca
 * `localStorage`; qué se guarda y cómo se lee lo decide `lib/pos/order/outbox.ts`.
 *
 * Nada de esto puede romper la pantalla: en modo privado o con el disco lleno, `localStorage` tira
 * error. Se sigue sin guardar (la tanda igual viaja; lo que se pierde es la red de seguridad).
 */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento: ver arriba.
  }
}

export function readStoredOrder(sessionId: string): StoredOrder {
  return restoreOrder(read(storageKey(sessionId)), Date.now())
}

export function writeStoredOrder(sessionId: string, order: StoredOrder): void {
  write(storageKey(sessionId), serializeOrder(order, Date.now()))
}

/** El servidor confirmó una tanda: sale de lo guardado aunque la pantalla ya no esté abierta. */
export function dropStoredEntry(sessionId: string, key: string): void {
  const stored = readStoredOrder(sessionId)
  if (!stored.outbox.some((entry) => entry.key === key)) return
  writeStoredOrder(sessionId, { ...stored, outbox: stored.outbox.filter((e) => e.key !== key) })
}

/**
 * El servidor rebotó una tanda y la pantalla ya no está para recibirla: sus renglones vuelven al
 * borrador guardado, así la próxima vez que se abra la mesa están ahí para corregir.
 */
export function returnStoredEntry(
  sessionId: string,
  entry: OutboxEntry,
  newId: () => string,
): void {
  const stored = readStoredOrder(sessionId)
  const draft: Draft = cartReducer(stored.draft, {
    type: 'add_many',
    draftKey: newId(),
    lines: entryDraftLines(entry).map((line) => ({ ...line, lineKey: newId() })),
  })
  writeStoredOrder(sessionId, {
    ...stored,
    draft,
    outbox: stored.outbox.filter((e) => e.key !== entry.key),
  })
}

export type StoredOutbox = {
  sessionId: string
  /** «Mesa 12», si se guardó. */
  label: string | null
  /** La tanda que sigue para salir de esa mesa. */
  head: OutboxEntry
  /** Cuántas tandas tiene esa mesa sin enviar. */
  count: number
}

/**
 * Las mesas que tienen tandas sin enviar guardadas en este celular. Es lo que recorre el que las
 * manda desde cualquier pantalla (`PosOutboxRunner`) y lo que puede mostrar el mapa.
 */
export function listStoredOutboxes(): StoredOutbox[] {
  const found: StoredOutbox[] = []
  try {
    const now = Date.now()
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      const stored = restoreOrder(window.localStorage.getItem(key), now)
      const head = stored.outbox[0]
      if (!head) continue
      found.push({
        sessionId: key.slice(STORAGE_PREFIX.length),
        label: stored.label ?? null,
        head,
        count: stored.outbox.length,
      })
    }
  } catch {
    // Sin almacenamiento no hay nada guardado.
  }
  return found.sort((a, b) => a.head.createdAt - b.head.createdAt)
}

/**
 * Las mesas que tienen su pantalla abierta ahora: esa pantalla manda lo suyo (y lo muestra), así que
 * el que manda «desde cualquier lado» no las toca.
 */
const openSessions = new Map<string, number>()

export function claimSession(sessionId: string): () => void {
  openSessions.set(sessionId, (openSessions.get(sessionId) ?? 0) + 1)
  return () => {
    const left = (openSessions.get(sessionId) ?? 1) - 1
    if (left <= 0) openSessions.delete(sessionId)
    else openSessions.set(sessionId, left)
  }
}

export function isSessionOpen(sessionId: string): boolean {
  return openSessions.has(sessionId)
}

/** Limpia lo guardado de mesas viejas (nunca lo que tenga una tanda sin enviar). */
export function sweepStoredOrders(keepSessionId: string): void {
  try {
    const keep = storageKey(keepSessionId)
    const now = Date.now()
    const stale: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || key === keep || !key.startsWith(STORAGE_PREFIX)) continue
      if (isDisposable(window.localStorage.getItem(key), now)) stale.push(key)
    }
    for (const key of stale) window.localStorage.removeItem(key)
  } catch {
    // Sin almacenamiento: no hay nada que limpiar.
  }
}

/** Claves nuevas (idempotencia de la tanda, identidad de un renglón). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // `randomUUID` solo existe en contextos seguros (https o localhost): un celular entrando por la IP
  // de la red, en desarrollo, no lo tiene.
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
