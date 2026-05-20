import { notFound } from 'next/navigation'
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  listTimelineForDate,
} from '@/lib/salon/queries'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { TimelineView } from './_components/timeline-view'

export const metadata = { title: 'Operativo · Reservas' }
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

  if (!['owner', 'cashier', 'waiter'].includes(access.role)) notFound()

  const date =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayCordoba()

  const [reservations, capacity, scheduledEvents] = await Promise.all([
    listTimelineForDate({ tenantId: access.tenant.id, date }),
    getDayCapacitySnapshot({ tenantId: access.tenant.id, date }),
    listScheduledEventsForDate({ tenantId: access.tenant.id, date }),
  ])

  return (
    <div className="flex h-[100dvh] flex-col">
      <TimelineView
        tenantSlug={tenantSlug}
        tenantId={access.tenant.id}
        role={access.role}
        date={date}
        initialReservations={reservations}
        initialCapacity={capacity}
        initialEvents={scheduledEvents}
      />
    </div>
  )
}
