'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { sendOrder } from '@/lib/pos/actions'
import { backoffDelay, classifySend, entryOrderLines } from '@/lib/pos/order/outbox'
import {
  dropStoredEntry,
  isSessionOpen,
  listStoredOutboxes,
  newId,
  returnStoredEntry,
} from './order-storage'
import { useOnline } from './use-online'

/**
 * Manda las tandas que quedaron sin enviar en este celular, de CUALQUIER mesa.
 *
 * La pantalla de una mesa manda lo suyo mientras está abierta. Pero el mozo manda una tanda sin
 * señal y se va a atender otra mesa: «se envía sola cuando vuelva» tiene que ser verdad aunque esa
 * pantalla ya no esté. Este componente no dibuja nada; se monta donde el mozo esté (otra mesa, el
 * mapa) y, cuando hay red, saca lo pendiente con la misma clave con que se guardó: no duplica.
 *
 * Si el servidor dice que la tanda no va a entrar así (algo se agotó, la mesa se cerró), sus
 * renglones vuelven al borrador de esa mesa y se avisa de cuál era.
 */

const IDLE_MS = 30_000
/** Una tanda recién mandada todavía puede estar viajando desde la pantalla de su mesa: se le da un rato. */
const GRACE_MS = 6_000

/** Una sola recorrida a la vez, aunque el componente esté montado en dos lugares. */
let busy = false
/** Intentos fallidos por tanda, para ir espaciando los reintentos. */
const attempts = new Map<string, { count: number; nextAt: number }>()

async function flush(slug: string): Promise<number> {
  if (busy) return IDLE_MS
  busy = true
  let wait = IDLE_MS
  try {
    for (const pending of listStoredOutboxes()) {
      const { sessionId, head } = pending
      // Esa mesa tiene su pantalla abierta: la manda ella, y la muestra.
      if (isSessionOpen(sessionId)) continue
      const tried = attempts.get(head.key)
      const now = Date.now()
      const notBefore = Math.max(tried?.nextAt ?? 0, head.createdAt + GRACE_MS)
      if (notBefore > now) {
        wait = Math.min(wait, notBefore - now)
        continue
      }

      let result: Awaited<ReturnType<typeof sendOrder>> | null = null
      try {
        result = await sendOrder(slug, {
          sessionId,
          items: entryOrderLines(head),
          fire: head.fire,
          course: head.course,
          idempotencyKey: head.key,
        })
      } catch {
        result = null
      }
      const outcome = classifySend(result)
      const where = pending.label ?? 'Una mesa'

      if (outcome.kind === 'sent') {
        attempts.delete(head.key)
        dropStoredEntry(sessionId, head.key)
        toast.success(
          head.fire
            ? `${where}: salió la tanda que había quedado sin enviar`
            : `${where}: quedó cargada la tanda en espera`,
        )
        // Puede haber otra tanda de la misma mesa detrás: se sigue en la próxima vuelta, ya.
        if (pending.count > 1) wait = 0
      } else if (outcome.kind === 'reject') {
        attempts.delete(head.key)
        returnStoredEntry(sessionId, head, newId)
        toast.error(`${where}: ${outcome.message}`, {
          description: 'La tanda no entró. Quedó en el borrador de esa mesa para corregirla.',
          duration: 12_000,
        })
      } else {
        const count = (tried?.count ?? 0) + 1
        const delay = backoffDelay(count)
        attempts.set(head.key, { count, nextAt: Date.now() + delay })
        wait = Math.min(wait, delay)
      }
    }
  } finally {
    busy = false
  }
  return wait
}

export function PosOutboxRunner({ slug }: { slug: string }) {
  const online = useOnline()

  useEffect(() => {
    if (!online) return
    let stopped = false
    let timer: number | null = null

    const run = async () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      const wait = await flush(slug)
      if (!stopped) timer = window.setTimeout(run, Math.max(250, wait))
    }
    const onVisible = () => {
      if (!document.hidden) void run()
    }

    void run()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [online, slug])

  return null
}
