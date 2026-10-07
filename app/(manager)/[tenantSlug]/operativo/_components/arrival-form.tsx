'use client'

import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { GuestCountStepper } from '@/components/reservations/guest-count-stepper'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { Button } from '@/components/ui/button'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { TableEditor } from './table-editor'

/**
 * "Llegó": cuántos vinieron y a qué mesa van, en un solo paso.
 *
 * Es el único momento en que alguien tiene a la gente adelante, así que el
 * número arranca en lo reservado (confirmar es un toque) y la mesa es
 * opcional (se puede asignar después). El botón dice exactamente qué va a
 * guardar para que no haga falta releer.
 */
export function ArrivalForm({
  reservation: r,
  occupied,
  usedToday,
  onConfirm,
  onCancel,
  variant = 'arrive',
}: {
  reservation: ReservationWithJoins
  occupied: Map<string, string>
  usedToday: string[]
  onConfirm: (guests: number, tableLabel: string | null) => Promise<boolean>
  onCancel: () => void
  /** `close` reutiliza el conteo para cerrar la mesa con la cantidad real. */
  variant?: 'arrive' | 'close'
}) {
  const [guests, setGuests] = useState(r.actual_guests ?? r.estimated_guests)
  const [table, setTable] = useState(r.table_label ?? '')
  const [busy, setBusy] = useState(false)
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  const closing = variant === 'close'
  const cleanTable = table.trim().replace(/\s+/g, ' ')
  const delta = guests - r.estimated_guests

  const submit = async () => {
    if (busy) return
    setBusy(true)
    const ok = await onConfirm(guests, cleanTable ? cleanTable : null)
    // Si falló, el form se queda: la anfitriona no tiene que volver a contar.
    if (!ok) setBusy(false)
  }

  return (
    <div className="space-y-5 px-4 pb-4 pt-1 sm:px-5">
      {alerts.length > 0 ? <ServiceAlertChips alerts={alerts} /> : null}

      <section aria-label="Cantidad de personas">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {closing ? '¿Cuántos fueron al final?' : '¿Cuántos llegaron?'}
        </p>
        <GuestCountStepper value={guests} onChange={setGuests} size="lg" className="py-3" />
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          Reservaron {r.estimated_guests}
          {delta !== 0 ? (
            <span
              className={cn('font-medium', delta > 0 ? 'text-foreground' : 'text-warning-text')}
            >
              {' · '}
              {delta > 0 ? `vinieron ${delta} más` : `faltaron ${Math.abs(delta)}`}
            </span>
          ) : null}
        </p>
      </section>

      {!closing ? (
        <section aria-label="Mesa">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            ¿A qué mesa van?{' '}
            <span className="normal-case tracking-normal text-muted-foreground/80">(opcional)</span>
          </p>
          <TableEditor
            value={table}
            onChange={setTable}
            occupied={occupied}
            currentId={r.id}
            usedToday={usedToday}
            onSubmit={submit}
          />
        </section>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-14 rounded-2xl px-5"
          onClick={onCancel}
          disabled={busy}
        >
          Volver
        </Button>
        <Button
          type="button"
          variant={closing ? 'default' : 'success'}
          className="h-14 flex-1 gap-2 rounded-2xl text-base"
          disabled={busy}
          onClick={submit}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Check className="size-5" strokeWidth={2.5} aria-hidden />
          )}
          <span className="truncate">
            {closing ? 'Cerrar' : 'Confirmar'} · {guests} {guests === 1 ? 'persona' : 'personas'}
            {!closing && cleanTable ? ` · Mesa ${cleanTable}` : ''}
          </span>
        </Button>
      </div>
    </div>
  )
}
