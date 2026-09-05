'use client'

import { AlertTriangle, Cake, CheckCircle2, Circle, Clock4, Wallet } from 'lucide-react'
import { ContactButton } from '@/components/messaging/contact-button'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ChampagneChip } from '@/components/reservations/celebration-chip'
import { ReservationStatusControls } from '@/components/reservations/reservation-status-controls'
import { ARSFormat } from '@/lib/salon/format'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ReservationDetailSidebar({
  tenantSlug,
  reservation,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
}) {
  const contactPhone = reservation.customer?.phone ?? reservation.guest_phone ?? null

  return (
    <aside className="space-y-4">
      <ReservationStatusControls tenantSlug={tenantSlug} reservation={reservation} />

      {contactPhone ? (
        <div className="flex justify-end">
          <ContactButton
            tenantSlug={tenantSlug}
            phone={contactPhone}
            customerId={reservation.customer?.id}
            name={reservation.guest_name}
          />
        </div>
      ) : null}

      {/* Lo que el bar tiene que PRODUCIR para esta mesa. Va arriba de la seña:
          la torta hay que encargarla con días, la seña se mira el mismo día. */}
      {reservation.cake_count > 0 || reservation.champagne_count > 0 ? (
        <section className="space-y-2 rounded-xl border border-primary/30 bg-primary/[0.06] p-4">
          <header className="flex items-center gap-2">
            <Cake className="size-4 text-primary" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Lo prepara el bar
            </span>
          </header>
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
            <p className="rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-[11px] text-foreground">
              Falta definir qué torta va. La elegís abajo, en el bloque de la torta.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Seña + nota: los dos datos que el dueño mira antes de sentar la mesa.
          Se leen acá sin tener que bajar hasta el bloque "Extras" del form. */}
      <section className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
        <header className="flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Seña y nota</span>
        </header>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">Seña</span>
          {reservation.deposit_cents > 0 ? (
            <span className="font-mono text-base font-semibold tabular-nums">
              {ARSFormat(reservation.deposit_cents)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Sin seña</span>
          )}
        </div>
        <div className="space-y-1 border-t border-border/60 pt-3">
          <span className="text-sm text-muted-foreground">
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
                'max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm',
                reservation.highlight_comment &&
                  'rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 font-medium',
              )}
            >
              {reservation.comments}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin comentarios.</p>
          )}
        </div>
      </section>

      {/* Timeline operativo */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <header className="mb-3 flex items-center gap-2">
          <Clock4 className="size-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Timeline</span>
        </header>
        <ol className="space-y-2 text-sm">
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
      </section>
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
            <AlertTriangle className="size-4 text-rose-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )
        ) : (
          <Circle className="size-4 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatRelative(at)}
          </span>
        </div>
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  )
}
