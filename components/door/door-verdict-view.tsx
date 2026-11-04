'use client'

import { Loader2, Minus, Plus, RotateCcw, ScanLine } from 'lucide-react'
import Image from 'next/image'
import { useMemo } from 'react'
import { formatLongDate } from '@/lib/ticketing/dates'
import {
  type DoorTicket,
  type DoorVerdict,
  doorBalanceCents,
  formatShortCode,
} from '@/lib/ticketing/door'
import { formatPesos } from '@/lib/ticketing/pricing'
import { tornClipBottom, tornClipTop, tornProfile } from '@/lib/ticketing/ticket-art'

/** Lo que tarda en volver sola a la cámara después de dejar pasar. */
export const DOOR_RETURN_MS = 5000

export type DoorStage = 'verdict' | 'admitting' | 'falling' | 'done' | 'undoing'

type Tone = 'pass' | 'stop' | 'wait'

type Words = { tone: Tone; word: string; note: string | null; name: boolean }

function capitalize(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}

/** La pantalla dice una sola cosa y grande: pasan o no pasan, y por qué. */
function wordsFor(verdict: DoorVerdict, stage: DoorStage, guests: number): Words {
  if (stage === 'falling' || stage === 'done' || stage === 'undoing') {
    return { tone: 'pass', word: '¡Adentro!', note: null, name: true }
  }
  switch (verdict.kind) {
    case 'admit':
      return {
        tone: 'pass',
        word: `${guests === 1 ? 'Pasa' : 'Pasan'} ${guests}`,
        note:
          verdict.inside > 0
            ? `Ya entraron ${verdict.inside} de ${verdict.total}. Faltan ${verdict.left}.`
            : null,
        name: true,
      }
    case 'used': {
      const when = verdict.at ? ` a las ${verdict.at}` : ''
      const who = verdict.by ? ` · Marcó ${verdict.by}` : ''
      return {
        tone: 'stop',
        word: 'Ya entraron',
        note: `${verdict.total === 1 ? 'Entró' : `Entraron los ${verdict.total}`}${when}${who}.`,
        name: true,
      }
    }
    case 'other_day':
      return {
        tone: 'wait',
        word: verdict.when === 'future' ? 'Es otro día' : 'Ya pasó',
        note: `${verdict.when === 'future' ? 'Esta entrada es para el' : 'Esta entrada era para el'} ${formatLongDate(verdict.date)}, ${verdict.time} hs.`,
        name: true,
      }
    case 'not_paid':
      return {
        tone: 'stop',
        word: 'No pasa',
        note: 'Este pago no se aprobó. Puede volver a reservar desde la cartelera.',
        name: true,
      }
    case 'refunded':
      return {
        tone: 'stop',
        word: 'No pasa',
        note: 'La plata de esta entrada se devolvió.',
        name: true,
      }
    case 'cancelled':
      return {
        tone: 'stop',
        word: 'No pasa',
        note: 'Esta reserva se canceló.',
        name: true,
      }
    case 'no_reservation':
      return {
        tone: 'wait',
        word: 'Preguntá',
        note: 'Pagó, pero la reserva no se cargó. Hablá con el encargado antes de dejarlo pasar.',
        name: true,
      }
  }
}

/**
 * El veredicto de la puerta. Solo pinta: lo usan la pestaña Puerta y el escáner
 * del salón, que le pasan el estado y las acciones.
 */
