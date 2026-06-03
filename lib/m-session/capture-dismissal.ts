'use client'

// Persistencia client-side del "No por ahora". Keyed por sessionId: una sesión
// nueva (nuevo session_id) vuelve a invitar. Storage inyectable para tests.

const PREFIX = 'hub:capture'

export type CaptureMoment = 'sheet' | 'postorder'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function captureKey(moment: CaptureMoment, sessionId: string): string {
  return `${PREFIX}:${moment}:${sessionId}`
}

function resolveStore(store?: StorageLike): StorageLike | null {
  if (store) return store
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function isCaptureSeen(
  moment: CaptureMoment,
  sessionId: string,
  store?: StorageLike,
): boolean {
  const s = resolveStore(store)
  if (!s || !sessionId) return false
  try {
    return s.getItem(captureKey(moment, sessionId)) === '1'
  } catch {
    return false
  }
}

export function markCaptureSeen(
  moment: CaptureMoment,
  sessionId: string,
  store?: StorageLike,
): void {
  const s = resolveStore(store)
  if (!s || !sessionId) return
  try {
    s.setItem(captureKey(moment, sessionId), '1')
  } catch {
    // localStorage lleno o deshabilitado (modo privado) → degradar a no-op.
  }
}
