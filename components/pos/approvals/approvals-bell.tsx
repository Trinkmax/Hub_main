'use client'

import { Bell, BellRing } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buzz } from '@/components/pos/order/haptics'
import { useNow } from '@/components/pos/order/use-now'
import type { ApprovalsInbox } from '@/lib/pos/cash/types'
import {
  approvalTitle,
  approvalWhere,
  latestDecision,
  unseenAnswers,
} from '@/lib/pos/pay/approvals'
import { useLiveReload } from '@/lib/pos/use-live-reload'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { cn } from '@/lib/utils'
import { type ApprovalsApi, liveApprovalsApi } from './approvals-api'
import { type ApprovalRow, ApprovalsSheet } from './approvals-sheet'
import { isSettled, useApprovalActs } from './use-approval-acts'
import './approvals.css'

/**
 * La campanita de pedidos, para la barra de arriba del mapa y de la cuenta.
 *
 * A quien puede dar el OK le cuenta cuántos pedidos esperan (y late). A quien pidió le avisa cuando
 * le contestaron. Si no hay nada que mostrarle a esta persona, no se dibuja: una barra con menos
 * cosas.
 *
 * No abre su propio canal en vivo: la pantalla que la aloja ya escucha los avisos de la sucursal y
 * le pasa `signal` (un número que sube cuando hay novedades). Dos escuchas del mismo canal en una
 * pantalla se pisan: la primera que se desmonta le corta el canal a la otra.
 */

const EPOCH = '1970-01-01T00:00:00.000Z'

function seenKey(branchId: string): string {
  return `hub:pos:approvals:seen:${branchId}`
}

function readSeen(branchId: string): string | null {
  try {
    return window.localStorage.getItem(seenKey(branchId))
  } catch {
    return null
  }
}

function writeSeen(branchId: string, until: string): void {
  try {
    window.localStorage.setItem(seenKey(branchId), until)
  } catch {
    // Sin almacenamiento (modo privado): el aviso vuelve a aparecer la próxima vez, nada más.
  }
}

