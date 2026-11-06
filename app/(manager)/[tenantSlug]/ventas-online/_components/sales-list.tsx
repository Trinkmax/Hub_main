import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  ChevronDown,
  MessageCircle,
  Receipt,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
import {
  attentionView,
  canRefund,
  formatOrderTime,
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
} from '@/lib/ticketing/order-view'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { AdminOrder } from '@/lib/ticketing/queries'
import {
  type SalesDay,
  type SalesPage,
  salesDaySummary,
  salesDayTitle,
} from '@/lib/ticketing/sales-days'
import { canConfirmTransfer, isManualTransfer } from '@/lib/ticketing/transfer'
import { cn } from '@/lib/utils'
import { ConfirmTransferButton } from './confirm-transfer-button'
import { RefundOrderButton } from './refund-order-button'
import { RetryButton } from './retry-button'

export type SalesResult =
  | { ok: true; days: SalesDay<AdminOrder>[]; previousTo: string | null }
  | { ok: false }

const TONE_CLASS: Record<OrderTone, string> = {
  paid: 'border-success/30 bg-success/10 text-success',
  paying: 'border-info/30 bg-info/10 text-foreground',
  retrying: 'border-warning/40 bg-warning/15 text-warning-text',
  unpaid: 'border-border bg-muted/60 text-muted-foreground',
  refunded: 'border-border bg-muted/60 text-muted-foreground',
}

/** Lo que cada compra sabe de quién mira y de la página. */
type RowContext = {
  tenantSlug: string
  appUrl: string
  now: Date
  /** El bar cargó un alias: puede haber transferencias que confirmar. */
  transferEnabled: boolean
  /** Devolver y anular: solo el dueño (es mover plata). La anfitriona confirma y nada más. */
  canManageMoney: boolean
}

/**
 * Ventas online, día por día: una tarjeta por día de compra, de la más nueva a la más vieja,
 * con lo cobrado ese día arriba. En el celular cada compra es una tarjeta; en la compu, una fila.
 * Abajo, «Ver días anteriores» trae la semana de la venta anterior.
 *
 * El estado se calcula en el server con la hora del render: un «Pagando…» que vence mientras
 * la pestaña está abierta se corrige al volver a la página (RefreshOnReturn del panel).
 */
export function SalesList({
  tenantSlug,
  appUrl,
  result,
  page,
  now,
  transferEnabled = false,
  canManageMoney = false,
}: {
  tenantSlug: string
  appUrl: string
  result: SalesResult
  page: SalesPage
  now: Date
  transferEnabled?: boolean
  canManageMoney?: boolean
}) {
  if (!result.ok) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="No pudimos cargar las ventas"
        description="Suele ser algo de un momento. Probá de nuevo."
        action={<RetryButton />}
        className="py-10"
      />
    )
  }

  const row: RowContext = { tenantSlug, appUrl, now, transferEnabled, canManageMoney }
  const nothingEver = result.days.length === 0 && page.latest && !result.previousTo

  if (nothingEver) {
    return (
      <EmptyState
        icon={Receipt}
        title="Todavía no hubo ventas online"
        description="Cuando alguien compre desde la cartelera aparece acá: quién, para qué función, cuánto pagó y el link a su reserva."
        className="py-10"
      />
    )
  }

  return (
    <div className="space-y-4">
      {result.days.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No hubo ventas estos días"
          description={
            result.previousTo
              ? 'Las anteriores están más abajo, en «Ver días anteriores».'
              : 'Tampoco hay ventas más viejas.'
          }
          className="py-10"
        />
      ) : (
        result.days.map((group) => (
          <SalesDayCard key={group.day} group={group} today={page.today} row={row} />
        ))
      )}
      <Pager tenantSlug={tenantSlug} page={page} previousTo={result.previousTo} />
    </div>
  )
}

function SalesDayCard({
  group,
  today,
  row,
}: {
  group: SalesDay<AdminOrder>
  today: string
  row: RowContext
}) {
  const { title, date } = salesDayTitle(group.day, today)
  const summary = salesDaySummary(group)
  const headingId = `dia-${group.day}`
  return (
    <section
      aria-labelledby={headingId}
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/60 px-4 py-3 sm:px-5">
        <h2 id={headingId} className="font-serif text-lg font-semibold tracking-tight">
          {title}
          {date ? (
            <span className="ml-2 font-sans text-sm font-normal tracking-normal text-muted-foreground">
              {date}
            </span>
          ) : null}
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          <span className={cn(group.paid > 0 && 'font-medium text-foreground')}>
            {summary.paid}
          </span>
          {summary.unpaid ? ` · ${summary.unpaid}` : null}
        </p>
      </header>
      <div className="p-3 sm:p-4">
        <ul className="grid grid-cols-1 gap-2.5 md:hidden">
          {group.orders.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} row={row} />
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <OrdersTable orders={group.orders} row={row} />
        </div>
      </div>
    </section>
  )
}

