import { notFound } from 'next/navigation'
import { branchFilterOf } from '@/lib/branches/filter'
import { getBranchScope } from '@/lib/branches/scope'
import { branchFilterKey, segmentScopeFromFilter } from '@/lib/salon/branch-scope'
import { listScheduledEventsForDate, listTimelineForDate } from '@/lib/salon/queries'
import { getDaySegmentCaps } from '@/lib/salon/segment-queries'
import { isoDaySchema } from '@/lib/salon/segment-schemas'
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
  // Fecha que además exista (2026-02-30 no): con solo el regex llegaba a
  // Postgres y rompía la página en lugar de caer en hoy.
  const parsedDate = isoDaySchema.safeParse(sp.date)
  const date = parsedDate.success ? parsedDate.data : today
  const tenantId = access.tenant.id

  // El salón es un lugar (docs/features/sucursales.md): la sucursal de ESTE
  // dispositivo, nunca «Todas». Sus reservas, sus eventos y su cupo.
  const branchScope = await getBranchScope(tenantSlug, 'device')
  const branch = branchFilterOf(branchScope)
  const segmentScope = segmentScopeFromFilter(branch, branchScope.branches)

  // Los cupos por servicio llegan RESUELTOS: la cuenta corre en el cliente
  // sobre las reservas vivas (Realtime), con la misma función que el calendario.
  const [reservations, scheduledEvents, segmentCaps] = await Promise.all([
    listTimelineForDate({ tenantId, date, branch }),
    listScheduledEventsForDate({ tenantId, date, branch }),
    getDaySegmentCaps({ tenantId, date, scope: segmentScope }),
  ])

  // Sin wrapper `h-[100dvh]`: el shell del salón es el único scroller (ver
  // components/shell/salon/app-shell-salon.tsx). Este div creaba un segundo
  // contenedor scrolleable dentro de una página que ya scrolleaba.
  return (
    <TimelineView
      // Otra sucursal en este dispositivo es otro salón: se empieza de cero.
      key={branchFilterKey(branch)}
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      role={access.role}
      date={date}
      isToday={date === today}
      branchFilter={branch}
      initialReservations={reservations}
      initialSegmentCaps={segmentCaps}
      initialEvents={scheduledEvents}
    />
  )
}
