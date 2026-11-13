'use client'

import {
  BellRing,
  Check,
  CheckCheck,
  Clock,
  Flame,
  LoaderCircle,
  type LucideIcon,
  Minus,
  Pause,
  PencilLine,
  Play,
  Plus,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { formatCentsShort } from '@/lib/money/format'
import type { DraftTotals } from '@/lib/pos/order/cart'
import {
  ENTRY_WORD,
  type EntryStatus,
  entryTotalCents,
  type OutboxEntry,
} from '@/lib/pos/order/outbox'
import {
  LINE_WORD,
  type LineState,
  lineState,
  STAGE_WORD,
  type TicketDisplay,
  type TicketStage,
} from '@/lib/pos/order/tickets'
import { formatMinutes } from '@/lib/pos/table-state'
import type { SessionItem, SessionTicket } from '@/lib/pos/types'
import { cn } from '@/lib/utils'

/**
 * Las comandas de papel: una tanda que ya está en el servidor, una que está viajando y la que el
 * mozo todavía está armando. Las tres se leen igual (cantidad grande, nombre, aclaraciones en
 * carbónico); cambia el borde del papel y lo que se puede tocar.
 */

const STAGE_ICON: Record<TicketStage, LucideIcon> = {
  held: Pause,
  sent: Check,
  seen: CheckCheck,
  preparing: Flame,
  partly_ready: BellRing,
  ready: BellRing,
  served: Check,
  cancelled: Minus,
}

const LINE_ICON: Record<Exclude<LineState, 'cancelled'>, LucideIcon> = {
  queued: Clock,
  preparing: Flame,
  ready: BellRing,
  served: Check,
}

/** «Extra cheddar + $ 1.500». */
export function modifierText(modifier: { label: string; delta_cents: number }): string {
  if (modifier.delta_cents === 0) return modifier.label
  const amount = formatCentsShort(modifier.delta_cents)
  return `${modifier.label} ${modifier.delta_cents > 0 ? `+ ${amount}` : amount}`
}

function StageChip({ display }: { display: TicketDisplay }) {
  const Icon = STAGE_ICON[display.stage]
  if (display.stage === 'served') {
    return (
      <span className="cmd-stamp">
        <Icon aria-hidden strokeWidth={3} />
        {display.word}
      </span>
    )
  }
  const minutes = display.minutes !== null && display.minutes > 0 ? display.minutes : null
  return (
    <span className={cn('cmd-stage', `is-${display.stage}`, display.late && 'is-late')}>
      <Icon aria-hidden strokeWidth={2.6} />
      {display.late ? 'Demorada' : display.word}
      {minutes !== null && display.stage !== 'held' ? <b>· {formatMinutes(minutes)}</b> : null}
    </span>
  )
}

function TicketTotal({ label, cents }: { label: string; cents: number }) {
  return (
    <p className="cmd-total">
      <span>{label}</span>
      <i className="cmd-dots" aria-hidden />
      <b>{formatCentsShort(cents)}</b>
    </p>
  )
}

function LineBody({
  quantity,
  name,
  modifiers,
  notes,
  children,
}: {
  quantity: number
  name: string
  modifiers: readonly { label: string; delta_cents: number }[]
  notes: string | null
  children?: React.ReactNode
}) {
  return (
    <>
      <span className="cmd-qty">{quantity}</span>
      <span className="cmd-line-body">
        <span className="cmd-line-name">{name}</span>
        {modifiers.length > 0 ? (
          <span className="cmd-line-mods">{modifiers.map(modifierText).join(' · ')}</span>
        ) : null}
        {notes ? <span className="cmd-line-note">«{notes}»</span> : null}
        {children}
      </span>
    </>
  )
}

// ─── Una tanda que ya está en el servidor ────────────────────────────────────

export function SentTicket({
  ticket,
  number,
  display,
  clock,
  firing,
  fireInBar,
  readOnly,
  onLine,
  onFire,
}: {
  ticket: SessionTicket
  number: number
  display: TicketDisplay
  /** «21:34»: cuándo se cargó. */
  clock: string
  firing: boolean
  /** El botón de abajo ya ofrece marchar esta tanda: el de acá no le compite. */
  fireInBar: boolean
  readOnly: boolean
  onLine: (item: SessionItem) => void
  onFire: () => void
}) {
  const held = display.stage === 'held'
  return (
    <article
      className={cn('cmd-ticket', `is-${display.stage}`)}
      aria-label={`Tanda ${number}: ${display.late ? 'demorada' : display.word.toLowerCase()}`}
      data-testid={`ticket-${number}`}
      data-stage={display.stage}
    >
      <header className="cmd-ticket-head">
        <h2 className="cmd-ticket-title">Tanda {number}</h2>
        {clock ? <time className="cmd-ticket-time">{clock}</time> : null}
        <StageChip display={display} />
      </header>

      <ul className="cmd-lines">
        {ticket.items.map((item) => {
          const state = lineState(item)
          if (state === 'cancelled') {
            return (
              <li key={item.id}>
                <div className="cmd-line is-cancelled">
                  <LineBody
                    quantity={item.quantity}
                    name={item.name}
                    modifiers={item.modifiers}
                    notes={item.notes}
                  >
                    <span className="cmd-line-why">
                      {item.cancellation_reason ?? LINE_WORD.cancelled}
                    </span>
                  </LineBody>
                  <span className="cmd-void">Anulado</span>
                </div>
              </li>
            )
          }
          const Icon = LINE_ICON[state]
          const body = (
            <>
              <LineBody
                quantity={item.quantity}
                name={item.name}
                modifiers={item.modifiers}
                notes={item.notes}
              />
              {held ? null : (
                <span className="cmd-line-state">
                  <Icon aria-hidden strokeWidth={2.5} />
                  <span className={display.mixed ? undefined : 'sr-only'}>{LINE_WORD[state]}</span>
                </span>
              )}
            </>
          )
          return (
            <li key={item.id}>
              {readOnly ? (
                <div className={cn('cmd-line', `is-${state}`)}>{body}</div>
              ) : (
                <button
                  type="button"
                  className={cn('cmd-line', `is-${state}`)}
                  onClick={() => onLine(item)}
                  data-testid={`line-${item.id}`}
                >
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {held && !readOnly ? (
        <button
          type="button"
          className={cn('cmd-fire', fireInBar && 'is-quiet')}
          onClick={onFire}
          disabled={firing}
          data-testid={`fire-${number}`}
        >
          <Play aria-hidden strokeWidth={2.6} />
          Marchar ahora
        </button>
      ) : null}

      <TicketTotal label="Total de la tanda" cents={ticket.total_cents} />
    </article>
  )
}

// ─── Una tanda que está viajando (o que el servidor acaba de confirmar) ──────

export type PendingStatus = EntryStatus | 'confirmed'

export function PendingTicket({
  entry,
  number,
  status,
  canRetry,
  onRetry,
}: {
  entry: OutboxEntry
  number: number
  status: PendingStatus
  canRetry: boolean
  onRetry: () => void
}) {
  const confirmed = status === 'confirmed'
  const stage: TicketStage = entry.fire ? 'sent' : 'held'
  const Icon = STAGE_ICON[stage]
  return (
    <article
      className={cn('cmd-ticket', confirmed ? `is-${stage}` : 'is-pending')}
      aria-label={`Tanda ${number}: ${confirmed ? STAGE_WORD[stage].toLowerCase() : ENTRY_WORD[status]}`}
      data-testid={`ticket-${number}`}
      data-stage={confirmed ? stage : status}
    >
      <header className="cmd-ticket-head">
        <h2 className="cmd-ticket-title">Tanda {number}</h2>
        {confirmed ? (
          <span className={cn('cmd-stage', `is-${stage}`)}>
            <Icon aria-hidden strokeWidth={2.6} />
            {STAGE_WORD[stage]}
          </span>
        ) : (
          <span className="cmd-stage is-sending" role="status">
            {status === 'offline' ? (
              <WifiOff aria-hidden strokeWidth={2.4} />
            ) : (
              <LoaderCircle className="cmd-spin" aria-hidden strokeWidth={2.6} />
            )}
            {status === 'offline' ? 'Sin señal' : ENTRY_WORD.sending}
          </span>
        )}
      </header>

      {status === 'offline' || status === 'retrying' ? (
        <p className="cmd-note" role="status">
          <WifiOff aria-hidden />
          <span>
            {ENTRY_WORD[status]}
            {status === 'retrying' && entry.lastError ? <small>{entry.lastError}</small> : null}
            {status === 'offline' ? (
              <small>
                Quedó guardada en este celular.{' '}
                {entry.fire ? 'Cocina la recibe apenas vuelva.' : 'Queda en espera apenas vuelva.'}
              </small>
            ) : null}
          </span>
          {canRetry ? (
            <button type="button" className="cmd-note-btn" onClick={onRetry}>
              Reintentar
            </button>
          ) : null}
        </p>
      ) : null}

      <ul className="cmd-lines">
        {entry.lines.map((line, i) => (
          // Los renglones de una tanda guardada no cambian ni se reordenan.
          // biome-ignore lint/suspicious/noArrayIndexKey: lista fija
          <li key={i}>
            <div className="cmd-line">
              <LineBody
                quantity={line.quantity}
                name={line.name}
                modifiers={line.modifiers}
                notes={line.notes}
              />
            </div>
          </li>
        ))}
      </ul>

      <TicketTotal label="Total de la tanda" cents={entryTotalCents(entry)} />
    </article>
  )
}

// ─── La tanda que se está armando ────────────────────────────────────────────

export function DraftTicket({
  totals,
  number,
  onEdit,
  onInc,
  onDec,
}: {
  totals: DraftTotals
  number: number
  onEdit: (lineKey: string) => void
  onInc: (lineKey: string) => void
  onDec: (lineKey: string) => void
}) {
  return (
    <section
      className="cmd-ticket is-draft"
      aria-label={`Tanda ${number}, sin enviar`}
      data-testid="draft"
    >
      <header className="cmd-ticket-head">
        <h2 className="cmd-ticket-title">Tanda {number}</h2>
        <span className="cmd-stage is-draft">
          <PencilLine aria-hidden strokeWidth={2.4} />
          Sin enviar
        </span>
      </header>

      <ul className="cmd-lines">
        {totals.lines.map(({ line, name, modifiers, sold_out, missing }) => {
          const out = sold_out || missing
          const plain = modifiers.length === 0 && !line.notes
          return (
            <li key={line.key} className={cn('cmd-dline', out && 'is-out')}>
              <button
                type="button"
                className="cmd-dline-main"
                onClick={() => onEdit(line.key)}
                data-testid={`draft-line-${line.menu_item_id}`}
              >
                <span className="cmd-qty cmd-bump" key={line.quantity}>
                  {line.quantity}
                </span>
                <span className="cmd-line-body">
                  <span className="cmd-line-name">{name}</span>
                  {modifiers.length > 0 ? (
                    <span className="cmd-line-mods">{modifiers.map(modifierText).join(' · ')}</span>
                  ) : null}
                  {line.notes ? <span className="cmd-line-note">«{line.notes}»</span> : null}
                  {out ? (
                    <span className="cmd-line-out">
                      {missing ? 'Ya no está en la carta' : 'Agotado'}: sacalo para enviar
                    </span>
                  ) : plain ? (
                    <span className="cmd-dline-hint">
                      <PencilLine aria-hidden />
                      Aclarar
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                className="cmd-step"
                onClick={() => onDec(line.key)}
                aria-label={line.quantity === 1 ? `Quitar ${name}` : `Uno menos de ${name}`}
              >
                {line.quantity === 1 ? <Trash2 aria-hidden /> : <Minus aria-hidden />}
              </button>
              <button
                type="button"
                className="cmd-step is-plus"
                onClick={() => onInc(line.key)}
                disabled={out}
                aria-label={`Uno más de ${name}`}
              >
                <Plus aria-hidden strokeWidth={2.6} />
              </button>
            </li>
          )
        })}
      </ul>

      <TicketTotal label="Total sin enviar" cents={totals.total_cents} />
    </section>
  )
}
