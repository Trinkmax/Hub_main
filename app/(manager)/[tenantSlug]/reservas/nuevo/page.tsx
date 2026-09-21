import { ArrowLeft } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { calendarHref } from '@/lib/salon/calendar-links'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { lastManagerCookieName } from '@/lib/salon/managers'
import { resolveNewReservationDefaults } from '@/lib/salon/new-reservation-defaults'
import {
  getBonusRule,
  getManagerForUser,
  getScheduledEvent,
  listCakeOptions,
  listManagers,
  listRateTiers,
  listScheduledEventsForDate,
  listScheduledTemplates,
  type ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import { getDaySegmentsSnapshot } from '@/lib/salon/segment-queries'
import { firstParams, newReservationParamsSchema } from '@/lib/salon/segment-schemas'
import {
  type DaySegmentsSnapshot,
  eventDisplayName,
  resolveSegmentSettings,
} from '@/lib/salon/segments'
import { SEGMENT_LABELS } from '@/lib/salon/segments-copy'
import {
  getCurrentUser,
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ReservationForm } from '../_components/reservation-form'

export const metadata = { title: 'Nueva reserva' }
export const dynamic = 'force-dynamic'

/**
 * El cupo del día para el medidor del form. No puede tirar la página: sin él
 * el form arranca con el skeleton, lo vuelve a pedir y guardar sigue andando
 * (la confirmación de sobrecupo nunca bloquea).
 */
async function snapshotOrNull(tenantId: string, date: string): Promise<DaySegmentsSnapshot | null> {
  try {
    return await getDaySegmentsSnapshot({ tenantId, date })
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    console.error('[reservas.nuevo.snapshot]', {
      tenantId,
      code: typeof code === 'string' ? code : undefined,
    })
    return null
  }
}

export default async function NuevaReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }
  const tenantId = access.tenant.id

  // ?date, ?event (alta adentro de un evento), ?meal (servicio), ?time (hora
  // puntual) y ?guest_name. Cada param tiene su .catch: uno roto se ignora y la
  // página abre igual con sus defaults, en vez de tirar un 500 por un link viejo.
  const parsed = newReservationParamsSchema.safeParse(firstParams(sp))
  const query = parsed.success ? parsed.data : {}
  const today = todayInCordoba()
  const date0 = query.date ?? today

  const user = await getCurrentUser()

  // Último gestor usado en este dispositivo. Se lee acá (no en el cliente) para
  // que el combo llegue ya resuelto desde el server.
  const cookieStore = await cookies()
  const lastManagerId = cookieStore.get(lastManagerCookieName(tenantSlug))?.value ?? null

  const [
    managers,
    templates,
    tiers,
    bonus,
    linkedManager,
    cakeOptions,
    requestedEvent,
    eventsForDate0,
    snapshot0,
  ] = await Promise.all([
    listManagers({ tenantId, onlyActive: true }),
    listScheduledTemplates({ tenantId, onlyActive: true }),
    listRateTiers({ tenantId }),
    getBonusRule({ tenantId }),
    // "El gestor sos vos": default del select de gestor = el gestor de reservas
    // vinculado a la cuenta que está cargando la reserva (si existe).
    user ? getManagerForUser({ tenantId, userId: user.id }) : Promise.resolve(null),
    // El menú de tortas viaja en el mismo round-trip: el desplegable tiene que
    // estar listo apenas se marca el cumpleaños, sin un fetch extra al tocarlo.
    listCakeOptions({ tenantId, onlyActive: true }),
    query.event ? getScheduledEvent({ tenantId, id: query.event }) : Promise.resolve(null),
    listScheduledEventsForDate({ tenantId, date: date0 }),
    snapshotOrNull(tenantId, date0),
  ])

  // Reservar adentro de un evento es reservar en SU fecha. Si el link no traía
  // ?date (o traía otra), se vuelven a pedir los eventos y el cupo de ese día.
  // Es el camino raro: el calendario siempre manda ?date junto con ?event.
  let eventsForDate: ScheduledEventWithTemplate[] = eventsForDate0
  let snapshot = snapshot0
  if (requestedEvent && requestedEvent.event_date !== date0) {
    ;[eventsForDate, snapshot] = await Promise.all([
      listScheduledEventsForDate({ tenantId, date: requestedEvent.event_date }),
      snapshotOrNull(tenantId, requestedEvent.event_date),
    ])
  }

  const defaults = resolveNewReservationDefaults({
    params: query,
    today,
    event: requestedEvent,
    settings: snapshot?.settings ?? resolveSegmentSettings([]),
  })
  const { initialDate, segment } = defaults
  const targetEvent = requestedEvent && defaults.targetEventId ? requestedEvent : null
  const [, mm, dd] = initialDate.split('-')

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          // Vuelve al calendario abierto en ese día y en ese servicio: es la
          // puerta de las reservas, y desde ahí se veía cómo venía el día.
          <Link
            href={calendarHref(tenantSlug, { day: initialDate, segment })}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver al calendario
          </Link>
        }
        title={targetEvent ? `Reserva para ${eventDisplayName(targetEvent)}` : 'Nueva reserva'}
        // Sin evento, la descripción no nombra el día ni el servicio de la URL:
        // el header se arma en el server y no se entera de lo que cambia el form,
        // así que después de tocar «Mañana» o «Cena» seguiría diciendo
        // «Merienda del jue 25/09». El día y el servicio vigentes ya se ven
        // marcados en el form. Con evento sí van: el servicio lo fija el evento.
        description={
          targetEvent
            ? `${dd}/${mm} · ${targetEvent.starts_at_local.slice(0, 5)} · ${SEGMENT_LABELS[segment]} · el evento ya queda elegido abajo`
            : 'Cargá los datos del cliente. El día, el servicio y la hora se pueden cambiar abajo.'
        }
      />
      <ReservationForm
        mode="create"
        tenantSlug={tenantSlug}
        initialDate={initialDate}
        today={today}
        initialSnapshot={snapshot}
        initialValues={defaults.initialValues}
        managers={managers}
        templates={templates}
        initialEventsForDate={eventsForDate}
        cakeOptions={cakeOptions}
        canManageCakes={access.role === 'owner'}
        rateTiers={tiers}
        bonusPerGuestCents={bonus?.bonus_per_guest_cents ?? 0}
        linkedManagerId={linkedManager?.id ?? null}
        lastManagerId={lastManagerId}
        canManageManagers={access.role === 'owner'}
      />
    </div>
  )
}
