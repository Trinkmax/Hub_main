import { notFound } from 'next/navigation'
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  listTimelineForDate,
} from '@/lib/salon/queries'
import type { MealType } from '@/lib/salon/types'
import { requireTenantAccess, SALON_READ_ROLES, TenantNotFoundError } from '@/lib/tenant'
import { TimelineView } from './_components/timeline-view'

const VALID_MEALS = new Set<MealType>(['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event'])

function parseMealsParam(raw: string | string[] | undefined): ReadonlySet<MealType> {
  if (!raw) return new Set()
  const list = (Array.isArray(raw) ? raw.join(',') : raw).split(',')
  const out = new Set<MealType>()
  for (const m of list) {
    const trimmed = m.trim()
    if (VALID_MEALS.has(trimmed as MealType)) out.add(trimmed as MealType)
  }
  return out
}

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

  if (!SALON_READ_ROLES.includes(access.role)) notFound()

  const date =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayCordoba()
  const initialMeals = parseMealsParam(sp.meals)

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
        initialMeals={initialMeals}
      />
    </div>
  )
}
