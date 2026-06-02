import { CalendarCheck, CalendarPlus, MonitorSmartphone } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { getDayCapacitySnapshot, listManagers, listSalonReservations } from '@/lib/salon/queries'
import { salonStatusEnum, salonZoneEnum } from '@/lib/salon/schemas'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { DayNavigator } from './_components/day-navigator'
import { ReservationsFilters } from './_components/reservations-filters'
import { ReservationsTable } from './_components/reservations-table'

export const metadata = { title: 'Reservas' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

function todayInCordoba(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default async function ReservasPage({
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
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  const q = typeof sp.q === 'string' ? sp.q : undefined
  const status =
    typeof sp.status === 'string' && salonStatusEnum.safeParse(sp.status).success
      ? salonStatusEnum.parse(sp.status)
      : undefined
  const zone =
    typeof sp.zone === 'string' && salonZoneEnum.safeParse(sp.zone).success
      ? salonZoneEnum.parse(sp.zone)
      : undefined
  const managerId = typeof sp.manager === 'string' ? sp.manager : undefined

  // Modo rango (filtro avanzado) vs modo día (default). El rango tiene prioridad.
  const fromParam = typeof sp.from === 'string' ? sp.from : undefined
  const toParam = typeof sp.to === 'string' ? sp.to : undefined
  const rangeMode = Boolean(fromParam || toParam)
  const today = todayInCordoba()
  const day = rangeMode ? undefined : typeof sp.day === 'string' ? sp.day : today
  const dateFrom = rangeMode ? fromParam : day
  const dateTo = rangeMode ? toParam : day

  const page = Math.max(1, Number(sp.page ?? 1) || 1)

  const [{ rows, total }, managers] = await Promise.all([
    listSalonReservations({
      tenantId: access.tenant.id,
      q,
      status,
      zone,
      managerId,
      dateFrom,
      dateTo,
      page,
      pageSize: PAGE_SIZE,
    }),
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
  ])

  // Contador de cubiertos del día (solo en modo día).
  let dayCapacity: { used: number; total: number } | null = null
  if (day) {
    const buckets = await getDayCapacitySnapshot({ tenantId: access.tenant.id, date: day })
    const pa = buckets.find((b) => b.bucket === 'zone:planta_alta')
    const pb = buckets.find((b) => b.bucket === 'zone:planta_baja')
    dayCapacity = {
      used: (pa?.used ?? 0) + (pb?.used ?? 0),
      total: (pa?.capacity ?? 0) + (pb?.capacity ?? 0),
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(q || status || zone || managerId)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Operaciones"
        title="Reservas"
        description={`${total.toLocaleString('es-AR')} ${total === 1 ? 'reserva' : 'reservas'} · página ${page} de ${totalPages}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/${tenantSlug}/salon/reservas-operativo`} target="_blank" rel="noopener">
                <MonitorSmartphone className="size-4" />
                Panel operativo
              </Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo`}>
                <CalendarPlus className="size-4" />
                Nueva reserva
              </Link>
            </Button>
          </div>
        }
      />

      {rangeMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Mostrando rango {fromParam ?? '…'} → {toParam ?? '…'}
          </span>
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link href={`/${tenantSlug}/reservas`}>Volver a vista por día</Link>
          </Button>
        </div>
      ) : day ? (
        <DayNavigator tenantSlug={tenantSlug} day={day} today={today} capacity={dayCapacity} />
      ) : null}

      <ReservationsFilters
        tenantSlug={tenantSlug}
        managers={managers.map((m) => ({ id: m.id, display_name: m.display_name }))}
        defaults={{ q, status, zone, managerId, dateFrom: fromParam, dateTo: toParam }}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={hasFilters || rangeMode ? 'Sin resultados' : 'No hay reservas este día'}
          description={
            hasFilters || rangeMode
              ? 'Probá cambiar los filtros o limpiar todo para ver toda la lista.'
              : 'No hay reservas cargadas para esta fecha. Movete de día con las flechas o cargá una nueva.'
          }
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo${day ? `?date=${day}` : ''}`}>
                <CalendarPlus className="size-4" />
                Crear reserva
              </Link>
            </Button>
          }
        />
      ) : (
        <ReservationsTable
          tenantSlug={tenantSlug}
          rows={rows}
          page={page}
          totalPages={totalPages}
          totalCount={total}
          searchParams={sp}
        />
      )}
    </div>
  )
}
