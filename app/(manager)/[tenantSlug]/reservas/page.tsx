import { CalendarCheck, CalendarPlus, MonitorSmartphone, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  detectPreset,
  formatDayLabel,
  thisMonth,
  thisWeek,
  todayInCordoba,
} from '@/lib/salon/date-presets'
import {
  getDayCapacitySnapshot,
  getRangeReservationTotals,
  getSalonReservation,
  listManagers,
  listSalonReservations,
} from '@/lib/salon/queries'
import { salonStatusEnum, salonZoneEnum } from '@/lib/salon/schemas'
import {
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { DayNavigator } from './_components/day-navigator'
import { ReservationRangeChips } from './_components/range-chips'
import { ReservasTourButton } from './_components/reservas-tour'
import { ReservationsFilters } from './_components/reservations-filters'
import { ReservationsTable } from './_components/reservations-table'

export const metadata = { title: 'Reservas' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE_DAY = 25
// Un mes entero no entra en 25 filas: paginar cada 25 arruina justo la vista
// que el dueño pidió ("ver todas las reservas juntas en orden de fechas").
const PAGE_SIZE_RANGE = 100

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
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
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

  // Modo rango (chips "Esta semana" / "Este mes" / rango libre) vs modo día
  // (default). El rango tiene prioridad.
  const fromParam = typeof sp.from === 'string' ? sp.from : undefined
  const toParam = typeof sp.to === 'string' ? sp.to : undefined
  const rangeMode = Boolean(fromParam || toParam)
  const today = todayInCordoba()
  const day = rangeMode ? undefined : typeof sp.day === 'string' ? sp.day : today
  const dateFrom = rangeMode ? fromParam : day
  const dateTo = rangeMode ? toParam : day

  const week = thisWeek()
  const month = thisMonth()
  const activePreset = detectPreset(fromParam, toParam)

  const pageSize = rangeMode ? PAGE_SIZE_RANGE : PAGE_SIZE_DAY
  const page = Math.max(1, Number(sp.page ?? 1) || 1)

  const nuevaId = typeof sp.nueva === 'string' ? sp.nueva : undefined

  // Todo lo que depende solo de los searchParams sale en un único round-trip:
  // el contador de cubiertos y la reserva "nueva" no necesitan el listado,
  // así que esperarlas después sumaba 1–2 hops secuenciales a Supabase.
  const [{ rows, total }, managers, dayBuckets, rangeTotals, nuevaPuntual] = await Promise.all([
    listSalonReservations({
      tenantId: access.tenant.id,
      q,
      status,
      zone,
      managerId,
      dateFrom,
      dateTo,
      page,
      pageSize,
      // Una agenda a futuro se lee de la fecha más cercana en adelante.
      sort: rangeMode ? 'asc' : 'desc',
    }),
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
    // Contador de cubiertos: en modo día contra el tope del salón, en modo rango
    // el volumen del período (el tope no significa nada sumando días).
    day ? getDayCapacitySnapshot({ tenantId: access.tenant.id, date: day }) : null,
    !day && (dateFrom || dateTo)
      ? getRangeReservationTotals({
          tenantId: access.tenant.id,
          from: dateFrom ?? dateTo ?? today,
          to: dateTo ?? dateFrom ?? today,
        })
      : null,
    // Reserva recién creada: venimos redirigidos a SU día con ?nueva=<id>. Es la
    // otra mitad del "cargo una reserva y no la veo" — antes la lista quedaba
    // clavada en hoy y la reserva del 31/07 no aparecía por ningún lado.
    // Se pide puntual en paralelo (aunque suela venir en la página cargada) para
    // no pagar un hop extra justo el día más cargado del mes o con un filtro
    // activo que la deja afuera: si no, ese es el único caso sin aviso.
    nuevaId ? getSalonReservation({ tenantId: access.tenant.id, id: nuevaId }) : null,
  ])

  let dayCapacity: { used: number; total: number } | null = null
  if (dayBuckets) {
    const pa = dayBuckets.find((b) => b.bucket === 'zone:planta_alta')
    const pb = dayBuckets.find((b) => b.bucket === 'zone:planta_baja')
    dayCapacity = {
      used: (pa?.used ?? 0) + (pb?.used ?? 0),
      total: (pa?.capacity ?? 0) + (pb?.capacity ?? 0),
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasFilters = Boolean(q || status || zone || managerId)

  // Prioriza la fila de la página cargada (misma referencia que resalta la tabla).
  const nuevaEnPagina = nuevaId ? rows.find((r) => r.id === nuevaId) : undefined
  const nueva = nuevaEnPagina ?? nuevaPuntual ?? undefined
  const dismissNuevaQs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (key === 'nueva') continue
    if (typeof value === 'string' && value) dismissNuevaQs.set(key, value)
  }
  const dismissNuevaHref = `/${tenantSlug}/reservas${
    dismissNuevaQs.toString() ? `?${dismissNuevaQs.toString()}` : ''
  }`

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operaciones"
        title="Reservas"
        description={`${total.toLocaleString('es-AR')} ${total === 1 ? 'reserva' : 'reservas'} · página ${page} de ${totalPages}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <ReservasTourButton role={access.role} />
            <Button asChild variant="outline" className="gap-2">
              <Link
                href={`/${tenantSlug}/salon/reservas-operativo`}
                target="_blank"
                rel="noopener"
                data-tour="reservas-operativo-link"
              >
                <MonitorSmartphone className="size-4" />
                Panel operativo
              </Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo`} data-tour="reservas-nueva">
                <CalendarPlus className="size-4" />
                Nueva reserva
              </Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-3" data-tour="reservas-dia">
        <ReservationRangeChips
          tenantSlug={tenantSlug}
          active={activePreset}
          week={week}
          month={month}
          from={fromParam}
          to={toParam}
        />

        {rangeMode ? (
          <div className="card-hairline flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/70 bg-card/60 px-4 py-2.5 text-sm">
            <span className="font-medium">
              {fromParam ? formatDayLabel(fromParam) : '…'} →{' '}
              {toParam ? formatDayLabel(toParam) : '…'}
            </span>
            {rangeTotals ? (
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {rangeTotals.reservations} {rangeTotals.reservations === 1 ? 'reserva' : 'reservas'}{' '}
                · {rangeTotals.guests} cubiertos
              </span>
            ) : null}
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link href={`/${tenantSlug}/reservas`}>Volver a vista por día</Link>
            </Button>
          </div>
        ) : day ? (
          <DayNavigator tenantSlug={tenantSlug} day={day} today={today} capacity={dayCapacity} />
        ) : null}
      </div>

      {nueva ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-emerald-300/60 bg-emerald-50/70 px-4 py-3 text-sm dark:border-emerald-800/60 dark:bg-emerald-950/30">
          <PartyPopper className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <span className="text-emerald-900 dark:text-emerald-100">
            Reserva de <strong>{nueva.guest_name}</strong> creada para el{' '}
            {formatDayLabel(nueva.reservation_date)}.
          </span>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenantSlug}/reservas/${nueva.id}`}>Abrir reserva</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={dismissNuevaHref}>Listo</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div data-tour="reservas-filtros">
        <ReservationsFilters
          tenantSlug={tenantSlug}
          managers={managers.map((m) => ({ id: m.id, display_name: m.display_name }))}
          defaults={{ q, status, zone, managerId, dateFrom: fromParam, dateTo: toParam }}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={
            hasFilters
              ? 'Sin resultados'
              : rangeMode
                ? 'No hay reservas en este período'
                : 'No hay reservas este día'
          }
          description={
            hasFilters
              ? 'Probá cambiar los filtros o limpiar todo para ver toda la lista.'
              : rangeMode
                ? 'Probá con otro período (Este mes) o cargá una reserva nueva.'
                : 'No hay reservas cargadas para esta fecha. Movete de día con las flechas, mirá la semana completa arriba, o cargá una nueva.'
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
        <div data-tour="reservas-lista">
          <ReservationsTable
            tenantSlug={tenantSlug}
            rows={rows}
            page={page}
            totalPages={totalPages}
            totalCount={total}
            searchParams={sp}
            groupByDay={rangeMode}
            highlightId={nueva?.id}
          />
        </div>
      )}
    </PageShell>
  )
}
