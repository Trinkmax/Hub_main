import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { PageHeader } from '@/components/ui/page-header'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { formatDayLabel } from '@/lib/salon/date-presets'
import { timeRangeLabel } from '@/lib/salon/format'
import {
  getBonusRule,
  getManagerForUser,
  getSalonReservation,
  listCakeOptions,
  listManagers,
  listRateTiers,
  listScheduledEventsForDate,
  listScheduledTemplates,
} from '@/lib/salon/queries'
import {
  getCurrentUser,
  RESERVATION_STAFF_ROLES,
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
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const user = await getCurrentUser()

  // La reserva se pide en paralelo con los catálogos (no dependen de ella);
  // solo los eventos del día se encadenan a su fecha. Antes eran 2 hops
  // secuenciales (reserva → todo lo demás); ahora el camino crítico es
  // reserva → eventos y el resto viaja junto.
  const reservationPromise = getSalonReservation({ tenantId: access.tenant.id, id })
  const [
    reservation,
    managers,
    templates,
    eventsForDate,
    tiers,
    bonus,
    linkedManager,
    cakeOptions,
  ] = await Promise.all([
    reservationPromise,
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    reservationPromise.then((r) =>
      r ? listScheduledEventsForDate({ tenantId: access.tenant.id, date: r.reservation_date }) : [],
    ),
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
    // Solo para marcar "Vos" en el combo de gestores; en edit el default lo
    // manda la reserva guardada.
    user
      ? getManagerForUser({ tenantId: access.tenant.id, userId: user.id })
      : Promise.resolve(null),
    // El catálogo COMPLETO (no solo las activas): si esta reserva eligió una
    // torta que después se dio de baja, tiene que seguir viéndose elegida en
    // vez de aparecer en blanco como si nadie hubiera decidido nada.
    listCakeOptions({ tenantId: access.tenant.id }),
  ])
  if (!reservation) notFound()

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          // Vuelve al día DE ESTA reserva, no a hoy: si no, salir del detalle
          // de una reserva del 31/07 devolvía una lista donde no estaba.
          <Link
            href={`/${tenantSlug}/reservas?day=${reservation.reservation_date}`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver a reservas
          </Link>
        }
        title={reservation.guest_name}
        description={`${formatDayLabel(reservation.reservation_date)} · ${timeRangeLabel(reservation.reservation_time_local, reservation.reservation_end_time_local)} · ${reservation.estimated_guests} personas`}
      />

      {/* Avisos arriba del fold: es la pantalla donde el encargado confirma la
          reserva por teléfono, y no puede tener que bajar para enterarse. */}
      {(() => {
        const alerts = resolveReservationAlerts(
          reservation.service_alerts,
          reservation.customer?.service_alerts,
        )
        if (alerts.length === 0 && !(reservation.highlight_comment && reservation.comments)) {
          return null
        }
        return (
          <div className="space-y-2">
            <ServiceAlertChips alerts={alerts} />
            {reservation.highlight_comment && reservation.comments ? (
              <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm leading-snug text-foreground">
                {reservation.comments}
              </p>
            ) : null}
          </div>
        )
      })()}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ReservationForm
          mode="edit"
          tenantSlug={tenantSlug}
          initialDate={reservation.reservation_date}
          managers={managers}
          templates={templates}
          initialEventsForDate={eventsForDate}
          cakeOptions={cakeOptions.filter((c) => c.active || c.id === reservation?.cake_option_id)}
          canManageCakes={access.role === 'owner'}
          rateTiers={tiers}
          bonusPerGuestCents={bonus?.bonus_per_guest_cents ?? 0}
          linkedManagerId={linkedManager?.id ?? null}
          canManageManagers={access.role === 'owner'}
          reservationId={reservation.id}
          customerServiceAlerts={reservation.customer?.service_alerts ?? []}
          initialValues={{
            customer_id: reservation.customer_id ?? undefined,
            guest_name: reservation.guest_name,
            guest_phone: reservation.guest_phone ?? undefined,
            guest_email: reservation.guest_email ?? undefined,
            kind: reservation.kind,
            meal_type: reservation.meal_type,
            reservation_date: reservation.reservation_date,
            reservation_time_local: reservation.reservation_time_local,
            reservation_end_time_local: reservation.reservation_end_time_local?.slice(0, 5) ?? '',
            zone: reservation.zone,
            scheduled_event_id: reservation.scheduled_event_id ?? undefined,
            estimated_guests: reservation.estimated_guests,
            cake_count: reservation.cake_count,
            cake_option_id: reservation.cake_option_id,
            champagne_count: reservation.champagne_count,
            deposit_cents: reservation.deposit_cents,
            origin: reservation.origin,
            primary_manager_id: reservation.primary_manager_id,
            assistant_manager_id: reservation.assistant_manager_id ?? undefined,
            comments: reservation.comments ?? undefined,
            actual_guests: reservation.actual_guests,
            service_alerts: reservation.service_alerts,
            highlight_comment: reservation.highlight_comment,
          }}
        />
        <ReservationDetailSidebar tenantSlug={tenantSlug} reservation={reservation} />
      </div>
    </div>
  )
}
