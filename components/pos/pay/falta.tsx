import { Check } from 'lucide-react'
import { perPerson } from '@/lib/pos/cash/bill'
import type { Bill } from '@/lib/pos/cash/types'
import type { BillMode } from '@/lib/pos/pay/mode'
import { nextPart, partStubs } from '@/lib/pos/pay/plan'
import type { Split } from '@/lib/pos/pay/split'
import { cn } from '@/lib/utils'
import { money } from './pay-types'

/**
 * Lo que falta cobrar: siempre arriba, grande. Es el número que el mozo dice en voz alta.
 *
 * Al lado, lo que ayuda a decirlo: cuántos son y cuánto le toca a cada uno; después de un cobro,
 * cuánto se lleva cobrado. Cuando la mesa se divide en partes iguales, debajo van los talones: uno
 * por parte, con tilde los cobrados y lleno el que toca.
 */

/** Más talones que estos no entran en una fila de celular: el resto se cuenta. */
const MAX_STUBS = 8

export function Falta({
  bill,
  mode,
  split,
  people,
}: {
  bill: Bill
  mode: BillMode
  split: Split
  people: number | null
}) {
  const numbers = bill.bill
  const closed = mode.kind === 'closed'
  const overpaid = mode.kind === 'overpaid'
  const each = perPerson(numbers.due_cents, people)
  const extra = numbers.surcharge_cents + numbers.tip_cents

  const meta: [string, string] | [string] | null = closed
    ? extra > 0
      ? ['más recargo y propina', money(extra)]
      : null
    : numbers.paid_cents > 0
      ? [`Cobrado ${money(numbers.paid_cents)}`, `de ${money(numbers.due_cents)}`]
      : mode.kind === 'settled'
        ? [mode.by === 'discount' ? 'El descuento cubre todo' : 'La seña cubre todo']
        : people && each !== null && people > 1
          ? [`${people} personas`, `${money(each)} c/u`]
          : null

  const dividing = mode.kind === 'charging' && split.kind === 'equal'
  const stubs = dividing ? partStubs(split.parts, bill.payments) : []
  const part = dividing ? nextPart(split.parts, bill.payments, numbers.remaining_cents) : null
  const shown = stubs.slice(0, MAX_STUBS)

  return (
    <section className="pay-falta" aria-label={closed ? 'Lo que se cobró' : 'Lo que falta cobrar'}>
      <p className="pay-falta-main" aria-live="polite" aria-atomic="true" data-testid="pay-falta">
        <span className="pay-falta-word">{closed ? 'Cobrado' : overpaid ? 'De más' : 'Falta'}</span>
        <b className="pay-falta-amount">
          {money(
            closed
              ? numbers.paid_cents
              : overpaid
                ? numbers.overpaid_cents
                : numbers.remaining_cents,
          )}
        </b>
      </p>
      {meta ? (
        <p className="pay-falta-meta">
          <b>{meta[0]}</b>
          {meta[1] ? <span>{meta[1]}</span> : null}
        </p>
      ) : null}

      {part ? (
        <p className="pay-stubs" data-testid="pay-stubs">
          <span aria-hidden className="contents">
            {shown.map((stub) => (
              <span key={stub.number} className={cn('pay-stub', `is-${stub.state}`)}>
                {stub.state === 'paid' ? <Check strokeWidth={3.2} /> : stub.number}
              </span>
            ))}
            {stubs.length > shown.length ? (
              <span className="pay-stubs-more">+{stubs.length - shown.length}</span>
            ) : null}
          </span>
          <span className="pay-stubs-word">
            {part.label} · {money(part.amountCents)}
          </span>
        </p>
      ) : null}
    </section>
  )
}
