'use client'

import { ArrowRight, ChevronDown, Loader, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { Button } from '@/components/ui/button'
import type { TexTicket as Ticket } from '@/lib/tex/protocol'
import { cn } from '@/lib/utils'
import { useTex } from './tex-provider'

/**
 * El tique de Tex: lo que va a hacer, impreso, como sale la comanda en el bar. Nada se guarda hasta
 * que la persona toca el botón; cuando lo hace, cae el sello y queda a mano «Ver dónde quedó» y
 * «Deshacer».
 */

/** Cuánto falta para que ya no se pueda deshacer. */
function useCountdown(until: string | null): string | null {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!until) {
      setLeft(null)
      return
    }
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [until])
  if (left === null || left <= 0) return null
  const minutes = Math.floor(left / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const STAMPS: Partial<Record<Ticket['status'], { text: string; tone: 'ok' | 'warn' | 'bad' }>> = {
  done: { text: 'Hecho', tone: 'ok' },
  declined: { text: 'No se hizo', tone: 'warn' },
  superseded: { text: 'Sin efecto', tone: 'warn' },
  failed: { text: 'No se pudo', tone: 'bad' },
  undone: { text: 'Deshecho', tone: 'warn' },
}

export function TexTicket({ ticket }: { ticket: Ticket }) {
  const { decide, undo, showWhere, busy } = useTex()
  const [showEntry, setShowEntry] = useState(false)
  const countdown = useCountdown(
    ticket.status === 'done' ? (ticket.result?.undoUntil ?? null) : null,
  )
  const [undoing, setUndoing] = useState(false)
  // Entre el toque y la respuesta: el botón muestra que está en eso.
  const [sending, setSending] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: cualquier cambio del tique o de la charla lo termina.
  useEffect(() => {
    if (!busy) setSending(false)
  }, [busy, ticket.status])
  const stamp = STAMPS[ticket.status]
  const faded =
    ticket.status === 'declined' || ticket.status === 'superseded' || ticket.status === 'undone'

  return (
    <section
      aria-label={`Tique: ${ticket.title}`}
      className="adm-ticket-wrap force-light tex-print relative mx-1"
    >
      <div
        className={cn(
          'adm-ticket px-4 pt-3.5 pb-6 font-mono text-[13px] leading-snug',
          faded && 'opacity-60',
        )}
      >
        <p className="text-center text-[11px] font-bold tracking-[0.18em] uppercase">
          {ticket.title}
        </p>
        {ticket.subtitle ? (
          <p className="mt-0.5 text-center text-xs text-pretty text-muted-foreground">
            {ticket.subtitle}
          </p>
        ) : null}

        <div className="my-2.5 border-t border-dashed border-current/30" />

        <dl className="grid gap-1">
          {ticket.rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="flex items-baseline justify-between gap-3"
            >
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 text-right font-medium text-pretty break-words tabular-nums">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {ticket.total ? (
          <div className="mt-2.5 flex items-baseline justify-between gap-3 border-y-[3px] border-double border-current py-1.5 text-[15px] font-bold tabular-nums">
            <span className="uppercase">{ticket.total.label}</span>
            <span>{ticket.total.value}</span>
          </div>
        ) : null}

        {ticket.warnings.length > 0 ? (
          <ul className="mt-2.5 grid gap-1.5">
            {ticket.warnings.map((warning) => (
              <li
                key={warning.key}
                className="rounded-sm bg-amber-200/60 px-2 py-1.5 font-sans text-xs leading-snug text-pretty text-amber-950"
              >
                {warning.title}
                {warning.body ? <span className="block opacity-80">{warning.body}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {ticket.entry.length > 0 ? (
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={showEntry}
              onClick={() => setShowEntry((v) => !v)}
              className="inline-flex min-h-7 items-center gap-1 rounded-sm font-sans text-xs text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver asiento
              <ChevronDown
                aria-hidden
                className={cn('size-3 transition-transform', showEntry && 'rotate-180')}
              />
            </button>
            {showEntry ? (
              <table className="mt-1 w-full border-collapse text-[11px] tabular-nums">
                <thead>
                  <tr className="border-b border-current/30 text-muted-foreground">
                    <th className="py-0.5 text-left font-normal">Cuenta</th>
                    <th className="py-0.5 pl-2 text-right font-normal">Debe</th>
                    <th className="py-0.5 pl-2 text-right font-normal">Haber</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.entry.map((line) => (
                    <tr
                      key={`${line.account}-${line.debit ?? ''}-${line.credit ?? ''}`}
                      className="border-b border-current/10"
                    >
                      <td className="py-0.5 pr-1 align-top">{line.account}</td>
                      <td className="py-0.5 pl-2 text-right align-top whitespace-nowrap">
                        {line.debit}
                      </td>
                      <td className="py-0.5 pl-2 text-right align-top whitespace-nowrap">
                        {line.credit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}

        {ticket.status === 'pending' ? (
          <div className="mt-3 flex gap-2 font-sans">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                setSending(true)
                decide([{ actionId: ticket.actionId, approve: true }])
              }}
              className="h-9 min-w-0 flex-1 gap-1.5 pointer-coarse:h-11"
            >
              {sending ? (
                <Loader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : null}
              {sending ? 'Haciendo…' : ticket.confirmLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => decide([{ actionId: ticket.actionId, approve: false }])}
              className="h-9 pointer-coarse:h-11"
            >
              No
            </Button>
          </div>
        ) : null}

        {ticket.status === 'failed' && ticket.error ? (
          <p className="mt-2.5 rounded-sm bg-red-100 px-2 py-1.5 font-sans text-xs text-pretty text-red-900">
            {ticket.error}
          </p>
        ) : null}

        {ticket.status === 'done' && ticket.result ? (
          <div className="mt-3 grid gap-2 font-sans">
            <p className="text-xs leading-snug text-pretty">{ticket.result.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              {ticket.result.href ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    showWhere(ticket.result?.href as string, ticket.result?.point ?? null)
                  }
                  className="h-8 gap-1 pointer-coarse:h-11"
                >
                  Ver dónde quedó
                  <ArrowRight aria-hidden className="size-3.5" />
                </Button>
              ) : null}
              {countdown ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={undoing}
                  onClick={async () => {
                    setUndoing(true)
                    await undo(ticket.actionId)
                    setUndoing(false)
                  }}
                  className="h-8 gap-1 text-muted-foreground pointer-coarse:h-11"
                >
                  <Undo2 aria-hidden className="size-3.5" />
                  Deshacer
                  <span className="tabular-nums">{countdown}</span>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {stamp ? (
        <Stamp
          tone={stamp.tone}
          thud
          className="absolute top-3 right-3 bg-(--adm-paper)/80 px-2 py-0.5 text-[13px] font-sans"
        >
          {stamp.text}
        </Stamp>
      ) : null}
    </section>
  )
}
