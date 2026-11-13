'use client'

import { Ban, BanknoteArrowDown, BanknoteArrowUp, LockKeyhole, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatCentsShort } from '@/lib/money/format'
import { differenceWords, drawerLines } from '@/lib/pos/cash/screen'
import {
  editLines,
  filterTape,
  openingLine,
  paymentExtras,
  paymentTitle,
  type Tape as TapeData,
  type TapeEntry,
  type TapeFilter,
  tapeSum,
} from '@/lib/pos/cash/tape'
import {
  type CashMovement,
  type DayPayment,
  type InvoiceByMethod,
  METHOD_LABEL,
  type Shift,
  type ShiftSummary,
} from '@/lib/pos/cash/types'
import { clockAt } from '@/lib/pos/order/clock'
import { cn } from '@/lib/utils'
import { MethodMark } from './method'

/**
 * La cinta: lo último arriba, recién salido de la ranura; lo primero abajo, donde se abrió el turno.
 * Cada renglón se toca: un cobro para corregirlo, un movimiento para verlo. Con un medio elegido
 * queda solo eso y arriba la suma (en efectivo, la cuenta entera del cajón).
 */

export type TapeMark = { paymentId?: string; movementId?: string } | null

type Props = {
  tape: TapeData
  filter: TapeFilter
  onFilter: (filter: TapeFilter) => void
  /** Los números del turno: de ahí sale la cuenta del cajón. */
  live: ShiftSummary | null
  invoiceByMethod: InvoiceByMethod | null
  timeZone: string
  practice: boolean
  /** `roll`: sale de la ranura (turno abierto). `loose`: papel suelto, con su título. */
  variant: 'roll' | 'loose'
  title?: string
  subtitle?: string
  /** Un renglón señalado desde el arqueo. */
  mark?: TapeMark
  onPayment: (payment: DayPayment) => void
  onMovement: (movement: CashMovement) => void
}

export function Tape({
  tape,
  filter,
  onFilter,
  live,
  invoiceByMethod,
  timeZone,
  practice,
  variant,
  title,
  subtitle,
  mark = null,
  onPayment,
  onMovement,
}: Props) {
  // Lo que entra con la pantalla abierta avanza la cinta un paso. Al entrar, nada se mueve.
  const ids = useMemo(
    () => [...tape.current, ...tape.other].map((entry) => entry.id),
    [tape.current, tape.other],
  )
  const [known, setKnown] = useState(() => ({ ids: new Set(ids), fresh: new Set<string>() }))
  if (ids.some((id) => !known.ids.has(id))) {
    setKnown({ ids: new Set(ids), fresh: new Set(ids.filter((id) => !known.ids.has(id))) })
  }

  const shown = useMemo(() => filterTape(tape.current, filter), [tape.current, filter])
  const other = useMemo(() => filterTape(tape.other, filter), [tape.other, filter])
  const sum = useMemo(() => tapeSum(shown), [shown])
  const hasPayments = tape.current.some((entry) => entry.kind === 'payment')

  const row = (entry: TapeEntry) => (
    <li key={entry.id} data-new={known.fresh.has(entry.id) ? '' : undefined}>
      {entry.kind === 'payment' ? (
        <PaymentRow
          payment={entry.payment}
          invoiceByMethod={invoiceByMethod}
          timeZone={timeZone}
          marked={mark?.paymentId === entry.payment.id}
          onOpen={onPayment}
        />
      ) : entry.kind === 'movement' ? (
        <MovementRow
          movement={entry.movement}
          timeZone={timeZone}
          marked={mark?.movementId === entry.movement.id}
          onOpen={onMovement}
        />
      ) : entry.kind === 'opening' ? (
        <OpeningRow shift={entry.shift} timeZone={timeZone} />
      ) : (
        <ClosingRow shift={entry.shift} timeZone={timeZone} />
      )}
    </li>
  )

  return (
    <>
      <div
        className={cn('caja-tape', variant === 'loose' && 'is-loose', practice && 'is-practice')}
      >
        {variant === 'loose' && title ? (
          <header className="caja-tape-head">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </header>
        ) : null}

        {filter !== 'all' ? (
          <div className="caja-only">
            <div className="caja-only-row">
              <p>
                {filter === 'cash' ? (
                  'Solo el efectivo: la cuenta del cajón.'
                ) : sum.count === 0 ? (
                  `Sin cobros con ${METHOD_LABEL[filter].toLowerCase()}.`
                ) : (
                  <>
                    Solo {METHOD_LABEL[filter].toLowerCase()}: <b>{formatCentsShort(sum.cents)}</b>{' '}
                    en {sum.count} {sum.count === 1 ? 'cobro' : 'cobros'}.
                  </>
                )}
              </p>
              <button type="button" className="caja-only-btn" onClick={() => onFilter('all')}>
                <X aria-hidden strokeWidth={2.6} />
                Ver todo
              </button>
            </div>
            {filter === 'cash' && live ? (
              <DrawerSum live={live} closed={variant === 'loose'} />
            ) : null}
          </div>
        ) : null}

        {shown.length > 0 ? <ol className="caja-lines">{shown.map(row)}</ol> : null}

        {variant === 'roll' && !hasPayments && filter === 'all' ? (
          <p className="caja-tape-empty">
            Todavía no entró ningún cobro. Cuando cobren una mesa, aparece acá solo.
          </p>
        ) : null}
      </div>

      {other.length > 0 ? (
        <div className={cn('caja-tape is-loose is-old', practice && 'is-practice')}>
          <header className="caja-tape-head">
            <h2>Antes, en otro turno del día</h2>
            <p>No suma en los números de arriba.</p>
          </header>
          <ol className="caja-lines">{other.map(row)}</ol>
        </div>
      ) : null}
    </>
  )
}

