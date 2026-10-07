'use client'

import { ClipboardEdit, DoorClosed, DoorOpen, Trash2, Undo2, Users, XCircle } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  cancelSalonReservation,
  markArrived,
  markClosed,
  markNoShow,
  markSeated,
  revertStatus,
  updateActualGuests,
} from '@/lib/salon/actions'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { StatusPill } from './status-pill'

type ActionResult = { ok: boolean; message?: string }

/**
 * Controles operativos del comensal (Llegó / Sentar / Cerrar mesa + revertir
 * + No vino + cantidad real + cancelar). Extraído del sidebar de detalle para
 * reusarlo en el popup de gestión rápida y en el popup del día del calendario.
 *
 * `onChanged` se llama tras cada acción exitosa: el popup lo usa para refrescar
 * su data; el sidebar lo omite (las Server Actions ya hacen revalidatePath).
 *
 * Kit HUB: el próximo paso del ciclo es el único botón principal (los otros
 * dos quedan apagados en su lugar, así se lee el orden Llegó → Sentar →
 * Cerrar mesa); «Cerrar mesa» y «Cancelar reserva» confirman con
 * `ConfirmDialog`, que espera la acción con el diálogo abierto y, si falla,
 * queda abierto con el error adentro.
 */
export function ReservationStatusControls({
  tenantSlug,
  reservation,
  onChanged,
  showActualGuestsEditor = true,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  /**
   * El quick view trae su propio contador de personas (estimadas o reales según
   * estado), así que oculta este editor para no duplicarlo en el mismo popup.
   */
  showActualGuestsEditor?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [actualGuests, setActualGuests] = useState<number>(
    reservation.actual_guests ?? reservation.estimated_guests,
  )

  function run(p: Promise<ActionResult>) {
    startTransition(async () => {
      const r = await p
      if (r.ok) {
        toast.success(r.message ?? 'Listo.')
        onChanged?.()
      } else toast.error(r.message ?? 'No se pudo hacer el cambio. Probá de nuevo.')
    })
  }

  /** Para los `ConfirmDialog`: espera la acción y, si falla, deja el error adentro del diálogo. */
  async function confirmAction(p: Promise<ActionResult>, fallback: string): Promise<ConfirmResult> {
    const r = await p
    if (!r.ok) return { ok: false, error: r.message ?? fallback }
    toast.success(r.message ?? 'Listo.')
    onChanged?.()
    return { ok: true }
  }

  const allowedNext: SalonReservationStatus[] = (() => {
    switch (reservation.status) {
      case 'pending':
        return ['arrived', 'no_show', 'cancelled']
      case 'arrived':
        return ['seated', 'pending']
      case 'seated':
        return ['closed', 'arrived']
      case 'closed':
        return ['seated']
      case 'no_show':
      case 'cancelled':
        return []
    }
  })()

  return (
    <div className="grid gap-4">
      {/* Estado actual + acciones */}
      <Card padding="sm" className="gap-3">
        <CardHeader className="grid-cols-[1fr_auto] items-center">
          <CardTitle className="type-label text-muted-foreground">Estado</CardTitle>
          <StatusPill status={reservation.status} />
        </CardHeader>

        <div className="grid gap-2">
          {(['arrived', 'seated'] as const).map((to) => {
            const enabled = allowedNext.includes(to)
            const Icon = to === 'arrived' ? DoorOpen : Users
            return (
              <Button
                key={to}
                variant={enabled ? 'primary' : 'secondary'}
                size="lg"
                disabled={!enabled || pending}
                className="justify-start"
                onClick={() => {
                  if (to === 'arrived') run(markArrived(tenantSlug, reservation.id))
                  else run(markSeated(tenantSlug, reservation.id))
                }}
              >
                <Icon aria-hidden />
                {to === 'arrived' ? 'Llegó' : 'Sentar'}
              </Button>
            )
          })}
          <ClosedDialog
            enabled={allowedNext.includes('closed')}
            disabled={pending}
            defaultGuests={actualGuests}
            estimated={reservation.estimated_guests}
            onConfirm={(n) => {
              setActualGuests(n)
              return confirmAction(
                markClosed(tenantSlug, reservation.id, n),
                'No pudimos cerrar la mesa. Probá de nuevo.',
              )
            }}
          />

          {allowedNext.includes('pending') ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'pending' as SalonReservationStatus))
              }
            >
              <Undo2 aria-hidden />
              Revertir a Pendiente
            </Button>
          ) : null}
          {allowedNext.includes('arrived') && reservation.status === 'seated' ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'arrived' as SalonReservationStatus))
              }
            >
              <Undo2 aria-hidden />
              Revertir a Llegó
            </Button>
          ) : null}
          {allowedNext.includes('seated') && reservation.status === 'closed' ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'seated' as SalonReservationStatus))
              }
            >
              <Undo2 aria-hidden />
              Reabrir mesa
            </Button>
          ) : null}

          {allowedNext.includes('no_show') ? (
            <Button
              variant="secondary"
              size="sm"
              className="justify-start"
              disabled={pending}
              onClick={() => run(markNoShow(tenantSlug, reservation.id))}
            >
              <XCircle aria-hidden />
              No vino
            </Button>
          ) : null}
        </div>
      </Card>

      {/* Cantidad real inline editor */}
      {showActualGuestsEditor &&
      reservation.status !== 'cancelled' &&
      reservation.status !== 'no_show' ? (
        <Card padding="sm" className="gap-3">
          <CardHeader className="grid-cols-[auto_1fr] items-center gap-2">
            <ClipboardEdit className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle className="type-label text-muted-foreground">Cantidad real</CardTitle>
          </CardHeader>
          <div className="flex items-center gap-2">
            <NumberField
              value={actualGuests}
              onValueChange={(n) => {
                if (n !== null) setActualGuests(n)
              }}
              min={1}
              max={99}
              aria-label="Personas que vinieron"
              incrementLabel="Una persona más"
              decrementLabel="Una persona menos"
              className="w-36"
            />
            {/* Mismo alto que el contador (kit §3.0, «una fila, un tamaño»): en
                `sm` quedaba 4 px más bajo que el campo de al lado. */}
            <Button
              disabled={pending || actualGuests === reservation.actual_guests}
              onClick={() =>
                run(
                  updateActualGuests(tenantSlug, {
                    id: reservation.id,
                    actual_guests: actualGuests,
                  } as Record<string, unknown>),
                )
              }
            >
              Guardar
            </Button>
          </div>
          {reservation.actual_guests === null ? (
            <p className="type-caption text-warning-text">
              Sin cantidad real cargada — la comisión se calcula sobre{' '}
              {reservation.estimated_guests} estimadas.
            </p>
          ) : (
            <p className="type-caption text-muted-foreground">
              Real cargada: {reservation.actual_guests} (estimadas {reservation.estimated_guests}).
            </p>
          )}
        </Card>
      ) : null}

      {/* Cancelar */}
      {reservation.status !== 'cancelled' ? (
        <CancelDialog
          disabled={pending}
          onConfirm={(reason) =>
            confirmAction(
              cancelSalonReservation(tenantSlug, {
                id: reservation.id,
                reason,
              } as Record<string, unknown>),
              'No pudimos cancelar la reserva. Probá de nuevo.',
            )
          }
        />
      ) : null}
    </div>
  )
}

