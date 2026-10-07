'use client'

import { Cake, CircleCheck, CircleDashed, Clock4, TriangleAlert, Wallet } from 'lucide-react'
import { ContactButton } from '@/components/messaging/contact-button'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ChampagneChip } from '@/components/reservations/celebration-chip'
import { ReservationStatusControls } from '@/components/reservations/reservation-status-controls'
import { Amount } from '@/components/ui/amount'
import { Callout } from '@/components/ui/callout'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDayMonth } from '@/lib/dates/format'
import { cordobaDateTime } from '@/lib/dates/zone'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/** `'2026-09-10T17:32:00Z'` → `'10/09 14:32'`, en hora de Córdoba y sin `Intl`. */
function formatMoment(iso: string | null): string {
  const parts = cordobaDateTime(iso)
  return parts ? `${formatDayMonth(parts.date)} ${parts.time}` : '—'
}

/**
 * La columna de la ficha de una reserva: el estado (y sus botones), contactar,
 * lo que prepara el bar, la seña y el comentario, y la línea de tiempo.
 * Tarjetas del kit una al lado de la otra (nunca una adentro de otra).
 */
export function ReservationDetailSidebar({
  tenantSlug,
  reservation,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
}) {
  const contactPhone = reservation.customer?.phone ?? reservation.guest_phone ?? null

  return (
    <aside aria-label="Estado y datos de la reserva" className="grid content-start gap-4">
      <ReservationStatusControls tenantSlug={tenantSlug} reservation={reservation} />

      {contactPhone ? (
        <ContactButton
          tenantSlug={tenantSlug}
          phone={contactPhone}
          customerId={reservation.customer?.id}
          name={reservation.guest_name}
          size="md"
        />
      ) : null}

      {/* Lo que el bar tiene que PRODUCIR para esta mesa. Va arriba de la seña:
          la torta hay que encargarla con días, la seña se mira el mismo día. */}
      {reservation.cake_count > 0 || reservation.champagne_count > 0 ? (
        <Card padding="sm" className="gap-3">
          <CardHeader className="grid-cols-[auto_1fr] items-center gap-2">
            <Cake className="size-4 text-brand-text" aria-hidden />
            <CardTitle className="type-label text-muted-foreground">Lo prepara el bar</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap gap-1.5">
            <CakeChip
              count={reservation.cake_count}
              option={reservation.cake_option}
              optionId={reservation.cake_option_id}
              detailed
            />
            <ChampagneChip count={reservation.champagne_count} />
          </div>
          {reservation.cake_count > 0 && !reservation.cake_option ? (
            <Callout tone="warning" className="p-2 sm:p-3">
              Falta definir qué torta va. La elegís en el formulario, en el bloque de la torta.
            </Callout>
          ) : null}
        </Card>
      ) : null}

      {/* Seña + nota: los dos datos que el dueño mira antes de sentar la mesa.
          Se leen acá sin tener que bajar hasta el bloque "Extras" del form. */}
      <Card padding="sm" className="gap-3">
        <CardHeader className="grid-cols-[auto_1fr] items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle className="type-label text-muted-foreground">Seña y nota</CardTitle>
        </CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <span className="type-small text-muted-foreground">Seña</span>
          {reservation.deposit_cents > 0 ? (
            <Amount cents={reservation.deposit_cents} decimals={0} className="type-subtitle" />
          ) : (
            <span className="type-small text-muted-foreground">Sin seña</span>
          )}
        </div>
        <div className="grid gap-1 border-t border-border pt-3">
          <span className="type-small text-muted-foreground">
            {reservation.highlight_comment && reservation.comments
              ? 'Comentario destacado'
              : 'Comentario del cliente'}
          </span>
          {reservation.comments ? (
            // Si el encargado se tomó el trabajo de destacarlo, esta pantalla
            // —donde se prepara la reserva— tiene que mostrarlo distinto. Si no,
            // el switch no sirve para nada acá.
            <p
              className={cn(
                'max-h-56 overflow-y-auto whitespace-pre-wrap break-words type-body',
                reservation.highlight_comment && 'rounded-lg bg-warning-soft px-3 py-2 font-medium',
              )}
            >
              {reservation.comments}
            </p>
          ) : (
            <p className="type-body text-muted-foreground">Sin comentarios.</p>
          )}
        </div>
      </Card>

      {/* Línea de tiempo operativa, en hora de Córdoba. */}
      <Card padding="sm" className="gap-3">
        <CardHeader className="grid-cols-[auto_1fr] items-center gap-2">
          <Clock4 className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle className="type-label text-muted-foreground">Línea de tiempo</CardTitle>
        </CardHeader>
        <ol className="grid gap-2">
          <Step label="Creada" at={reservation.created_at} done />
          <Step label="Llegó" at={reservation.arrived_at} done={!!reservation.arrived_at} />
          <Step label="Sentada" at={reservation.seated_at} done={!!reservation.seated_at} />
          <Step label="Cerrada" at={reservation.closed_at} done={!!reservation.closed_at} />
          {reservation.cancelled_at ? (
            <Step
              label="Cancelada"
              at={reservation.cancelled_at}
              done
              negative
              note={reservation.cancelled_reason ?? undefined}
            />
          ) : null}
        </ol>
      </Card>
    </aside>
  )
}

function Step({
  label,
  at,
  done,
  negative,
  note,
}: {
  label: string
  at: string | null
  done: boolean
  negative?: boolean
  note?: string
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5">
        {done ? (
          negative ? (
            <TriangleAlert className="size-4 text-destructive-text" aria-hidden />
          ) : (
            <CircleCheck className="size-4 text-success-text" aria-hidden />
          )
        ) : (
          <CircleDashed className="size-4 text-subtle-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('type-body', done ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
            {done ? null : <span className="sr-only"> (todavía no)</span>}
          </span>
          <span className="type-caption tabular-nums text-muted-foreground">
            {formatMoment(at)}
          </span>
        </div>
        {note ? <p className="type-caption text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  )
}
