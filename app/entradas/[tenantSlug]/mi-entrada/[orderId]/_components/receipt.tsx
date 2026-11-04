import { paymentTypeLabel } from '@/lib/ticketing/copy'
import { formatShortCode } from '@/lib/ticketing/door'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { PublicOrder } from '@/lib/ticketing/types'

/**
 * El comprobante: un ticket de papel térmico que sale de atrás de la entrada.
 * Es lo que pedían los clientes al pagar la seña: cuánto, cuándo, a nombre de
 * quién, el número de operación y cuánto falta.
 */
export function Receipt({
  order,
  tenantName,
  paidCents,
  balanceCents,
}: {
  order: PublicOrder
  tenantName: string
  paidCents: number
  balanceCents: number
}) {
  const deposit = order.option === 'deposit'
  return (
    <div className="ent-receipt-slot">
      <section className="ent-receipt" aria-label="Comprobante de pago">
        {order.sample ? (
          <p className="mb-1 text-center text-[0.68rem] font-bold tracking-[0.2em]">
            MUESTRA · NO ES UNA COMPRA
          </p>
        ) : null}
        <p className="text-center text-[0.8rem] font-bold tracking-wide">{tenantName}</p>
        <p className="text-center font-bold">
          {deposit ? 'COMPROBANTE DE SEÑA' : 'COMPROBANTE DE PAGO'}
        </p>

        <hr className="ent-receipt-rule" />
        <Line label="Función" value={order.title} />
        <Line label="A nombre de" value={order.guestShortName} />
        <Line label="Entrada" value={formatShortCode(order.shortCode)} />

        <hr className="ent-receipt-rule" />
        <Line
          label={`${order.partySize} × ${deposit ? 'seña' : 'entrada'} ${formatPesos(order.unitPriceCents)}`}
          value={formatPesos(order.totalCents)}
        />
        {paidCents !== order.totalCents ? (
          <Line label="Acreditado" value={formatPesos(paidCents)} />
        ) : null}

        <hr className="ent-receipt-rule" />
        <div className="flex items-baseline justify-between gap-3 text-[0.95rem] font-bold">
          <span>PAGASTE</span>
          <span className="tabular-nums">{formatPesos(paidCents)}</span>
        </div>
        {balanceCents > 0 ? (
          <Line
            label={order.balanceCashOnly ? 'Resta, en efectivo' : 'Resta, en el local'}
            value={formatPesos(balanceCents)}
          />
        ) : (
          <p>La entrada ya está paga.</p>
        )}

        <hr className="ent-receipt-rule" />
        <p>{paymentTypeLabel(order.mpPaymentType)} · Mercado Pago</p>
        {order.mpPaymentId ? <p>Operación {order.mpPaymentId}</p> : null}
        {order.paidAtLabel ? <p>{order.paidAtLabel} hs</p> : null}

        {order.terms ? (
          <>
            <hr className="ent-receipt-rule" />
            <p className="text-[0.68rem] leading-[1.5] whitespace-pre-line">{order.terms}</p>
          </>
        ) : null}

        <p className="mt-3 text-center text-[0.68rem]">Documento no válido como factura.</p>
      </section>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{value}</span>
    </div>
  )
}
