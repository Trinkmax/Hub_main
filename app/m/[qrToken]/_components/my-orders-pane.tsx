'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { cancelTicket, type SessionStateData } from '@/lib/m-session/actions'

type Ticket = SessionStateData['my_tickets'][number]

const STATUS_LABEL: Record<string, string> = {
  pending: 'Esperando confirmación',
  accepted: 'Mozo confirmó · en cocina',
  preparing: 'Preparando',
  ready: 'Listo · esperando que te lo lleven',
  served: 'Entregado',
  cancelled: 'Cancelada',
}

function withinCancelWindow(submittedAt: string): boolean {
  return Date.now() - new Date(submittedAt).getTime() < 60_000
}

export function MyOrdersPane({
  tickets,
  browserToken,
  onCancelled,
}: {
  tickets: Ticket[]
  browserToken: string
  onCancelled: () => void
}) {
  const [pending, startTransition] = useTransition()

  if (tickets.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Todavía no pediste nada. Andá a Carta y armá tu pedido.
      </p>
    )
  }

  const handleCancel = (ticketId: string) => {
    startTransition(async () => {
      const r = await cancelTicket({ ticketId, browserToken })
      if (r.ok) onCancelled()
    })
  }

  return (
    <div className="space-y-3">
      {tickets.map((t) => (
        <div key={t.id} className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Comanda #{t.id.slice(0, 6)}
              </p>
              <p className="text-sm font-medium">{STATUS_LABEL[t.status] ?? t.status}</p>
            </div>
            <p className="text-sm font-semibold">${(t.total_cents / 100).toFixed(2)}</p>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {t.items.map((it) => (
              <li
                key={it.id}
                className={
                  it.cancelled_at ? 'text-xs text-muted-foreground line-through' : 'text-sm'
                }
              >
                {it.quantity}× {it.menu_item_name ?? 'Ítem'}
                {it.notes && <span className="text-xs text-muted-foreground"> — {it.notes}</span>}
              </li>
            ))}
          </ul>
          {t.status === 'pending' && withinCancelWindow(t.submitted_at) && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => handleCancel(t.id)}
            >
              Cancelar
            </Button>
          )}
          {t.cancellation_reason && (
            <p className="mt-2 text-xs text-destructive">{t.cancellation_reason}</p>
          )}
        </div>
      ))}
    </div>
  )
}