/** Cambio + efectivo + lo que entró − lo que se sacó = lo que tiene que haber. */
export function DrawerSum({ live, closed = false }: { live: ShiftSummary; closed?: boolean }) {
  return (
    <dl className="caja-sum">
      {drawerLines(live).map((line) => (
        <div key={line.key}>
          <dt>{line.label}</dt>
          <dd>
            {line.key === 'float' ? '' : line.cents < 0 ? '− ' : '+ '}
            {formatCentsShort(Math.abs(line.cents))}
          </dd>
        </div>
      ))}
      <div className="is-total">
        <dt>{closed ? 'Tenía que haber' : 'Tiene que haber'}</dt>
        <dd>{formatCentsShort(live.expected_cash_cents)}</dd>
      </div>
    </dl>
  )
}

function PaymentRow({
  payment,
  invoiceByMethod,
  timeZone,
  marked,
  onOpen,
}: {
  payment: DayPayment
  invoiceByMethod: InvoiceByMethod | null
  timeZone: string
  marked: boolean
  onOpen: (payment: DayPayment) => void
}) {
  const { title, detail } = paymentTitle(payment)
  const voided = payment.status === 'voided'
  const notes = [
    ...(voided ? [] : paymentExtras(payment, invoiceByMethod)),
    ...editLines(payment.edits, timeZone),
  ]
  return (
    <button
      type="button"
      className={cn('caja-line', voided && 'is-void', marked && 'is-mark')}
      onClick={() => onOpen(payment)}
      data-testid={`cobro-${payment.id}`}
      data-method={payment.method}
    >
      <time dateTime={payment.created_at}>{clockAt(payment.created_at, timeZone)}</time>
      <span className="caja-line-body">
        <span className="caja-line-title">
          {title}
          {detail ? <em> · {detail}</em> : null}
        </span>
        <span className="caja-line-meta">
          <MethodMark method={payment.method} />
          <span>cobró {payment.created_by_name}</span>
        </span>
        {notes.map((note) => (
          <span key={note} className="caja-line-note">
            {note}
          </span>
        ))}
        {voided ? (
          <span className="caja-line-note is-why">
            {payment.void_reason ? `«${payment.void_reason}»` : 'Sin motivo'}
            {payment.voided_by_name ? ` · anuló ${payment.voided_by_name}` : ''}
            {payment.voided_at ? ` ${clockAt(payment.voided_at, timeZone)}` : ''}
          </span>
        ) : null}
      </span>
      <span className="caja-line-end">
        <span className="caja-line-sum">{formatCentsShort(payment.total_cents)}</span>
        {voided ? (
          <span className="caja-stamp is-void">
            <Ban aria-hidden strokeWidth={3} />
            Anulado
          </span>
        ) : null}
      </span>
    </button>
  )
}

