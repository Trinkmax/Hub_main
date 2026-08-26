import { notFound } from 'next/navigation'
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  listTimelineForDate,
} from '@/lib/salon/queries'
import { requireTenantAccess, SALON_READ_ROLES, TenantNotFoundError } from '@/lib/tenant'
import { TimelineView } from './_components/timeline-view'

export const metadata = { title: 'Salón · Reservas' }
export const dynamic = 'force-dynamic'

function todayCordoba(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default async function ReservasOperativoPage({
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
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    throw e
  }

  if (!SALON_READ_ROLES.includes(access.role)) notFound()

  const today = todayCordoba()
  const date = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today

  const [reservations, capacity, scheduledEvents] = await Promise.all([
    listTimelineForDate({ tenantId: access.tenant.id, date }),
    getDayCapacitySnapshot({ tenantId: access.tenant.id, date }),
    listScheduledEventsForDate({ tenantId: access.tenant.id, date }),
  ])

  // Sin wrapper `h-[100dvh]`: el shell del salón es el único scroller (ver
  // components/shell/salon/app-shell-salon.tsx). Este div creaba un segundo
  // contenedor scrolleable dentro de una página que ya scrolleaba.
  return (
    <TimelineView
      tenantSlug={tenantSlug}
      tenantId={access.tenant.id}
      role={access.role}
      date={date}
      isToday={date === today}
      initialReservations={reservations}
      initialCapacity={capacity}
      initialEvents={scheduledEvents}
    />
  )
}
