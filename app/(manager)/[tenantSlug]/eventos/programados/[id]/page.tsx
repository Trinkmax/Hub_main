import { CalendarPlus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { dayLabel } from '@/components/reservations/day-labels'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { FormTemplate } from '@/components/ui/page-templates'
import { Section } from '@/components/ui/section'
import { calendarHref, newReservationHref } from '@/lib/salon/calendar-links'
import {
  getScheduledEvent,
  listSalonReservations,
  listScheduledTemplates,
} from '@/lib/salon/queries'
import {
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { EventReservationsList } from '../_components/event-reservations-list'
import { ScheduledEventForm } from '../_components/scheduled-event-form'

export const metadata = { title: 'Evento programado' }
export const dynamic = 'force-dynamic'

export default async function ScheduledEventPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  // Un id que no es UUID no puede tumbar la página: getScheduledEvent
  // devuelve null ante error, pero listSalonReservations hace throw, y ahora
  // corren en paralelo (antes el 404 del evento cortaba antes).
  if (!z.string().uuid().safeParse(id).success) notFound()

  // Las reservas se filtran por `scheduled_event_id` directo en la query (antes
  // traía todo el día y filtraba en memoria), así no dependen de la fecha del
  // evento y los tres fetches salen en un solo round-trip en vez de dos.
  const [event, templates, { rows: reservations }] = await Promise.all([
    getScheduledEvent({ tenantId: access.tenant.id, id }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    listSalonReservations({
      tenantId: access.tenant.id,
      scheduledEventId: id,
      pageSize: 200,
    }),
  ])
  if (!event) notFound()

  const eventReservations = reservations.filter((r) => r.scheduled_event_id === event.id)
  const totalGuests = eventReservations
    .filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
    .reduce((acc, r) => acc + (r.actual_guests ?? r.estimated_guests), 0)

  const eventName = event.name_override ?? event.template?.name ?? 'Evento'

  return (
    <FormTemplate
      header={
        <PageHeader
          // Vuelve al mes del evento con su día abierto (antes caía en el mes
          // de hoy y había que volver a buscar la fecha).
          back={{ href: calendarHref(tenantSlug, { day: event.event_date }), label: 'Calendario' }}
          title={eventName}
          meta={[
            dayLabel(event.event_date),
            event.starts_at_local.slice(0, 5),
            `${totalGuests} de ${event.capacity} ${event.capacity === 1 ? 'lugar reservado' : 'lugares reservados'}`,
          ]}
          actions={
            // Reservar desde el evento: llega al form con el evento, la fecha y
            // la hora ya elegidos (antes había que volver a buscarlo en un combo).
            // El evento es parte del calendario: al guardar se vuelve al día.
            <Button asChild>
              <Link
                href={newReservationHref(tenantSlug, {
                  date: event.event_date,
                  eventId: event.id,
                  from: 'calendario',
                })}
              >
                <CalendarPlus aria-hidden />
                Nueva reserva
              </Link>
            </Button>
          }
        />
      }
    >
      <div className="flex flex-col gap-8">
        <ScheduledEventForm
          tenantSlug={tenantSlug}
          mode="edit"
          templates={templates}
          initialValues={{
            id: event.id,
            template_id: event.template_id,
            name_override: event.name_override ?? undefined,
            event_date: event.event_date,
            starts_at_local: event.starts_at_local.slice(0, 5),
            ends_at_local: event.ends_at_local?.slice(0, 5),
            capacity: event.capacity,
            meal_type: event.meal_type,
            full_bonus_active: event.full_bonus_active,
            attendance_points: event.attendance_points,
            notes: event.notes ?? undefined,
            private_group: event.private_group,
          }}
        />

        <Section
          title="Reservas del evento"
          description={`${eventReservations.length} ${eventReservations.length === 1 ? 'reserva' : 'reservas'} · ${totalGuests} ${totalGuests === 1 ? 'persona' : 'personas'}`}
        >
          <EventReservationsList tenantSlug={tenantSlug} reservations={eventReservations} />
        </Section>
      </div>
    </FormTemplate>
  )
}
