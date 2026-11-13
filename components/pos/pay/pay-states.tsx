'use client'

import { BadgeCheck, LoaderCircle, LockKeyhole, Stamp, Star, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { groupThousands } from '@/lib/money'
import type { Bill, Payment, PointsAwarded } from '@/lib/pos/cash/types'
import { clockAt } from '@/lib/pos/order/clock'
import type { BillMode } from '@/lib/pos/pay/mode'
import { money } from './pay-types'

/**
 * Los momentos en que el talón no cobra: la caja está cerrada, la seña ya cubre todo, quedó cobrado
 * de más, la mesa ya se cobró. Cada uno dice qué pasa y deja a mano la única cosa que se puede hacer.
 */

const points = (n: number): string => groupThousands(String(Math.max(0, Math.round(n))))

export function NoShiftState({
  canOpenShift,
  cashHref,
}: {
  canOpenShift: boolean
  cashHref: string
}) {
  return (
    <div className="pay-state" data-testid="pay-no-shift">
      <h3>
        <LockKeyhole aria-hidden strokeWidth={2.3} />
        La caja está cerrada
      </h3>
      {canOpenShift ? (
        <>
          <p>Para cobrar hay que abrir el turno. Abrila y volvé: la cuenta te espera acá.</p>
          <Link href={cashHref} className="pay-go" data-testid="pay-open-shift">
            Abrir la caja
          </Link>
        </>
      ) : (
        <p>
          Para cobrar hay que abrir el turno. <b>Pedile al encargado que la abra desde Caja</b>:
          esta pantalla se pone al día sola.
        </p>
      )}
    </div>
  )
}

export function SettledState({
  mode,
  bill,
  busy,
  onClose,
}: {
  mode: Extract<BillMode, { kind: 'settled' }>
  bill: Bill
  busy: boolean
  onClose: () => void
}) {
  const why =
    mode.by === 'deposit'
      ? `La seña de ${money(bill.bill.deposit_cents)} cubre toda la cuenta.`
      : mode.by === 'discount'
        ? 'El descuento cubre toda la cuenta.'
        : mode.by === 'both'
          ? 'Entre la seña y el descuento, la cuenta quedó en cero.'
          : 'Con lo que ya se cobró, la cuenta está cubierta.'
  return (
    <div className="pay-state" data-testid="pay-settled">
      <h3>
        <BadgeCheck aria-hidden strokeWidth={2.3} />
        No falta cobrar nada
      </h3>
      <p>{why}</p>
      {mode.canClose ? (
        <button
          type="button"
          className="pay-go"
          onClick={onClose}
          disabled={busy}
          data-testid="pay-close-table"
        >
          {busy ? <LoaderCircle className="pay-spin" aria-hidden strokeWidth={2.6} /> : null}
          {busy
            ? 'Cerrando…'
            : mode.by === 'payments'
              ? 'Cerrar la mesa'
              : 'Cerrar la mesa sin cobrar'}
        </button>
      ) : (
        <p>
          <b>La cierra el encargado</b>: una cuenta en cero sin ningún cobro necesita su OK.
        </p>
      )}
    </div>
  )
}

export function OverpaidState({ mode }: { mode: Extract<BillMode, { kind: 'overpaid' }> }) {
  return (
    <div className="pay-state" data-testid="pay-overpaid">
      <h3>
        <TriangleAlert aria-hidden strokeWidth={2.3} />
        Quedaron {money(mode.cents)} cobrados de más
      </h3>
      <p>
        Pasa cuando se da algo de baja o se descuenta después de cobrar.{' '}
        {mode.canVoid ? (
          <>
            <b>Tocá un cobro en la cuenta y anulalo</b>; después cobralo de nuevo por lo que
            corresponde.
          </>
        ) : (
          <>
            <b>Avisale a la caja</b>: hay que anular un cobro y hacerlo de nuevo.
          </>
        )}
      </p>
    </div>
  )
}

export function EmptyState({ orderHref }: { orderHref: string }) {
  return (
    <div className="pay-state" data-testid="pay-empty">
      <h3>Todavía no pidieron nada</h3>
      <p>No hay nada que cobrar en esta mesa. Si se van, se libera desde el salón.</p>
      <Link href={orderHref} className="pay-go">
        Volver a la comanda
      </Link>
    </div>
  )
}

export function GoneState({ mapHref }: { mapHref: string }) {
  return (
    <div className="pay-state" data-testid="pay-gone">
      <h3>Esta mesa ya no está abierta</h3>
      <p>Se juntó con otra o se liberó. Buscala en el salón.</p>
      <Link href={mapHref} className="pay-go">
        Volver al salón
      </Link>
    </div>
  )
}

export function ClosedState({
  bill,
  awarded,
  lastPayment,
  timeZone,
  mapHref,
}: {
  bill: Bill
  /** Los puntos que sumó el socio (los trae el cobro que cerró, o la cuenta ya cerrada). */
  awarded: PointsAwarded | null
  /** El cobro que cerró la mesa recién: si hubo vuelto, se sigue viendo. */
  lastPayment: Payment | null
  timeZone: string
  mapHref: string
}) {
  const change = lastPayment?.change_cents ?? 0
  const closedAt = bill.closed?.at ?? bill.session.paid_at
  return (
    <div className="pay-state" data-testid="pay-closed">
      <h3>
        <Stamp aria-hidden strokeWidth={2.3} />
        Mesa cobrada
      </h3>
      {change > 0 ? (
        <p className="pay-change" data-testid="pay-change">
          <span>Vuelto</span>
          <b>{money(change)}</b>
        </p>
      ) : null}
      {awarded ? (
        awarded.failed ? (
          <p className="pay-alert" role="status">
            <TriangleAlert aria-hidden strokeWidth={2.4} />
            <span>
              No se le pudieron sumar los puntos a {awarded.first_name}.
              <small>La mesa se cobró igual. Avisale al dueño para que se los cargue.</small>
            </span>
          </p>
        ) : (
          <p className="pay-points" data-testid="pay-points">
            <Star aria-hidden strokeWidth={2.4} />
            <span>
              {awarded.awarded > 0 ? (
                <>
                  <b>
                    {awarded.first_name} sumó {points(awarded.awarded)}{' '}
                    {awarded.awarded === 1 ? 'punto' : 'puntos'}.
                  </b>{' '}
                  Ahora tiene {points(awarded.balance)}.
                </>
              ) : (
                <>
                  {awarded.first_name} no sumó puntos con esta cuenta. Tiene{' '}
                  {points(awarded.balance)}.
                </>
              )}
            </span>
          </p>
        )
      ) : null}
      {bill.closed ? (
        <p>
          La cerró {bill.closed.by_name}
          {closedAt ? ` a las ${clockAt(closedAt, timeZone)}` : ''}. Un cobro mal cargado se corrige
          desde Caja.
        </p>
      ) : null}
      <Link href={mapHref} className="pay-go" data-testid="pay-back-to-floor">
        Volver al salón
      </Link>
    </div>
  )
}
