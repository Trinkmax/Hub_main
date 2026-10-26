import { ArrowRight, CalendarPlus, Receipt, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPhoneForDisplay } from '@/lib/phone'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { AdminOrder } from '@/lib/ticketing/queries'
import { cn } from '@/lib/utils'
import {
  attentionView,
  formatOrderMoment,
  type OrderTone,
  orderAmountCents,
  orderFunctionLabel,
  orderStatusView,
  paymentOptionLabel,
  peopleLabel,
} from '../_lib/orders'
import { PanelSection } from './panel-section'
import { RetryButton } from './retry-button'

export type OrdersResult = { ok: true; orders: AdminOrder[] } | { ok: false }

const TONE_CLASS: Record<OrderTone, string> = {
  paid: 'border-success/30 bg-success/10 text-success',
  paying: 'border-info/30 bg-info/10 text-foreground',
  retrying: 'border-warning/40 bg-warning/15 text-warning-text',
  unpaid: 'border-border bg-muted/60 text-muted-foreground',
  refunded: 'border-border bg-muted/60 text-muted-foreground',
}

/**
 * Ventas online: las últimas compras, pagadas, en curso y las que no se
 * pagaron. En el celular cada una es una tarjeta; en la compu, una fila.
 *
 * El estado se calcula en el server con la hora del render: un «Pagando…» que
 * vence mientras la pestaña está abierta se corrige al volver a la página
 * (RefreshOnReturn del panel).
 */
export function OrdersSection({
  tenantSlug,
  result,
  now,
}: {
  tenantSlug: string
  result: OrdersResult
  now: Date
}) {
  return (
    <PanelSection
      id="ventas"
      icon={Receipt}
      title="Ventas online"
      description="Las últimas compras desde la cartelera. Cuando se pagan, la reserva se carga sola."
    >
      {!result.ok ? (
        <EmptyState
          icon={TriangleAlert}
          title="No pudimos cargar las ventas"
          description="Suele ser algo de un momento. Probá de nuevo; el resto de la pantalla funciona igual."
          action={<RetryButton />}
          className="py-10"
        />
      ) : result.orders.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Todavía no hubo ventas online"
          description="Cuando alguien compre desde la cartelera aparece acá: quién, para qué función, cuánto pagó y el link a su reserva."
          className="py-10"
        />
      ) : (
        <>
          <ul className="grid gap-2.5 md:hidden">
            {result.orders.map((order) => (
              <li key={order.id}>
                <OrderCard tenantSlug={tenantSlug} order={order} now={now} />
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <OrdersTable tenantSlug={tenantSlug} orders={result.orders} now={now} />
          </div>
        </>
      )}
    </PanelSection>
  )
}

function StatusChip({ order, now }: { order: AdminOrder; now: Date }) {
  const status = orderStatusView(order, now)
  return (
    <span
      title={status.hint}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[status.tone],
      )}
    >
      {status.tone === 'paying' ? (
        <span aria-hidden className="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
      ) : null}
      {status.label}
    </span>
  )
}

function Attention({ order }: { order: AdminOrder }) {
  const attention = attentionView(order.attention)
  if (!attention) return null
  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <TriangleAlert className="size-3 shrink-0" aria-hidden />
        {attention.label}
      </span>
      <p className="max-w-xs text-[11px] leading-snug text-muted-foreground text-pretty">
        {attention.hint}
      </p>
    </div>
  )
}

/** El link a la reserva (si se creó) o, si la fecha ya no existe, a cargarla a mano. */
function ReservationLink({ tenantSlug, order }: { tenantSlug: string; order: AdminOrder }) {
  if (order.status === 'approved' && order.reservation_id) {
    return (
      <Link
        href={`/${tenantSlug}/reservas/${order.reservation_id}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline md:min-h-0"
      >
        Ver reserva
        <ArrowRight className="size-3.5" aria-hidden />
        <span className="sr-only">de {order.guest_name}</span>
      </Link>
    )
  }
  if (order.status === 'approved' && order.attention === 'event_missing') {
    return (
      <Link
        href={`/${tenantSlug}/reservas/nuevo?date=${order.event_date}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-destructive underline-offset-2 hover:underline md:min-h-0"
      >
        <CalendarPlus className="size-3.5" aria-hidden />
        Cargar la reserva
        <span className="sr-only">de {order.guest_name}</span>
      </Link>
    )
  }
  return null
}

function Amount({ order }: { order: AdminOrder }) {
  return (
    <span className={cn('tabular-nums', order.status === 'refunded' && 'line-through')}>
      {formatPesos(orderAmountCents(order))}
    </span>
  )
}

function OrderCard({
  tenantSlug,
  order,
  now,
}: {
  tenantSlug: string
  order: AdminOrder
  now: Date
}) {
  return (
    <article
      aria-label={`Compra de ${order.guest_name}`}
      className="rounded-xl border border-border/70 bg-background/50 p-3.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{order.guest_name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatPhoneForDisplay(order.guest_phone)}
          </p>
        </div>
        <StatusChip order={order} now={now} />
      </div>
      <p className="mt-2 text-sm">
        <span className="font-medium">{order.title}</span>
        <span className="text-muted-foreground"> · {orderFunctionLabel(order)}</span>
      </p>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {peopleLabel(order.party_size)} · {paymentOptionLabel(order.payment_option)}
        </span>
        <span className="font-semibold">
          <Amount order={order} />
        </span>
      </div>
      {order.attention ? (
        <div className="mt-2">
          <Attention order={order} />
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatOrderMoment(order.created_at, now)}
        </span>
        <ReservationLink tenantSlug={tenantSlug} order={order} />
      </div>
    </article>
  )
}

function OrdersTable({
  tenantSlug,
  orders,
  now,
}: {
  tenantSlug: string
  orders: AdminOrder[]
  now: Date
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Compra</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Función</TableHead>
          <TableHead className="text-right">Personas</TableHead>
          <TableHead className="text-right">Monto</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>
            <span className="sr-only">Reserva</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id}>
            <TableCell className="align-top text-xs text-muted-foreground tabular-nums">
              {formatOrderMoment(order.created_at, now)}
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <div className="font-medium">{order.guest_name}</div>
              <div className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {formatPhoneForDisplay(order.guest_phone)}
              </div>
            </TableCell>
            <TableCell className="align-top">
              <div className="max-w-[14rem] truncate">{order.title}</div>
              <div className="text-xs text-muted-foreground">{orderFunctionLabel(order)}</div>
            </TableCell>
            <TableCell className="align-top text-right tabular-nums">{order.party_size}</TableCell>
            <TableCell className="align-top text-right">
              <div className="font-medium">
                <Amount order={order} />
              </div>
              <div className="text-xs text-muted-foreground">
                {paymentOptionLabel(order.payment_option)}
              </div>
            </TableCell>
            <TableCell className="space-y-1.5 align-top whitespace-normal">
              <StatusChip order={order} now={now} />
              <Attention order={order} />
            </TableCell>
            <TableCell className="align-top text-right">
              <ReservationLink tenantSlug={tenantSlug} order={order} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