export function DoorVerdictView({
  ticket,
  verdict,
  stage,
  guests,
  onGuests,
  onAdmit,
  onNext,
  onUndo,
  undoNote,
  errorMessage,
}: {
  ticket: DoorTicket
  verdict: DoorVerdict
  stage: DoorStage
  guests: number
  onGuests: (next: number) => void
  onAdmit: () => void
  onNext: () => void
  /** Solo si todavía se puede deshacer. */
  onUndo?: () => void
  /** Por qué no se pudo deshacer. */
  undoNote?: string | null
  errorMessage?: string | null
}) {
  const words = wordsFor(verdict, stage, guests)
  const balance = doorBalanceCents(ticket)
  const canAdmit = verdict.kind === 'admit' && stage !== 'falling' && stage !== 'done'
  const left = verdict.kind === 'admit' ? verdict.left : 0
  const finished = stage === 'falling' || stage === 'done' || stage === 'undoing'
  const falling = stage === 'falling'
  const date = ticket.reservation?.date ?? ticket.event_date
  const time = ticket.reservation?.time ?? ticket.event_time
  const isToday = date === ticket.service_day
  const room = ticket.room
  const profile = useMemo(() => tornProfile(ticket.order_id, 34, 6), [ticket.order_id])
  // La plata solo si la entrada vale: con el pago caído o devuelto no hay nada que
  // cobrar ni seña que mostrar. Sin reserva, sí: pagó, y hay que resolverlo.
  const showMoney = !['not_paid', 'refunded', 'cancelled'].includes(verdict.kind)

  return (
    <section className="door door-verdict -mx-4 -mt-3" data-tone={words.tone} aria-live="assertive">
      <p className="door-word" key={words.word}>
        {words.word}
      </p>
      {words.name ? <p className="door-name">{ticket.guest_name}</p> : null}
      {words.note ? <p className="door-note">{words.note}</p> : null}
      {finished && room ? (
        <p className="door-note">
          <span className="door-roll font-semibold">
            {room.inside} de {room.expected}
          </span>{' '}
          adentro en {ticket.title}.
        </p>
      ) : null}

      <div className="door-ticket" data-falling={falling}>
        <div
          className="door-half door-half-top"
          data-alone={!showMoney}
          style={finished ? { clipPath: tornClipTop(profile) } : undefined}
        >
          <div className={`flex items-center gap-3 p-3.5 ${finished ? 'pb-5' : ''}`}>
            <div className="door-poster">
              {ticket.poster_url ? (
                <Image src={ticket.poster_url} alt="" fill sizes="56px" className="object-cover" />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate font-[family-name:var(--door-serif)] text-[1.45rem] leading-tight font-semibold tracking-[-0.02em]">
                {ticket.title}
              </p>
              <p className="mt-0.5 text-sm text-(--door-ink-2)">
                {isToday ? 'Hoy' : capitalize(formatLongDate(date))} · {time} hs
              </p>
              <p className="door-serial mt-1">{formatShortCode(ticket.short_code)}</p>
            </div>
          </div>
        </div>

        {showMoney && (!finished || falling) ? (
          <div className="door-stub-slot" data-gone={falling}>
            <div>
              <div
                className="door-half door-half-stub"
                data-falling={falling}
                style={falling ? { clipPath: tornClipBottom(profile) } : undefined}
              >
                <div className="flex items-end justify-between gap-3 px-3.5 pt-3 pb-3.5">
                  <div className="min-w-0">
                    <p className="door-label">
                      {ticket.payment_option === 'deposit' ? 'Seña paga' : 'Pagó todo'}
                    </p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatPesos(ticket.paid_cents ?? 0)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="door-label">
                      {balance > 0 && ticket.balance_cash_only
                        ? 'Falta, en efectivo'
                        : 'Falta cobrar'}
                    </p>
                    <p className="door-owed mt-1">{balance > 0 ? formatPesos(balance) : 'Nada'}</p>
                  </div>
                </div>

                {canAdmit && left > 1 ? (
                  <div className="flex items-center justify-between gap-3 border-t border-(--door-ink)/12 px-3.5 py-3">
                    <p className="text-sm font-semibold">¿Cuántos pasan?</p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="door-step"
                        onClick={() => onGuests(guests - 1)}
                        disabled={guests <= 1}
                        aria-label="Pasa uno menos"
                      >
                        <Minus className="size-5" aria-hidden />
                      </button>
                      <span className="door-owed w-9 text-center tabular-nums" aria-live="polite">
                        {guests}
                      </span>
                      <button
                        type="button"
                        className="door-step"
                        onClick={() => onGuests(guests + 1)}
                        disabled={guests >= left}
                        aria-label="Pasa uno más"
                      >
                        <Plus className="size-5" aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="door-note mt-3 font-semibold" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {canAdmit ? (
        <>
          <button
            type="button"
            className="door-cta"
            onClick={onAdmit}
            disabled={stage === 'admitting'}
          >
            {stage === 'admitting' ? <Loader2 className="size-6 animate-spin" aria-hidden /> : null}
            {errorMessage
              ? 'Probar de nuevo'
              : guests === 1
                ? 'Dejar pasar'
                : `Dejar pasar a ${guests}`}
          </button>
          <button type="button" className="door-quiet" onClick={onNext}>
            Volver a la cámara
          </button>
        </>
      ) : (
        <>
          {undoNote ? (
            <p className="door-note mt-3 font-semibold" role="alert">
              {undoNote}
            </p>
          ) : null}
          <button type="button" className="door-cta relative overflow-hidden" onClick={onNext}>
            {finished ? (
              <ScanLine className="size-6" aria-hidden />
            ) : (
              <RotateCcw className="size-5" aria-hidden />
            )}
            {finished ? 'Escanear el próximo' : 'Escanear otra'}
            {stage === 'done' && !undoNote ? (
              <span
                className="door-countdown"
                style={{ '--door-wait': `${DOOR_RETURN_MS}ms` } as React.CSSProperties}
                aria-hidden
              />
            ) : null}
          </button>
          {finished && onUndo ? (
            <button
              type="button"
              className="door-quiet"
              onClick={onUndo}
              disabled={stage === 'undoing'}
            >
              {stage === 'undoing' ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : null}
              Deshacer: me equivoqué
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

/** No se pudo saber: otro bar, un código que no existe o sin señal. */
export function DoorProblemView({
  word,
  note,
  onNext,
  onReload,
  retryLabel,
}: {
  word: string
  note: string
  onNext: () => void
  /** Si pudo ser una versión vieja de la app: recargar lo resuelve. */
  onReload?: () => void
  retryLabel: string
}) {
  return (
    <section className="door door-verdict -mx-4 -mt-3" data-tone="stop" aria-live="assertive">
      <p className="door-word">{word}</p>
      <p className="door-note mt-3">{note}</p>
      <button type="button" className="door-cta" onClick={onNext}>
        <RotateCcw className="size-5" aria-hidden />
        {retryLabel}
      </button>
      {onReload ? (
        <button type="button" className="door-quiet" onClick={onReload}>
          Recargar la página
        </button>
      ) : null}
    </section>
  )
}