export function ApprovalsBell({
  slug,
  branchId,
  timeZone,
  signal,
  api,
  hereSessionId = null,
}: {
  slug: string
  branchId: string
  timeZone: string
  /** La mesa cuya cuenta ya se está mirando: para esa no se ofrece «Ver cuenta». */
  hereSessionId?: string | null
  /** Sube cada vez que la pantalla se entera de un pedido nuevo o contestado (o vuelve el canal). */
  signal: number
  /** De dónde salen los pedidos. Sin dato, las acciones de verdad. */
  api?: ApprovalsApi
}) {
  const live = useMemo(() => api ?? liveApprovalsApi(slug, branchId), [api, slug, branchId])
  const [inbox, setInbox] = useState<ApprovalsInbox | null>(null)
  const [open, setOpen] = useState(false)
  const [seenUntil, setSeenUntil] = useState<string | null>(null)
  /** Lo que ya se avisó, para no repetirlo. `null` = todavía no llegó la primera lectura. */
  const told = useRef<{ answers: Set<string>; requests: Set<string> } | null>(null)
  const nowMs = useNow(inbox?.now ?? EPOCH)

  // ── Leer ──
  const read = useCallback(async () => {
    try {
      const result = await live.load()
      if (result.ok) setInbox(result.data)
    } catch {
      // Sin señal: queda lo último que se leyó; la próxima novedad vuelve a intentar.
    }
  }, [live])
  // No pierde una novedad que llega durante una lectura y nunca lee de más (`lib/pos/live-reload.ts`).
  const { poke, now: load } = useLiveReload(read)
  // biome-ignore lint/correctness/useExhaustiveDependencies: al montar y al cambiar de sucursal
  useEffect(() => {
    setSeenUntil(readSeen(branchId))
    told.current = null
    void load()
  }, [branchId])
  useEffect(() => {
    if (signal > 0) poke()
  }, [signal, poke])
  // Red de seguridad, solo si la bandeja ya contestó alguna vez (si no, no hay a quién preguntarle).
  useVisibleInterval(() => {
    if (inbox !== null) void load()
  }, 90_000)

  const { acts, approve, reject, undo, back, flush, forgetSettled } = useApprovalActs(live, poke)
  // Con la hoja cerrada no queda nada que mostrar de lo ya contestado.
  // biome-ignore lint/correctness/useExhaustiveDependencies: también cuando termina de viajar algo
  useEffect(() => {
    if (!open) forgetSettled()
  }, [open, acts, forgetSettled])

  // ── Avisar: a quien da el OK, que llegó un pedido; a quien pidió, qué le contestaron ──
  const answers = useMemo(
    () => (inbox && !inbox.can_decide ? unseenAnswers(inbox.recent, seenUntil) : []),
    [inbox, seenUntil],
  )
  useEffect(() => {
    if (!inbox) return
    const requests = inbox.can_decide ? inbox.pending.filter((approval) => !approval.mine) : []
    const known = told.current
    if (known === null) {
      // Lo que ya estaba al entrar no se anuncia: queda en el número de la campanita.
      told.current = {
        answers: new Set(answers.map((answer) => answer.id)),
        requests: new Set(requests.map((request) => request.id)),
      }
      return
    }
    for (const request of requests) {
      if (known.requests.has(request.id)) continue
      known.requests.add(request.id)
      buzz([40, 60, 40])
      toast(`${approvalWhere(request)} · ${approvalTitle(request)}`, {
        description: `${request.requested_by_name} espera tu OK.`,
        duration: 9000,
        action: { label: 'Ver', onClick: () => setOpen(true) },
      })
    }
    for (const answer of answers) {
      if (known.answers.has(answer.id)) continue
      known.answers.add(answer.id)
      const what = `${approvalWhere(answer)} · ${approvalTitle(answer)}`
      if (answer.status === 'approved') toast.success(`${what}: aprobado`)
      else toast.error(`${what}: rechazado`, { description: answer.decision_note ?? undefined })
    }
  }, [inbox, answers])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (next) {
      void load()
      return
    }
    // Lo que quedó «por deshacer» viaja ya, y lo último que se contestó queda como visto.
    flush()
    const latest = inbox ? latestDecision(inbox.recent) : null
    if (latest && latest !== seenUntil) {
      setSeenUntil(latest)
      writeSeen(branchId, latest)
    }
  }

  const rows = useMemo<ApprovalRow[]>(() => {
    if (!inbox) return []
    const byId = new Map<string, ApprovalRow>()
    for (const approval of inbox.pending) {
      byId.set(approval.id, { approval, act: acts[approval.id]?.act ?? null })
    }
    // Lo que se contestó desde esta hoja se queda a la vista hasta cerrarla.
    for (const [id, entry] of Object.entries(acts)) {
      if (!byId.has(id)) byId.set(id, { approval: entry.approval, act: entry.act })
    }
    return [...byId.values()].sort((a, b) =>
      a.approval.requested_at.localeCompare(b.approval.requested_at),
    )
  }, [inbox, acts])

  if (!inbox) return null
  const { can_decide: canDecide } = inbox
  if (!canDecide && inbox.pending.length === 0 && inbox.recent.length === 0) return null

  // Lo que ya se tocó en esta hoja no cuenta como «esperando».
  const waiting = inbox.pending.filter((approval) => !isSettled(acts[approval.id]?.act)).length
  const count = canDecide ? waiting : answers.length
  const label = canDecide
    ? count === 0
      ? 'Pedidos: ninguno espera tu OK'
      : count === 1
        ? 'Un pedido espera tu OK'
        : `${count} pedidos esperan tu OK`
    : count > 0
      ? count === 1
        ? 'Te contestaron un pedido'
        : `Te contestaron ${count} pedidos`
      : waiting > 0
        ? 'Tus pedidos: esperando el OK'
        : 'Tus pedidos'

  return (
    <>
      <button
        type="button"
        className={cn('apv-bell', canDecide && count > 0 && 'is-ringing')}
        onClick={() => changeOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        data-testid="approvals-bell"
      >
        {count > 0 ? (
          <BellRing aria-hidden strokeWidth={2.2} />
        ) : (
          <Bell aria-hidden strokeWidth={2.2} />
        )}
        {count > 0 ? (
          <span className="apv-count" aria-hidden>
            {count > 9 ? '9+' : count}
          </span>
        ) : !canDecide && waiting > 0 ? (
          <span className="apv-dot" aria-hidden />
        ) : null}
      </button>
      <ApprovalsSheet
        open={open}
        inbox={inbox}
        rows={rows}
        nowMs={nowMs}
        timeZone={timeZone}
        billHref={(sessionId) =>
          sessionId === hereSessionId ? null : `/${slug}/salon/mesa/${sessionId}/cuenta`
        }
        onOpenChange={changeOpen}
        onApprove={approve}
        onReject={(approval) => reject(approval, canDecide)}
        onUndo={(approval) => void undo(approval)}
        onBack={back}
      />
    </>
  )
}
