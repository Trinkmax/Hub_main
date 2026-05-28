'use client'

import { ClipboardList, X } from 'lucide-react'
import { useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cancelTicket, type SessionStateData } from '@/lib/m-session/actions'

type Ticket = SessionStateData['my_tickets'][number]
type BadgeVariant = 'warning' | 'info' | 'success' | 'muted' | 'destructive'

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Esperando confirmación', variant: 'warning' },
  accepted: { label: 'En preparación', variant: 'info' },
  preparing: { label: 'En preparación', variant: 'info' },
  ready: { label: 'Listo', variant: 'success' },
  served: { label: 'Servido', variant: 'muted' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
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
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
          <ClipboardList className="size-6" aria-hidden />
        </span>
        <p className="text-sm font-medium">No pediste nada todavía</p>
        <p className="max-w-[28ch] text-xs text-muted-foreground">
          Andá a Carta y armá tu pedido. Acá vas a ver el estado en vivo.
        </p>
      </div>
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
      {tickets.map((t) => {
        const meta = STATUS_META[t.status] ?? { label: t.status, variant: 'muted' as const }
        const canCancel = t.status === 'pending' && withinCancelWindow(t.submitted_at)
        return (
          <article
            key={t.id}
            className="card-hairline rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
          >
            <header className="flex items-start justify-between gap-2 border-b border-border/40 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Comanda #{t.id.slice(0, 6)}
                </p>
                <div className="mt-1">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </div>
              </div>
              <span className="font-serif text-lg font-semibold tabular-nums">
                {ARSFormat(t.total_cents)}
              </span>
            </header>

            <ul className="mt-3 space-y-1.5 text-sm">
              {t.items.map((it) => (
                <li
                  key={it.id}
                  className={
                    it.cancelled_at
                      ? 'flex items-start justify-between gap-2 text-xs text-muted-foreground line-through'
                      : 'flex items-start justify-between gap-2'
                  }
                >
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="font-semibold tabular-nums">{it.quantity}×</span>{' '}
                      {it.menu_item_name ?? 'Ítem'}
                    </p>
                    {it.notes && <p className="mt-0.5 text-xs text-muted-foreground">{it.notes}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {ARSFormat(it.line_total_cents)}
                  </span>
                </li>
              ))}
            </ul>

            {canCancel && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => handleCancel(t.id)}
                className="mt-3 h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
                Cancelar
              </Button>
            )}
            {t.cancellation_reason && (
              <p className="mt-2 text-xs text-destructive">{t.cancellation_reason}</p>
            )}
          </article>
        )
      })}
    </div>
  )
}