function ClosedDialog({
  enabled,
  disabled,
  defaultGuests,
  estimated,
  onConfirm,
}: {
  /** ¿«Cerrar mesa» es el próximo paso? (solo con la mesa sentada). */
  enabled: boolean
  disabled: boolean
  defaultGuests: number
  estimated: number
  onConfirm: (n: number) => Promise<ConfirmResult>
}) {
  const [open, setOpen] = useState(false)
  const [guests, setGuests] = useState(defaultGuests)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        // Cada vez que se abre arranca en el número vigente de la reserva.
        if (next) setGuests(defaultGuests)
        setOpen(next)
      }}
      title="¿Cerrar la mesa?"
      description="Confirmá cuántas personas pasaron por la mesa. Con ese número se recalcula la comisión."
      confirmLabel="Cerrar mesa"
      pendingLabel="Cerrando…"
      cancelLabel="Volver"
      icon={DoorClosed}
      trigger={
        <Button
          variant={enabled ? 'primary' : 'secondary'}
          size="lg"
          disabled={!enabled || disabled}
          className="justify-start"
        >
          <DoorClosed aria-hidden />
          Cerrar mesa
        </Button>
      }
      onConfirm={() => onConfirm(guests)}
    >
      <div className="grid justify-items-center gap-2 py-2">
        <NumberField
          value={guests}
          onValueChange={(n) => {
            if (n !== null) setGuests(n)
          }}
          min={1}
          max={99}
          size="lg"
          suffix="personas"
          aria-label="Personas reales"
          incrementLabel="Una persona más"
          decrementLabel="Una persona menos"
          className="w-56"
        />
        {guests !== estimated ? (
          <p className="type-small text-warning-text">
            Estimaste {estimated}, vas a cerrar con {guests}.
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  )
}

function CancelDialog({
  disabled,
  onConfirm,
}: {
  disabled: boolean
  onConfirm: (reason?: string) => Promise<ConfirmResult>
}) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog
      tone="danger"
      icon={Trash2}
      title="¿Cancelar esta reserva?"
      description="Se libera su lugar en el cupo. La comisión asociada se revierte sola (salvo la que ya se pagó)."
      confirmLabel="Cancelar reserva"
      pendingLabel="Cancelando…"
      cancelLabel="Volver"
      onOpenChange={(next) => {
        if (next) setReason('')
      }}
      trigger={
        <Button variant="danger-ghost" className="w-full" disabled={disabled}>
          <Trash2 aria-hidden />
          Cancelar reserva
        </Button>
      }
      onConfirm={() => onConfirm(reason.trim() || undefined)}
    >
      <Field label="Motivo" id={reasonId} optional>
        <Input
          placeholder="Avisaron que no vienen, cambio de fecha…"
          value={reason}
          maxLength={280}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  )
}
