'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buzz } from '@/components/pos/order/haptics'
import type { ApprovalStatus, InboxApproval } from '@/lib/pos/cash/types'
import type { ApprovalsApi } from './approvals-api'

/**
 * Contestar un pedido, con las reglas del punto de venta puestas en un solo lugar (las usan la
 * bandeja y la cuenta):
 *
 *   · Aprobar un descuento: un toque, viaja ya. Se puede deshacer: se quita el descuento.
 *   · Rechazar, o retirar un pedido propio: un toque. Viaja a los cinco segundos; hasta entonces se
 *     deshace sin que haya pasado nada. Si la pantalla se cierra o se esconde, viaja en el momento.
 *   · Aprobar una baja: no tiene vuelta, así que primero se pregunta.
 */

/** En qué anda un pedido que alguien tocó. */
export type ApprovalAct =
  /** Aprobar una baja: esperando el «sí». */
  | { kind: 'confirm' }
  | { kind: 'busy' }
  /** Rechazado o retirado, pero todavía no viajó: se puede deshacer. */
  | { kind: 'grace'; status: 'rejected' | 'cancelled' }
  | { kind: 'done'; status: Exclude<ApprovalStatus, 'pending'>; undo: boolean }
  /** Se había aprobado un descuento y se deshizo. */
  | { kind: 'undone' }
  | { kind: 'error'; message: string }

export type ApprovalEntry = { approval: InboxApproval; act: ApprovalAct }
export type ApprovalActs = Readonly<Record<string, ApprovalEntry>>

/** Cuánto se puede deshacer un «rechazar» antes de que viaje. */
export const GRACE_MS = 5000

type Failure = { ok: false; message: string; code: string }
const NO_SIGNAL: Failure = {
  ok: false,
  message: 'No hay señal: no se contestó. Probá de nuevo cuando vuelva.',
  code: 'network',
}

/** Ya está contestado (o por viajar): no cuenta como «esperando». */
export function isSettled(act: ApprovalAct | null | undefined): boolean {
  return act?.kind === 'grace' || act?.kind === 'done' || act?.kind === 'undone'
}

export function useApprovalActs(
  api: ApprovalsApi,
  /** Algo se contestó de verdad: quien aloja vuelve a leer lo suyo. */
  onChanged: () => void,
) {
  // El estado manda en el dibujo; la referencia, en las decisiones (un toque tiene que leer lo
  // último, no lo que había cuando se dibujó).
  const [acts, setActs] = useState<ApprovalActs>({})
  const current = useRef<ApprovalActs>({})
  /** Los «rechazar» que todavía no viajaron. */
  const waiting = useRef(new Map<string, { timer: number; approval: InboxApproval }>())
  const latest = useRef({ api, onChanged })
  useEffect(() => {
    latest.current = { api, onChanged }
  })

  const write = useCallback((next: ApprovalActs) => {
    current.current = next
    setActs(next)
  }, [])

  const setAct = useCallback(
    (approval: InboxApproval, act: ApprovalAct | null) => {
      const { [approval.id]: _previous, ...rest } = current.current
      write(act === null ? rest : { ...rest, [approval.id]: { approval, act } })
    },
    [write],
  )

  const decide = useCallback(
    async (approval: InboxApproval, approve: boolean) => {
      setAct(approval, { kind: 'busy' })
      let result: Awaited<ReturnType<ApprovalsApi['decide']>>
      try {
        result = await latest.current.api.decide({ approvalId: approval.id, approve })
      } catch {
        result = NO_SIGNAL
      }
      if (!result.ok) {
        setAct(approval, { kind: 'error', message: result.message })
        return
      }
      const { status } = result.data
      setAct(approval, {
        kind: 'done',
        status: status === 'pending' ? 'cancelled' : status,
        undo: approve && status === 'approved' && approval.kind === 'discount',
      })
      latest.current.onChanged()
    },
    [setAct],
  )

  const commit = useCallback(
    (approval: InboxApproval) => {
      const entry = waiting.current.get(approval.id)
      if (!entry) return
      window.clearTimeout(entry.timer)
      waiting.current.delete(approval.id)
      void decide(approval, false)
    },
    [decide],
  )

  /** Lo que quedó «por deshacer» viaja ya. */
  const flush = useCallback(() => {
    for (const { approval } of [...waiting.current.values()]) commit(approval)
  }, [commit])

  // Si la pantalla se esconde o se va, nada queda sin viajar.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const approve = useCallback(
    (approval: InboxApproval) => {
      // Aprobar una baja no tiene vuelta: el primer toque pregunta, el segundo la da.
      const asked = current.current[approval.id]?.act.kind === 'confirm'
      if (approval.kind === 'void_item' && !asked) {
        setAct(approval, { kind: 'confirm' })
        return
      }
      buzz(12)
      void decide(approval, true)
    },
    [decide, setAct],
  )

  const reject = useCallback(
    (approval: InboxApproval, canDecide: boolean) => {
      if (waiting.current.has(approval.id)) return
      buzz(8)
      setAct(approval, { kind: 'grace', status: canDecide ? 'rejected' : 'cancelled' })
      const timer = window.setTimeout(() => commit(approval), GRACE_MS)
      waiting.current.set(approval.id, { timer, approval })
    },
    [commit, setAct],
  )

  const undo = useCallback(
    async (approval: InboxApproval) => {
      const entry = waiting.current.get(approval.id)
      if (entry) {
        // Todavía no había viajado: no pasó nada.
        window.clearTimeout(entry.timer)
        waiting.current.delete(approval.id)
        setAct(approval, null)
        return
      }
      const act = current.current[approval.id]?.act
      if (act?.kind !== 'done' || !act.undo) return
      setAct(approval, { kind: 'busy' })
      let result: Awaited<ReturnType<ApprovalsApi['undoDiscount']>>
      try {
        result = await latest.current.api.undoDiscount(approval)
      } catch {
        result = { ...NO_SIGNAL, message: 'No hay señal: no se deshizo.' }
      }
      setAct(approval, result.ok ? { kind: 'undone' } : { kind: 'error', message: result.message })
      latest.current.onChanged()
    },
    [setAct],
  )

  /** Volver atrás de «¿lo damos de baja?», o cerrar un error. */
  const back = useCallback((approval: InboxApproval) => setAct(approval, null), [setAct])

  /** Saca de la vista lo ya contestado (lo que está viajando o por viajar se queda). */
  const forgetSettled = useCallback(() => {
    const kept = Object.entries(current.current).filter(
      ([, entry]) => entry.act.kind === 'busy' || entry.act.kind === 'grace',
    )
    if (kept.length !== Object.keys(current.current).length) write(Object.fromEntries(kept))
  }, [write])

  return { acts, approve, reject, undo, back, flush, forgetSettled }
}
