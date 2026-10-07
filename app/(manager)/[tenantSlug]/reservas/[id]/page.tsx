import { notFound } from 'next/navigation'
import { dayLabel } from '@/components/reservations/day-labels'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { StatusPill } from '@/components/reservations/status-pill'
import { Callout } from '@/components/ui/callout'
import { PageHeader } from '@/components/ui/page-header'
import { DetailTemplate } from '@/components/ui/page-templates'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { type ReservationReturnTo, reservationBackLink } from '@/lib/salon/calendar-links'
import { todayInCordoba } from '@/lib/salon/date-presets'
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
import { getDaySegmentsSnapshot } from '@/lib/salon/segment-queries'
import { firstParams, reservationDetailParamsSchema } from '@/lib/salon/segment-schemas'
import type { DaySegmentsSnapshot } from '@/lib/salon/segments'
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

/**
 * El cupo del día de la reserva para el medidor del form. No puede tirar la
 * página: sin él el form lo vuelve a pedir y guardar sigue andando (la
 * confirmación de sobrecupo nunca bloquea).
 */
async function snapshotOrNull(tenantId: string, date: string): Promise<DaySegmentsSnapshot | null> {
  try {
    return await getDaySegmentsSnapshot({ tenantId, date })
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    console.error('[reservas.detalle.snapshot]', {
      tenantId,
      code: typeof code === 'string' ? code : undefined,
    })
    return null
  }
}

export default async function ReservaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug, id }, sp] = await Promise.all([params, searchParams])
  // ?volver=calendario si se entró desde el calendario; si no (la lista, el
  // operativo, las comisiones), se vuelve a la lista. Un valor roto se ignora.
  const parsedParams = reservationDetailParamsSchema.safeParse(firstParams(sp))
  const returnTo: ReservationReturnTo =
    parsedParams.success && parsedParams.data.volver === 'calendario' ? 'calendario' : 'reservas'

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
  // solo los eventos y el cupo del día se encadenan a su fecha. Antes eran 2
  // hops secuenciales (reserva → todo lo demás); ahora el camino crítico es
  // reserva → eventos/cupo y el resto viaja junto.
  const reservationPromise = getSalonReservation({ tenantId: access.tenant.id, id })
  const [
    reservation,
    managers,
    templates,
    eventsForDate,
    snapshot,
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
    reservationPromise.then((r) =>
      r ? snapshotOrNull(access.tenant.id, r.reservation_date) : null,
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

  // Vuelve a la pantalla de origen abierta en el día DE ESTA reserva (y, en el
  // calendario, con su fila resaltada), no a hoy: si no, salir del detalle de
  // una reserva del 31/07 devolvía una pantalla donde no estaba.
  const back = reservationBackLink(tenantSlug, {
    returnTo,
    date: reservation.reservation_date,
    focusId: id,
  })

  const alerts = resolveReservationAlerts(
    reservation.service_alerts,
    reservation.customer?.service_alerts,
  )
  const highlighted =
    reservation.highlight_comment && reservation.comments ? reservation.comments : null

  return (
    <DetailTemplate
      width="comfortable"
      header={
        <PageHeader
          back={{ href: back.href, label: returnTo === 'calendario' ? 'Calendario' : 'Reservas' }}
          title={reservation.guest_name}
          meta={[
            dayLabel(reservation.reservation_date),
            timeRangeLabel(
              reservation.reservation_time_local,
              reservation.reservation_end_time_local,
            ),
            `${reservation.estimated_guests} ${reservation.estimated_guests === 1 ? 'persona' : 'personas'}`,
            <StatusPill key="estado" status={reservation.status} />,
          ]}
        />
      }
      // Avisos arriba del fold: es la pantalla donde el encargado confirma la
      // reserva por teléfono, y no puede tener que bajar para enterarse.
      notice={
        alerts.length > 0 || highlighted ? (
          <div className="grid gap-2">
            <ServiceAlertChips alerts={alerts} />
            {highlighted ? (
              <Callout tone="warning" title="Comentario destacado">
                <span className="whitespace-pre-wrap break-words">{highlighted}</span>
              </Callout>
            ) : null}
          </div>
        ) : null
      }
      aside={<ReservationDetailSidebar tenantSlug={tenantSlug} reservation={reservation} />}
    >
      <ReservationForm
        mode="edit"
        tenantSlug={tenantSlug}
        returnTo={returnTo}
        cancelHref={back.href}
        initialDate={reservation.reservation_date}
        today={todayInCordoba()}
        initialSnapshot={snapshot}
        reservationStatus={reservation.status}
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
    </DetailTemplate>
  )
}
