'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  MEAL_TYPE_LABELS,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { ReservationStatusControls } from './reservation-status-controls'
import { StatusPill } from './status-pill'

function fmtTime(t: string): string {
  return t.slice(0, 5)
}
function fmtDate(d: string): string {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
function zoneOrEvent(r: ReservationWithJoins): string {
  if (r.zone === 'event_floating') return r.scheduled_event?.template?.name ?? 'Evento'
  return ZONE_LABELS[r.zone]
}

/**
 * Popup de vista + gestión rápida de una reserva. Reemplaza la navegación a la
 * página de detalle desde el listado. La edición a fondo sigue en /reservas/[id]
 * vía el botón "Editar reserva".
 *
 * `trigger` permite usar una fila completa como disparador (popup del día).
 * `onChanged` refresca el contenedor cuando aplica (popup del día).
 */
export function ReservationQuickView({
  tenantSlug,
  reservation,
  onChanged,
  trigger,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const r = reservation
  const guests = r.actual_guests ?? r.estimated_guests
  const guestsHint =
    r.actual_guests != null && r.actual_guests !== r.estimated_guests
      ? ` (est. ${r.estimated_guests})`
      : ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm">
            Ver
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 font-serif">
            <span className="truncate">{r.guest_name}</span>
            <StatusPill status={r.status} />
          </DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Cuándo">
            {fmtDate(r.reservation_date)} · {fmtTime(r.reservation_time_local)}
          </Field>
          <Field label="Dónde">{zoneOrEvent(r)}</Field>
          <Field label="Servicio">{MEAL_TYPE_LABELS[r.meal_type]}</Field>
          <Field label="Naturaleza">{RESERVATION_KIND_LABELS[r.kind]}</Field>
          <Field label="Personas">
            <span className="tabular-nums">{guests}</span>
            <span className="text-[11px] text-muted-foreground">{guestsHint}</span>
          </Field>
          <Field label="Origen">{ORIGIN_LABELS[r.origin]}</Field>
          <Field label="Gestor">
            {r.primary_manager?.display_name ?? '—'}
            {r.assistant_manager ? ` + ${r.assistant_manager.display_name}` : ''}
          </Field>
          {r.cake_count > 0 || r.champagne_count > 0 ? (
            <Field label="Cumpleaños">
              {r.cake_count > 0 ? `🎂 ${r.cake_count}` : ''}
              {r.cake_count > 0 && r.champagne_count > 0 ? ' · ' : ''}
              {r.champagne_count > 0 ? `🍾 ${r.champagne_count}` : ''}
            </Field>
          ) : null}
        </dl>

        {r.comments ? (
          <p className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
            {r.comments}
          </p>
        ) : null}

        <ReservationStatusControls tenantSlug={tenantSlug} reservation={r} onChanged={onChanged} />

        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="outline">
            <Link href={`/${tenantSlug}/reservas/${r.id}`}>Editar reserva</Link>
          </Button>
          <DialogClose asChild>
            <Button variant="ghost">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
