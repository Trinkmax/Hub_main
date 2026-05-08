'use client'

import { Coins, MoreVertical, Receipt, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { markSessionAbandoned } from '@/lib/sessions-waiter/actions'
import type { CobroBreakdown, WaiterSessionDetail } from '@/lib/sessions-waiter/queries'
import type { TicketItemRow, TicketRow } from '@/lib/tickets/queries'
import { CobrarDialog } from './cobrar-dialog'
import { TicketCard } from './ticket-card'

export function SessionDetail({
  tenantSlug,
  session,
  initialTickets,
  initialItems,
}: {
  tenantSlug: string
  session: WaiterSessionDetail
  initialTickets: TicketRow[]
  initialItems: TicketItemRow[]
}) {
  const [tickets, setTickets] = useState(initialTickets)
  const [items, setItems] = useState(initialItems)
  const [billRequested, setBillRequested] = useState(session.bill_requested)
  const [showCobro, setShowCobro] = useState(false)
  const [breakdown, setBreakdown] = useState<CobroBreakdown | null>(null)
  const [sessionStatus, setSessionStatus] = useState(session.status)
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false)
  const [opPending, startOp] = useTransition()

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/snapshot`, {
      cache: 'no-store',
    })
    if (res.ok) {
      const data = (await res.json()) as {
        tickets: TicketRow[]
        items: TicketItemRow[]
        bill_requested: boolean
        status?: string
      }
      setTickets(data.tickets)
      setItems(data.items)
      setBillRequested(data.bill_requested)
      if (data.status) setSessionStatus(data.status)
    }
  }, [session.id])

  const openCobro = async () => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/breakdown`, {
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = (await res.json()) as { breakdown: CobroBreakdown }
    setBreakdown(data.breakdown)
    setShowCobro(true)
  }

  const handleAbandon = () => {
    startOp(async () => {
      const r = await markSessionAbandoned(tenantSlug, session.id, 'Mozo cerró manualmente')
      if (r.ok) {
        toast.success('Sesión marcada como abandoned')
        setShowAbandonConfirm(false)
        void refresh()
      } else {
        toast.error(r.message)
      }
    })
  }

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `session-${session.id}`,
      events: [
        {
          event: '*',
          table: 'tickets',
          filter: `session_id=eq.${session.id}`,
          onChange: () => void refresh(),
        },
        { event: '*', table: 'ticket_items', onChange: () => void refresh() },
        {
          event: 'INSERT',
          table: 'table_session_events',
          filter: `session_id=eq.${session.id}`,
          onChange: () => void refresh(),
        },
      ],
    })
    return cleanup
  }, [session.id, refresh])

  const itemsByTicket = new Map<string, TicketItemRow[]>()
  for (const it of items) {
    const arr = itemsByTicket.get(it.ticket_id) ?? []
    arr.push(it)
    itemsByTicket.set(it.ticket_id, arr)
  }

  return (
    <div className="space-y-4">
      {sessionStatus === 'open' && (
        <div className="flex justify-end gap-2">
          <Button onClick={openCobro} size="sm">
            <Coins className="mr-1.5 size-4" />
            Cobrar mesa
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setShowAbandonConfirm(true)}
                className="text-destructive"
              >
                <XCircle className="mr-1.5 size-4" />
                Marcar abandoned
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {sessionStatus === 'paid' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Sesión cobrada. La mesa quedó libre y el QR rotó.
        </div>
      )}

      {sessionStatus === 'abandoned' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Sesión marcada como abandoned. No se generaron puntos.
        </div>
      )}

      <AlertDialog open={showAbandonConfirm} onOpenChange={setShowAbandonConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como abandoned</AlertDialogTitle>
            <AlertDialogDescription>
              Esto cierra la sesión sin cobrar y sin generar puntos. Usalo cuando la mesa se fue sin
              pagar. Quedan registradas las comandas para auditoría.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAbandon} disabled={opPending}>
              {opPending ? 'Marcando…' : 'Sí, marcar abandoned'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {billRequested && sessionStatus === 'open' && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <Receipt className="size-4 text-destructive" />
          <span>El comensal pidió la cuenta.</span>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comensales ({session.guests.length})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {session.guests.map((g) => (
            <Badge key={g.id} variant={g.customer_id ? 'default' : 'outline'}>
              {g.display_name ?? `Guest #${g.id.slice(0, 4)}`}
              {g.customer_id ? ' ✓' : ''}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comandas ({tickets.length})
        </h2>
        <div className="space-y-2">
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin comandas todavía.</p>
          ) : (
            tickets.map((t) => (
              <TicketCard
                key={t.id}
                tenantSlug={tenantSlug}
                ticket={t}
                items={itemsByTicket.get(t.id) ?? []}
                onChange={refresh}
              />
            ))
          )}
        </div>
      </section>

      {showCobro && breakdown && (
        <CobrarDialog
          tenantSlug={tenantSlug}
          sessionId={session.id}
          breakdown={breakdown}
          open={showCobro}
          onClose={() => setShowCobro(false)}
          onPaid={() => {
            setShowCobro(false)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
