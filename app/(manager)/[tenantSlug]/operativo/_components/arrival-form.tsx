'use client'

import { Check } from 'lucide-react'
import { useState } from 'react'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { Button } from '@/components/ui/button'
import { Field, FormActions } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { TableEditor } from './table-editor'

/** Lo mismo que acepta la acción (`actualGuestsSchema`): cero no es un conteo, es «no vino». */
const MIN_GUESTS = 1
const MAX_GUESTS = 99

/**
 * "Llegó": cuántos vinieron y a qué mesa van, en un solo paso.
 *
 * Es el único momento en que alguien tiene a la gente adelante, así que el
 * número arranca en lo reservado (confirmar es un toque) y la mesa es
 * opcional (se puede asignar después). El botón dice exactamente qué va a
 * guardar para que no haga falta releer.
 *
 * El conteo es el `NumberField` del kit: − y + grandes, y también se tipea
 * (un grupo de 24 no son 20 toques).
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
  // `null` mientras lo tipeado no es un número válido (el campo explica por qué).
  const [guests, setGuests] = useState<number | null>(r.actual_guests ?? r.estimated_guests)
  const [table, setTable] = useState(r.table_label ?? '')
  const [busy, setBusy] = useState(false)
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  const closing = variant === 'close'
  const cleanTable = table.trim().replace(/\s+/g, ' ')
  const delta = guests === null ? 0 : guests - r.estimated_guests

  const submit = async () => {
    if (busy || guests === null) return
    setBusy(true)
    const ok = await onConfirm(guests, cleanTable ? cleanTable : null)
    // Si falló, el form se queda: la anfitriona no tiene que volver a contar.
    if (!ok) setBusy(false)
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-1 pb-4 sm:px-5">
      {alerts.length > 0 ? <ServiceAlertChips alerts={alerts} /> : null}

      <Field
        label={closing ? '¿Cuántos fueron al final?' : '¿Cuántos llegaron?'}
        hint={
          <>
            Reservaron {r.estimated_guests}
            {delta !== 0 ? (
              <span
                className={cn('font-medium', delta > 0 ? 'text-foreground' : 'text-warning-text')}
              >
                {' · '}
                {delta > 0 ? `vinieron ${delta} más` : `faltaron ${Math.abs(delta)}`}
              </span>
            ) : null}
          </>
        }
      >
        <NumberField
          size="lg"
          value={guests}
          onValueChange={setGuests}
          min={MIN_GUESTS}
          max={MAX_GUESTS}
          suffix={guests === 1 ? 'persona' : 'personas'}
          incrementLabel="Una persona más"
          decrementLabel="Una persona menos"
        />
      </Field>

      {!closing ? (
        <Field label="¿A qué mesa van?" optional hint="Se puede asignar después.">
          <TableEditor
            value={table}
            onChange={setTable}
            occupied={occupied}
            currentId={r.id}
            usedToday={usedToday}
            onSubmit={submit}
          />
        </Field>
      ) : null}

      <FormActions sticky={false}>
        <Button type="button" variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
          Volver
        </Button>
        <Button
          type="button"
          size="lg"
          className="sm:flex-1"
          loading={busy}
          disabled={!busy && guests === null}
          onClick={submit}
        >
          <Check strokeWidth={2.5} aria-hidden="true" />
          <span className="truncate">
            {closing ? 'Cerrar' : 'Confirmar'}
            {guests !== null ? ` · ${guests} ${guests === 1 ? 'persona' : 'personas'}` : ''}
            {!closing && cleanTable ? ` · Mesa ${cleanTable}` : ''}
          </span>
        </Button>
      </FormActions>
    </div>
  )
}
