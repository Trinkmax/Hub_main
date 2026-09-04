import { ArrowLeft } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { lastManagerCookieName } from '@/lib/salon/managers'
import {
  getBonusRule,
  getManagerForUser,
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
import { ReservationForm } from '../_components/reservation-form'

export const metadata = { title: 'Nueva reserva' }
export const dynamic = 'force-dynamic'

function todayCordoba(): string {
  // Aprox: usamos la zona horaria de Argentina via Intl.
  const now = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  // en-CA devuelve YYYY-MM-DD
  return now
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

  const today = todayCordoba()
  const dateParam =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined
  const initialDate = dateParam ?? today
  // `?event=<uuid>` (viene del calendario / del evento): la reserva nace ya
  // colgada de ese evento, con su hora y tipo de servicio. Sólo se honra si el
  // evento es de `initialDate` (el link siempre manda `date` + `event`).
  const eventParam =
    typeof sp.event === 'string' && /^[0-9a-f-]{36}$/i.test(sp.event) ? sp.event : undefined

  const user = await getCurrentUser()

  // Último gestor usado en este dispositivo. Se lee acá (no en el cliente) para
  // que el combo llegue ya resuelto desde el server.
  const cookieStore = await cookies()
  const lastManagerId = cookieStore.get(lastManagerCookieName(tenantSlug))?.value ?? null

  const [managers, templates, eventsToday, tiers, bonus, linkedManager, cakeOptions] =
    await Promise.all([
      listManagers({ tenantId: access.tenant.id, onlyActive: true }),
      listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
      listScheduledEventsForDate({ tenantId: access.tenant.id, date: initialDate }),
      listRateTiers({ tenantId: access.tenant.id }),
      getBonusRule({ tenantId: access.tenant.id }),
      // "El gestor sos vos": default del select de gestor = el gestor de reservas
      // vinculado a la cuenta que está cargando la reserva (si existe).
      user
        ? getManagerForUser({ tenantId: access.tenant.id, userId: user.id })
        : Promise.resolve(null),
      // El menú de tortas viaja en el mismo round-trip: el desplegable tiene que
      // estar listo apenas se marca el cumpleaños, sin un fetch extra al tocarlo.
      listCakeOptions({ tenantId: access.tenant.id, onlyActive: true }),
    ])

  const targetEvent = eventParam ? (eventsToday.find((e) => e.id === eventParam) ?? null) : null
  const targetEventName = targetEvent
    ? (targetEvent.name_override ?? targetEvent.template?.name ?? 'Evento')
    : null
  const [, mm, dd] = initialDate.split('-')

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={
              targetEvent
                ? `/${tenantSlug}/eventos/programados/${targetEvent.id}`
                : `/${tenantSlug}/reservas`
            }
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {targetEvent ? `Volver a ${targetEventName}` : 'Volver a reservas'}
          </Link>
        }
        title={targetEvent ? `Reserva para ${targetEventName}` : 'Nueva reserva'}
        description={
          targetEvent
            ? `${dd}/${mm} · ${targetEvent.starts_at_local.slice(0, 5)} · el evento ya queda elegido abajo. Se calcula la comisión en vivo.`
            : 'Cargá los datos del cliente y la mesa. Se calcula la comisión en vivo.'
        }
      />
      <ReservationForm
        mode="create"
        tenantSlug={tenantSlug}
        initialDate={initialDate}
        initialValues={
          targetEvent
            ? {
                zone: 'event_floating',
                scheduled_event_id: targetEvent.id,
                reservation_time_local: targetEvent.starts_at_local.slice(0, 5),
                // El evento ya sabe hasta qué hora va; si lo tiene cargado, es
                // la respuesta correcta y evita que la tengan que tipear.
                reservation_end_time_local: targetEvent.ends_at_local?.slice(0, 5) ?? '',
                meal_type: targetEvent.meal_type,
              }
            : undefined
        }
        managers={managers}
        templates={templates}
        initialEventsForDate={eventsToday}
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
