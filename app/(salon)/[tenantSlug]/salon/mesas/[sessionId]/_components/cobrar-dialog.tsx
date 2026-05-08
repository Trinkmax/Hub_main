'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { markSessionPaid } from '@/lib/sessions-waiter/actions'
import type { CobroBreakdown } from '@/lib/sessions-waiter/queries'

export function CobrarDialog({
  tenantSlug,
  sessionId,
  breakdown,
  open,
  onClose,
  onPaid,
}: {
  tenantSlug: string
  sessionId: string
  breakdown: CobroBreakdown
  open: boolean
  onClose: () => void
  onPaid: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = () => {
    startTransition(async () => {
      setError(null)
      const r = await markSessionPaid(tenantSlug, sessionId)
      if (r.ok) {
        toast.success(
          r.totalPoints > 0
            ? `Cobrada. Se asignaron ${r.totalPoints} pts entre ${r.visitsCreated} comensal(es).`
            : 'Cobrada.',
        )
        onPaid()
      } else {
        setError(r.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar mesa</DialogTitle>
          <DialogDescription>
            Total a cobrar: <strong>${(breakdown.total_cents / 100).toFixed(2)}</strong>. Confirmá
            cuando hayas recibido el pago — esto cierra la sesión y suma puntos a los comensales
            registrados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {breakdown.guests.map((g) => (
            <div key={g.guest_id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {g.display_name ?? `Guest #${g.guest_id.slice(0, 4)}`}
                  {g.customer_id && (
                    <span className="ml-1.5 text-xs text-primary">· suma puntos ✓</span>
                  )}
                </p>
                <p className="font-semibold">${(g.total_cents / 100).toFixed(2)}</p>
              </div>
              {g.items.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {g.items.map((it) => (
                    <li key={`${g.guest_id}-${it.name}-${it.line_total_cents}`}>
                      {it.quantity}× {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {breakdown.shared_items.length > 0 && (
            <div className="rounded-lg border border-dashed p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-muted-foreground">Compartido / mozo (sin puntos)</p>
                <p className="font-semibold">${(breakdown.shared_total_cents / 100).toFixed(2)}</p>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                {breakdown.shared_items.map((it) => (
                  <li key={`shared-${it.name}-${it.line_total_cents}`}>
                    {it.quantity}× {it.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={pending}>
            {pending
              ? 'Cobrando…'
              : `Confirmar cobro · $${(breakdown.total_cents / 100).toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
