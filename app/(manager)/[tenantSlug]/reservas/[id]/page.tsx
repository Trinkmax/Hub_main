import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listLinkableHubEvents } from '@/lib/events/queries'
import {
  getBonusRule,
  getSalonReservation,
  listManagers,
  listRateTiers,
  listScheduledEventsForDate,
  listScheduledTemplates,
} from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ReservationDetailSidebar } from '../_components/reservation-detail-sidebar'
import { ReservationForm } from '../_components/reservation-form'

export const metadata = { title: 'Reserva' }
export const dynamic = 'force-dynamic'

export default async function ReservaDetailPage({
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

  const reservation = await getSalonReservation({ tenantId: access.tenant.id, id })
  if (!reservation) notFound()

  const [managers, templates, eventsForDate, tiers, bonus, hubEvents] = await Promise.all([
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledEventsForDate({
      tenantId: access.tenant.id,
      date: reservation.reservation_date,
    }),
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
    listLinkableHubEvents({ tenantId: access.tenant.id }),
  ])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/reservas`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver a reservas
          </Link>
        }
        title={reservation.guest_name}
        description={`${reservation.reservation_date} · ${reservation.reservation_time_local.slice(0, 5)} · ${reservation.estimated_guests} personas`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ReservationForm
          mode="edit"
          tenantSlug={tenantSlug}
          initialDate={reservation.reservation_date}
          managers={managers}
          templates={templates}
          initialEventsForDate={eventsForDate}
          hubEvents={hubEvents}
          rateTiers={tiers}
          bonusPerGuestCents={bonus?.bonus_per_guest_cents ?? 0}
          reservationId={reservation.id}
          initialValues={{
            customer_id: reservation.customer_id ?? undefined,
            guest_name: reservation.guest_name,
            guest_phone: reservation.guest_phone ?? undefined,
            guest_email: reservation.guest_email ?? undefined,
            kind: reservation.kind,
            meal_type: reservation.meal_type,
            reservation_date: reservation.reservation_date,
            reservation_time_local: reservation.reservation_time_local,
            zone: reservation.zone,
            scheduled_event_id: reservation.scheduled_event_id ?? undefined,
            hub_event_id: reservation.hub_event_id ?? undefined,
            estimated_guests: reservation.estimated_guests,
            cake_count: reservation.cake_count,
            champagne_count: reservation.champagne_count,
            deposit_cents: reservation.deposit_cents,
            origin: reservation.origin,
            primary_manager_id: reservation.primary_manager_id,
            assistant_manager_id: reservation.assistant_manager_id ?? undefined,
            comments: reservation.comments ?? undefined,
            actual_guests: reservation.actual_guests,
          }}
        />
        <ReservationDetailSidebar tenantSlug={tenantSlug} reservation={reservation} />
      </div>
    </div>
  )
}
