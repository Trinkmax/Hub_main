'use client'

import { useCallback, useEffect, useRef } from 'react'
import { saveGeometryAction } from '@/lib/floor-plan/actions'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'

const GEOMETRY_FLUSH_MS = 600

export type GeometryQueue = {
  enqueue: (geom: ElementGeometry) => void
  flushNow: () => Promise<void>
}

/**
 * Cola única de persistencia de geometría. drag-end y resize-end encolan acá
 * (nunca dos escritores en paralelo). Flush por debounce (600ms) y en
 * beforeunload. Si el flush falla, onError(ids) deja que el editor revierta el
 * estado optimista de esos ids y muestre un toast.
 */
export function useGeometryQueue(slug: string, onError: (ids: string[]) => void): GeometryQueue {
  // Cola viva entre renders.
  const queueRef = useRef<Map<string, ElementGeometry>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onError fresco sin re-suscribir el beforeunload ni recrear flushNow.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const flushNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const queue = queueRef.current
    if (queue.size === 0) return
    // Snapshot + vaciado: si llegan nuevos encolados durante el await, se
    // persisten en el próximo flush.
    const items = Array.from(queue.values())
    const ids = items.map((it) => it.id)
    queue.clear()
    try {
      const result = await saveGeometryAction(slug, items)
      if (!result.ok) onErrorRef.current(ids)
    } catch {
      onErrorRef.current(ids)
    }
  }, [slug])

  const enqueue = useCallback(
    (geom: ElementGeometry) => {
      queueRef.current.set(geom.id, geom)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void flushNow()
      }, GEOMETRY_FLUSH_MS)
    },
    [flushNow],
  )

  // Flush best-effort al salir / esconder la pestaña.
  useEffect(() => {
    const handler = () => {
      void flushNow()
    }
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [flushNow])

  return { enqueue, flushNow }
}
