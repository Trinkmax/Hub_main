'use client'

import { format } from 'date-fns'
import { Check, ChefHat, Truck, X } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { acceptTicket, rejectTicket, updateTicketStatus } from '@/lib/tickets/actions'
import type { TicketItemRow, TicketRow } from '@/lib/tickets/queries'
import {
  isWaitingOnKitchen,
  TICKET_STATUS_LABELS,
  type TicketStatus,
} from '@/lib/tickets/ticket-flow'
import { cn } from '@/lib/utils'

const STATUS_VARIANTS: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  pending: 'outline',
  accepted: 'default',
  preparing: 'default',
  ready: 'default',
  served: 'secondary',
  cancelled: 'destructive',
}

export function TicketCard({
  tenantSlug,
  ticket,
  items,
  onChange,
  kitchenFlowEnabled = false,
  isSessionOpen = true,
  selectionMode = false,
  selectedQuantities = {},
  onToggleItem,
  onSetItemQuantity,
  onToggleTicket,
}: {
  tenantSlug: string
  ticket: TicketRow
  items: TicketItemRow[]
  onChange: () => void
  kitchenFlowEnabled?: boolean
  /** Cuando la sesión ya no está abierta (cobrada/abandonada/merged), la
   *  comanda es de solo lectura: no se muestran botones de acción. */
  isSessionOpen?: boolean
  /** Modo selección de ítems para mover entre mesas. */
  selectionMode?: boolean
  /** Mapa ticketItemId → cantidad seleccionada (ausente = no seleccionado). */
  selectedQuantities?: Record<string, number>
  onToggleItem?: (item: TicketItemRow, checked: boolean) => void
  onSetItemQuantity?: (itemId: string, qty: number) => void
  onToggleTicket?: (items: TicketItemRow[], checked: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const waitingOnKitchen = isWaitingOnKitchen(ticket.status as TicketStatus, kitchenFlowEnabled)

  const handle = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(success)
        onChange()
      } else {
        toast.error(r.message ?? 'Error')
      }
    })
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            #{ticket.id.slice(0, 6)} · {format(new Date(ticket.submitted_at), 'HH:mm')}
          </p>
          <Badge variant={STATUS_VARIANTS[ticket.status] ?? 'outline'} className="mt-1">
            {TICKET_STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status}
          </Badge>
        </div>
        <p className="font-semibold">${(ticket.total_cents / 100).toFixed(2)}</p>
      </div>
      {selectionMode && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={items.every((it) => it.cancelled_at || selectedQuantities[it.id] != null)}
            onChange={(e) => onToggleTicket?.(items, e.target.checked)}
          />
          Seleccionar comanda entera
        </label>
      )}
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((it) => {
          const selectedQty = selectedQuantities[it.id]
          const isSelected = selectedQty != null
          return (
            <li
              key={it.id}
              className={cn(
                'flex items-center gap-2',
                it.cancelled_at ? 'text-xs text-muted-foreground line-through' : '',
              )}
            >
              {selectionMode && !it.cancelled_at && (
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={isSelected}
                  onChange={(e) => onToggleItem?.(it, e.target.checked)}
                  aria-label={`Seleccionar ${it.menu_item_name ?? 'ítem'}`}
                />
              )}
              <span className="flex-1">
                {it.quantity}× {it.menu_item_name ?? 'Ítem'}
                {it.notes && <span className="text-xs text-muted-foreground"> — {it.notes}</span>}
              </span>
              {selectionMode && isSelected && it.quantity > 1 && (
                <span className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded border"
                    onClick={() => onSetItemQuantity?.(it.id, Math.max(1, (selectedQty ?? 1) - 1))}
                    aria-label="Menos"
                  >
                    −
                  </button>
                  <span className="w-6 text-center tabular-nums">{selectedQty}</span>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded border"
                    onClick={() =>
                      onSetItemQuantity?.(it.id, Math.min(it.quantity, (selectedQty ?? 1) + 1))
                    }
                    aria-label="Más"
                  >
                    +
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {ticket.cancellation_reason && (
        <p className="mt-1 text-xs text-destructive">Motivo: {ticket.cancellation_reason}</p>
      )}
      {isSessionOpen && !selectionMode && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ticket.status === 'pending' && (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => handle(() => acceptTicket(tenantSlug, ticket.id), 'Aceptada')}
              >
                <Check className="mr-1 size-3.5" />
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt('Motivo del rechazo:') ?? ''
                  if (reason.trim()) {
                    handle(() => rejectTicket(tenantSlug, ticket.id, reason.trim()), 'Rechazada')
                  }
                }}
              >
                <X className="mr-1 size-3.5" />
                Rechazar
              </Button>
            </>
          )}
          {waitingOnKitchen && (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <ChefHat className="size-3.5" aria-hidden />
              En cocina…
            </Badge>
          )}
          {!kitchenFlowEnabled && ticket.status === 'accepted' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                handle(
                  () => updateTicketStatus(tenantSlug, ticket.id, 'preparing'),
                  'En preparación',
                )
              }
            >
              <ChefHat className="mr-1 size-3.5" />
              Empezar
            </Button>
          )}
          {!kitchenFlowEnabled && ticket.status === 'preparing' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                handle(() => updateTicketStatus(tenantSlug, ticket.id, 'ready'), 'Listo')
              }
            >
              Listo para servir
            </Button>
          )}
          {ticket.status === 'ready' && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                handle(() => updateTicketStatus(tenantSlug, ticket.id, 'served'), 'Entregado')
              }
            >
              <Truck className="mr-1 size-3.5" />
              Marcar entregado
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
