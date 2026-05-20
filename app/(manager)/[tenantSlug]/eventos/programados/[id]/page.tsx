import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import {
  getScheduledEvent,
  listSalonReservations,
  listScheduledTemplates,
} from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
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
    requireRole(access.role, ['owner', 'cashier'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const event = await getScheduledEvent({ tenantId: access.tenant.id, id })
  if (!event) notFound()

  const [templates, { rows: reservations }] = await Promise.all([
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    listSalonReservations({
      tenantId: access.tenant.id,
      dateFrom: event.event_date,
      dateTo: event.event_date,
      pageSize: 200,
    }),
  ])

  const eventReservations = reservations.filter((r) => r.scheduled_event_id === event.id)
  const totalGuests = eventReservations
    .filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
    .reduce((acc, r) => acc + (r.actual_guests ?? r.estimated_guests), 0)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/eventos/programados`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver al calendario
          </Link>
        }
        title={event.name_override ?? event.template?.name ?? 'Evento'}
        description={`${event.event_date} · ${event.starts_at_local.slice(0, 5)} · ${totalGuests}/${event.capacity} personas reservadas`}
      />

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
          notes: event.notes ?? undefined,
        }}
      />

      <section className="rounded-xl border bg-card/60 p-4">
        <h2 className="mb-3 font-serif text-lg font-semibold">
          Reservas asociadas ({eventReservations.length})
        </h2>
        {eventReservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin reservas todavía.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {eventReservations.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{r.guest_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.reservation_time_local.slice(0, 5)} ·{' '}
                    {r.primary_manager?.display_name ?? '—'}
                  </span>
                </div>
                <span className="font-mono text-base tabular-nums font-semibold">
                  {r.actual_guests ?? r.estimated_guests}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
