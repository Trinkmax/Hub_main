'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { sendOrder } from '@/lib/pos/actions'
import { cartReducer, EMPTY_DRAFT } from '@/lib/pos/order/cart'
import {
  afterFailure,
  classifySend,
  entryDraftLines,
  entryOrderLines,
  nextSend,
  type OutboxEntry,
  retryNow,
} from '@/lib/pos/order/outbox'
import {
  claimSession,
  dropStoredEntry,
  newId,
  readStoredOrder,
  returnStoredEntry,
  sweepStoredOrders,
  writeStoredOrder,
} from './order-storage'

type Sent = { ticketId: string; totalCents: number; fired: boolean; duplicate: boolean }

type Options = {
  slug: string
  sessionId: string
  /** «Mesa 12»: se guarda con lo pendiente, para poder nombrarla desde otra pantalla. */
  label: string
  /** Si el celular dice que tiene red. Sin red no se intenta: se espera a que vuelva. */
  online: boolean
  /** El servidor tiene la tanda. */
  onSent: (entry: OutboxEntry, sent: Sent) => void
  /** El servidor dijo «así no»: la tanda no va a entrar tal como está (ya volvió al borrador). */
  onRejected: (entry: OutboxEntry, message: string, code: string) => void
}

/**
 * La tanda que se está armando y las que todavía no confirmó el servidor, guardadas en el celular.
 *
 * - El borrador y la bandeja de salida se leen al abrir la mesa y se guardan en cada cambio.
 * - Mandar una tanda la escribe en el disco ANTES de intentar nada: si la pantalla se cierra en ese
 *   instante, al volver a abrir la mesa sale sola.
 * - Las tandas salen de a una, en orden, con su clave. Si la llamada no vuelve o el servidor falla
 *   con algo pasajero, se reintenta con espera creciente; reintentar nunca duplica.
 */
export function useLocalOrder(options: Options) {
  const { slug, sessionId, label, online } = options
  const [draft, dispatch] = useReducer(cartReducer, EMPTY_DRAFT)
  const [outbox, setOutbox] = useState<OutboxEntry[]>([])
  const [restored, setRestored] = useState(false)
  /** La tanda que está viajando ahora. */
  const [flying, setFlying] = useState<string | null>(null)
  /** Reloj de la bandeja: cada vez que avanza, se vuelve a mirar qué toca. */
  const [clock, setClock] = useState(() => Date.now())

  const inFlight = useRef<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Mientras esta pantalla esté abierta, lo pendiente de esta mesa lo manda ella (ver `PosOutboxRunner`).
  useEffect(() => claimSession(sessionId), [sessionId])

  // Al abrir la mesa: lo que había quedado.
  useEffect(() => {
    const stored = readStoredOrder(sessionId)
    if (stored.draft.lines.length > 0) dispatch({ type: 'restore', draft: stored.draft })
    if (stored.outbox.length > 0) setOutbox(stored.outbox)
    setRestored(true)
    setClock(Date.now())
    sweepStoredOrders(sessionId)
  }, [sessionId])

  // En cada cambio: al disco. (No antes de leer: se pisaría lo guardado con un borrador vacío.)
  useEffect(() => {
    if (restored) writeStoredOrder(sessionId, { draft, outbox, label })
  }, [restored, sessionId, label, draft, outbox])

  /** Lo que estaba esperando su turno sale ya (volvió la red, volvió la pantalla, o lo pidió el mozo). */
  const retry = useCallback(() => {
    setOutbox((list) => (list.length > 0 ? retryNow(list, Date.now()) : list))
    setClock(Date.now())
  }, [])

  useEffect(() => {
    if (online) retry()
  }, [online, retry])

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) retry()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [retry])

  // La bandeja de salida.
  useEffect(() => {
    if (!restored) return
    const decision = nextSend(outbox, { now: clock, online, inFlight: inFlight.current !== null })
    if (decision.kind === 'idle') return
    if (decision.kind === 'wait') {
      const timer = window.setTimeout(() => setClock(Date.now()), decision.ms + 25)
      return () => window.clearTimeout(timer)
    }

    const entry = decision.entry
    inFlight.current = entry.key
    setFlying(entry.key)
    void (async () => {
      let result: Awaited<ReturnType<typeof sendOrder>> | null = null
      try {
        result = await sendOrder(slug, {
          sessionId,
          items: entryOrderLines(entry),
          fire: entry.fire,
          course: entry.course,
          idempotencyKey: entry.key,
        })
      } catch {
        // La llamada no volvió: sin señal o se cortó en el camino. Puede haber llegado o no; la clave
        // hace que el reintento devuelva la misma tanda si llegó.
        result = null
      }
      const outcome = classifySend(result)
      inFlight.current = null

      if (outcome.kind === 'retry') {
        if (mounted.current) {
          setOutbox((list) =>
            list.map((e) => (e.key === entry.key ? afterFailure(e, outcome, Date.now()) : e)),
          )
        }
      } else if (outcome.kind === 'sent') {
        // Del disco sale ya, aunque la pantalla se haya cerrado mientras viajaba.
        dropStoredEntry(sessionId, entry.key)
        if (mounted.current) {
          setOutbox((list) => list.filter((e) => e.key !== entry.key))
          if (result?.ok) latest.current.onSent(entry, result.data)
        }
      } else if (mounted.current) {
        // «Así no»: los renglones vuelven al borrador (junto con lo que ya hubiera) para corregirlos.
        setOutbox((list) => list.filter((e) => e.key !== entry.key))
        dispatch({
          type: 'add_many',
          draftKey: newId(),
          lines: entryDraftLines(entry).map((line) => ({ ...line, lineKey: newId() })),
        })
        latest.current.onRejected(entry, outcome.message, outcome.code)
      } else {
        // Nadie mirando: los renglones vuelven al borrador guardado, para corregirlos al volver.
        returnStoredEntry(sessionId, entry, newId)
      }

      if (mounted.current) {
        setFlying(null)
        setClock(Date.now())
      }
    })()
  }, [restored, outbox, online, clock, slug, sessionId])

  /** Manda una tanda: primero al disco, después a la bandeja. El borrador queda vacío. */
  const enqueue = useCallback(
    (entry: OutboxEntry) => {
      const stored = readStoredOrder(sessionId)
      writeStoredOrder(sessionId, {
        draft: EMPTY_DRAFT,
        outbox: [...stored.outbox.filter((e) => e.key !== entry.key), entry],
        label,
      })
      setOutbox((list) => [...list.filter((e) => e.key !== entry.key), entry])
      dispatch({ type: 'clear' })
      setClock(Date.now())
    },
    [sessionId, label],
  )

  return { draft, dispatch, outbox, flying, restored, enqueue, retry }
}
