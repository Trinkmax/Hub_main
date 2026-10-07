'use client'

import { CalendarCheck } from 'lucide-react'
import { ContactButton } from '@/components/messaging/contact-button'
import { CakeChip } from '@/components/reservations/cake-chip'
import { CelebrationChip } from '@/components/reservations/celebration-chip'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { StatusPill } from '@/components/reservations/status-pill'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { timeRangeLabel } from '@/lib/salon/format'
import type { ReservationWithJoins } from '@/lib/salon/types'

/**
 * Las reservas de un evento, en la `DataTable` del kit (tarjetas en el
 * celular). El dueño mira esta lista antes del evento: quién viene, cuántos
 * son, quién la gestionó y qué hay que preparar (avisos, torta).
 */
export function EventReservationsList({
  tenantSlug,
  reservations,
}: {
  tenantSlug: string
  reservations: ReservationWithJoins[]
}) {
  return (
    <DataTable
      caption="Reservas del evento"
      rows={reservations}
      getRowId={(r) => r.id}
      empty={
        <EmptyState
          size="sm"
          icon={CalendarCheck}
          title="Todavía no hay reservas"
          description="Las reservas de este evento van a aparecer acá. Cargá la primera con «Nueva reserva»."
        />
      }
      columns={[
        {
          id: 'cliente',
          header: 'Cliente',
          cell: (r) => (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{r.guest_name}</span>
                {/* El festejo no puede quedar disuelto adentro del evento: es
                    justo la lista donde el 21/09 el cumple de 15 se leía como
                    una mesa más de Pizza libre. */}
                <CelebrationChip kind={r.kind} />
              </span>
              {/* "¿Cuántos celíacos vienen el sábado?" se contesta desde acá. */}
              <ServiceAlertChips
                alerts={resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)}
              />
              {r.cake_count > 0 ? (
                <CakeChip
                  count={r.cake_count}
                  option={r.cake_option}
                  optionId={r.cake_option_id}
                  className="self-start"
                />
              ) : null}
            </div>
          ),
        },
        {
          id: 'hora',
          header: 'Hora',
          cell: (r) => (
            <span className="tabular-nums">
              {timeRangeLabel(r.reservation_time_local, r.reservation_end_time_local)}
            </span>
          ),
        },
        {
          id: 'gestor',
          header: 'Gestor',
          cell: (r) => r.primary_manager?.display_name ?? '—',
          mobile: 'meta',
        },
        {
          id: 'estado',
          header: 'Estado',
          cell: (r) => <StatusPill status={r.status} />,
          mobile: 'meta',
        },
        {
          id: 'personas',
          header: 'Personas',
          numeric: true,
          cell: (r) => {
            const guests = r.actual_guests ?? r.estimated_guests
            return (
              <>
                {guests}
                <span className="sr-only">{guests === 1 ? ' persona' : ' personas'}</span>
              </>
            )
          },
        },
        {
          id: 'contactar',
          header: 'Contactar',
          headerHidden: true,
          align: 'end',
          cell: (r) => {
            const phone = r.customer?.phone ?? r.guest_phone ?? null
            return phone ? (
              <ContactButton
                tenantSlug={tenantSlug}
                phone={phone}
                customerId={r.customer?.id}
                name={r.guest_name}
                size="icon-sm"
                variant="ghost"
              />
            ) : null
          },
        },
      ]}
    />
  )
}
