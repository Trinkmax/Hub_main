import { ArrowRight, CalendarPlus, MessageCircle, Receipt, TriangleAlert } from 'lucide-react'
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
import { buildWaMeUrl, formatPhoneForDisplay } from '@/lib/phone'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { AdminOrder } from '@/lib/ticketing/queries'
import { canConfirmTransfer, isManualTransfer } from '@/lib/ticketing/transfer'
import { cn } from '@/lib/utils'
import {
  attentionView,
  canRefund,
  formatOrderMoment,
  holdExpired,
  type OrderTone,
  orderAmountCents,
  orderEntryLabel,
  orderFunctionLabel,
  orderStatusView,
  orderTicketMessage,
  orderUndoLabel,
  paymentOptionLabel,
  peopleLabel,
} from '../_lib/orders'
import { ConfirmTransferButton } from './confirm-transfer-button'
import { PanelSection } from './panel-section'
import { RefundOrderButton } from './refund-order-button'
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
  appUrl,
  result,
  now,
  transferEnabled = false,
}: {
  tenantSlug: string
  appUrl: string
  result: OrdersResult
  now: Date
  /** El bar cargó un alias: puede haber transferencias que confirmar. */
  transferEnabled?: boolean
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
                <OrderCard
                  tenantSlug={tenantSlug}
                  appUrl={appUrl}
                  order={order}
                  now={now}
                  transferEnabled={transferEnabled}
                />
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <OrdersTable
              tenantSlug={tenantSlug}
              appUrl={appUrl}
              orders={result.orders}
              now={now}
              transferEnabled={transferEnabled}
            />
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

/** Ya validada en la puerta (o marcada «Llegó» en la lista). */
function EntryChip({ order }: { order: AdminOrder }) {
  const label = orderEntryLabel(order)
  if (!label) return null
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground tabular-nums">
      {label}
    </span>
  )
}

/** Lo deshicieron en la puerta: queda a la vista de los dueños. */
function UndoChip({ order }: { order: AdminOrder }) {
  if (!order.undo) return null
  const { label, hint } = orderUndoLabel(order.undo)
  return (
    <span
      title={hint}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-text tabular-nums"
    >
      {label}
    </span>
  )
}

/**
 * Mandarle la entrada a quien pagó, por su WhatsApp. Abre el chat con el mensaje
 * escrito: es lo que necesitan los que pagaron antes de que existiera el QR.
 */
function SendTicket({
  tenantSlug,
  appUrl,
  order,
}: {
  tenantSlug: string
  appUrl: string
  order: AdminOrder
}) {
  if (order.status !== 'approved') return null
  const link = `${appUrl}/entradas/${tenantSlug}/mi-entrada/${order.id}`
  const href = buildWaMeUrl(order.guest_phone, orderTicketMessage(order, link))
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline md:min-h-0"
    >
      <MessageCircle className="size-3.5" aria-hidden />
      Mandar entrada
      <span className="sr-only">a {order.guest_name}</span>
    </a>
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

function Refund({ tenantSlug, order }: { tenantSlug: string; order: AdminOrder }) {
  if (!canRefund(order)) return null
  return (
    <RefundOrderButton
      tenantSlug={tenantSlug}
      orderId={order.id}
      guestName={order.guest_name}
      amountLabel={formatPesos(orderAmountCents(order))}
      functionLabel={`${order.title} · ${orderFunctionLabel(order)}`}
      hasReservation={Boolean(order.reservation_id)}
      transfer={isManualTransfer(order.mp_payment_type)}
    />
  )
}

function ConfirmTransfer({
  tenantSlug,
  order,
  now,
  enabled,
}: {
  tenantSlug: string
  order: AdminOrder
  now: Date
  enabled: boolean
}) {
  if (!enabled || !canConfirmTransfer(order, now)) return null
  return (
    <ConfirmTransferButton
      tenantSlug={tenantSlug}
      orderId={order.id}
      guestName={order.guest_name}
      amountLabel={formatPesos(Number(order.total_cents))}
      functionLabel={`${order.title} · ${orderFunctionLabel(order)}`}
      peopleLabel={peopleLabel(order.party_size)}
      placeReleased={holdExpired(order.hold_expires_at, now)}
    />
  )
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
  appUrl,
  order,
  now,
  transferEnabled,
}: {
  tenantSlug: string
  appUrl: string
  order: AdminOrder
  now: Date
  transferEnabled: boolean
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
        <div className="flex flex-col items-end gap-1">
          <StatusChip order={order} now={now} />
          <EntryChip order={order} />
          <UndoChip order={order} />
        </div>
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
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <ConfirmTransfer
            tenantSlug={tenantSlug}
            order={order}
            now={now}
            enabled={transferEnabled}
          />
          <Refund tenantSlug={tenantSlug} order={order} />
          <SendTicket tenantSlug={tenantSlug} appUrl={appUrl} order={order} />
          <ReservationLink tenantSlug={tenantSlug} order={order} />
        </div>
      </div>
    </article>
  )
}

function OrdersTable({
  tenantSlug,
  appUrl,
  orders,
  now,
  transferEnabled,
}: {
  tenantSlug: string
  appUrl: string
  orders: AdminOrder[]
  now: Date
  transferEnabled: boolean
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
              <EntryChip order={order} />
              <UndoChip order={order} />
              <Attention order={order} />
            </TableCell>
            <TableCell className="align-top text-right">
              <div className="flex flex-col items-end gap-1">
                <ConfirmTransfer
                  tenantSlug={tenantSlug}
                  order={order}
                  now={now}
                  enabled={transferEnabled}
                />
                <SendTicket tenantSlug={tenantSlug} appUrl={appUrl} order={order} />
                <ReservationLink tenantSlug={tenantSlug} order={order} />
                {/* El botón fantasma tiene relleno: así el texto queda alineado con «Ver reserva». */}
                <div className="-mr-2.5">
                  <Refund tenantSlug={tenantSlug} order={order} />
                </div>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
