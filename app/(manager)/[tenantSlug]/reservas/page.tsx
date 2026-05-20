import { CalendarCheck, CalendarPlus, MonitorSmartphone } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { listManagers, listSalonReservations } from '@/lib/salon/queries'
import { salonStatusEnum, salonZoneEnum } from '@/lib/salon/schemas'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { ReservationsFilters } from './_components/reservations-filters'
import { ReservationsTable } from './_components/reservations-table'

export const metadata = { title: 'Reservas' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

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
  const dateFrom = typeof sp.from === 'string' ? sp.from : undefined
  const dateTo = typeof sp.to === 'string' ? sp.to : undefined
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(q || status || zone || managerId || dateFrom || dateTo)

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

      <ReservationsFilters
        tenantSlug={tenantSlug}
        managers={managers.map((m) => ({ id: m.id, display_name: m.display_name }))}
        defaults={{ q, status, zone, managerId, dateFrom, dateTo }}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={hasFilters ? 'Sin resultados' : 'Todavía no hay reservas'}
          description={
            hasFilters
              ? 'Probá cambiar los filtros o limpiar todo para ver toda la lista.'
              : 'Cargá la primera reserva del bar y empezamos a registrar el flujo de salón.'
          }
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo`}>
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