function MovementRow({
  movement,
  timeZone,
  marked,
  onOpen,
}: {
  movement: CashMovement
  timeZone: string
  marked: boolean
  onOpen: (movement: CashMovement) => void
}) {
  const out = movement.kind === 'out'
  const voided = Boolean(movement.voided_at)
  const Icon = out ? BanknoteArrowUp : BanknoteArrowDown
  return (
    <button
      type="button"
      className={cn('caja-line is-hand', voided && 'is-void', marked && 'is-mark')}
      onClick={() => onOpen(movement)}
      data-testid={`movimiento-${movement.id}`}
    >
      <time dateTime={movement.at}>{clockAt(movement.at, timeZone)}</time>
      <span className="caja-line-body">
        <span className="caja-line-title">
          {out ? 'Retiro' : 'Ingreso'}
          <em> · {movement.reason}</em>
        </span>
        <span className="caja-line-meta">
          <span className="caja-method">
            <Icon aria-hidden strokeWidth={2.3} />
            Cajón
          </span>
          <span>anotó {movement.by_name}</span>
        </span>
        {voided ? (
          <span className="caja-line-note is-why">
            {movement.void_reason ? `«${movement.void_reason}»` : 'Sin motivo'}
            {movement.voided_by_name ? ` · anuló ${movement.voided_by_name}` : ''}
            {movement.voided_at ? ` ${clockAt(movement.voided_at, timeZone)}` : ''}
          </span>
        ) : null}
      </span>
      <span className="caja-line-end">
        <span className="caja-line-sum">
          {out ? '− ' : '+ '}
          {formatCentsShort(movement.amount_cents)}
        </span>
        {voided ? (
          <span className="caja-stamp is-void">
            <Ban aria-hidden strokeWidth={3} />
            Anulado
          </span>
        ) : null}
      </span>
    </button>
  )
}

function OpeningRow({ shift, timeZone }: { shift: Shift; timeZone: string }) {
  const opening = openingLine(shift)
  return (
    <div className="caja-line is-hand">
      <time dateTime={shift.opened_at}>{clockAt(shift.opened_at, timeZone)}</time>
      <span className="caja-line-body">
        <span className="caja-line-title">
          Se abrió el turno
          {shift.label ? <em> · {shift.label}</em> : null}
        </span>
        <span className={cn('caja-line-note', opening.differs ? 'is-why' : 'is-ink')}>
          {opening.text}
        </span>
        {shift.opening_note ? (
          <span className="caja-line-note is-ink">«{shift.opening_note}»</span>
        ) : null}
      </span>
      <span className="caja-line-end">
        <span className="caja-line-sum">{formatCentsShort(shift.opening_float_cents)}</span>
      </span>
    </div>
  )
}

function ClosingRow({ shift, timeZone }: { shift: Shift; timeZone: string }) {
  const counted = shift.counted_cash_cents
  const difference =
    shift.difference_cents === null ? null : differenceWords(shift.difference_cents, 'past')
  return (
    <div className="caja-line is-hand">
      <time dateTime={shift.closed_at ?? undefined}>{clockAt(shift.closed_at, timeZone)}</time>
      <span className="caja-line-body">
        <span className="caja-line-title">Se cerró el turno</span>
        <span className={cn('caja-line-note', difference?.kind === 'short' ? 'is-why' : 'is-ink')}>
          {shift.closed_by_name ?? 'Alguien'} contó el cajón
          {difference ? `: ${difference.text.toLowerCase()}` : ''}
        </span>
      </span>
      <span className="caja-line-end">
        {counted !== null ? (
          <span className="caja-line-sum">{formatCentsShort(counted)}</span>
        ) : null}
        <span className="caja-stamp is-closed">
          <LockKeyhole aria-hidden strokeWidth={2.8} />
          Cerrado
        </span>
      </span>
    </div>
  )
}