/**
 * «Ver días anteriores» y, si no es esta semana, «Volver a hoy». Centrado a propósito: en la
 * compu Tex vive abajo a la derecha y en el celular abajo a la izquierda, y taparía el botón.
 */
function Pager({
  tenantSlug,
  page,
  previousTo,
}: {
  tenantSlug: string
  page: SalesPage
  previousTo: string | null
}) {
  const base = `/${tenantSlug}/ventas-online`
  return (
    <nav aria-label="Más ventas" className="flex flex-col items-center gap-1.5 pt-2 pb-10">
      {previousTo ? (
        <Button asChild variant="outline" className="h-11 sm:h-9">
          <Link href={`${base}?hasta=${previousTo}`}>
            <ChevronDown className="size-4" aria-hidden />
            Ver días anteriores
          </Link>
        </Button>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">No hay ventas más viejas.</p>
      )}
      {page.latest ? null : (
        <Button asChild variant="ghost" className="h-11 px-3 sm:h-9">
          <Link href={base}>
            <ArrowLeft className="size-4" aria-hidden />
            Volver a hoy
          </Link>
        </Button>
      )}
    </nav>
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

/** Lo deshicieron en la puerta: queda a la vista de los dueños (la anfitriona no lo recibe). */
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
 * escrito: es lo que necesitan los que pagaron antes de que existiera el QR, y lo que
 * sigue después de confirmar una transferencia.
 */
function SendTicket({ order, row }: { order: AdminOrder; row: RowContext }) {
  if (order.status !== 'approved') return null
  const link = `${row.appUrl}/entradas/${row.tenantSlug}/mi-entrada/${order.id}`
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
function ReservationLink({ order, row }: { order: AdminOrder; row: RowContext }) {
  if (order.status === 'approved' && order.reservation_id) {
    return (
      <Link
        href={`/${row.tenantSlug}/reservas/${order.reservation_id}`}
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
        href={`/${row.tenantSlug}/reservas/nuevo?date=${order.event_date}`}
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

function Refund({ order, row }: { order: AdminOrder; row: RowContext }) {
  if (!row.canManageMoney || !canRefund(order)) return null
  return (
    <RefundOrderButton
      tenantSlug={row.tenantSlug}
      orderId={order.id}
      guestName={order.guest_name}
      amountLabel={formatPesos(orderAmountCents(order))}
      functionLabel={`${order.title} · ${orderFunctionLabel(order)}`}
      hasReservation={Boolean(order.reservation_id)}
      transfer={isManualTransfer(order.mp_payment_type)}
    />
  )
}

function ConfirmTransfer({ order, row }: { order: AdminOrder; row: RowContext }) {
  if (!row.transferEnabled || !canConfirmTransfer(order, row.now)) return null
  return (
    <ConfirmTransferButton
      tenantSlug={row.tenantSlug}
      orderId={order.id}
      guestName={order.guest_name}
      amountLabel={formatPesos(Number(order.total_cents))}
      functionLabel={`${order.title} · ${orderFunctionLabel(order)}`}
      peopleLabel={peopleLabel(order.party_size)}
      placeReleased={holdExpired(order.hold_expires_at, row.now)}
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

function OrderCard({ order, row }: { order: AdminOrder; row: RowContext }) {
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
          <StatusChip order={order} now={row.now} />
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
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {formatOrderTime(order.created_at)}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <ConfirmTransfer order={order} row={row} />
          <Refund order={order} row={row} />
          <SendTicket order={order} row={row} />
          <ReservationLink order={order} row={row} />
        </div>
      </div>
    </article>
  )
}

function OrdersTable({ orders, row }: { orders: AdminOrder[]; row: RowContext }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Hora</TableHead>
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
              {formatOrderTime(order.created_at)}
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
              <StatusChip order={order} now={row.now} />
              <EntryChip order={order} />
              <UndoChip order={order} />
              <Attention order={order} />
            </TableCell>
            <TableCell className="align-top text-right">
              <div className="flex flex-col items-end gap-1">
                <ConfirmTransfer order={order} row={row} />
                <SendTicket order={order} row={row} />
                <ReservationLink order={order} row={row} />
                {/* El botón fantasma tiene relleno: así el texto queda alineado con «Ver reserva». */}
                <div className="-mr-2.5">
                  <Refund order={order} row={row} />
                </div>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
