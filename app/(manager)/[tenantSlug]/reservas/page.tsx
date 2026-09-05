import { Cake, CalendarCheck, CalendarPlus, MonitorSmartphone, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { DayHighlights } from '@/components/reservations/day-highlights'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { type DayCovers, summarizeDayCovers } from '@/lib/salon/covers'
import {
  detectPreset,
  formatDayLabel,
  thisMonth,
  thisWeek,
  todayInCordoba,
} from '@/lib/salon/date-presets'
import { buildDayHighlights, usedByEventMap } from '@/lib/salon/day-highlights'
import {
  getDayCapacitySnapshot,
  getRangeReservationTotals,
  getSalonReservation,
  listDayCelebrations,
  listDayServiceRows,
  listManagers,
  listSalonReservations,
  listScheduledEventsForDate,
  PageOutOfRangeError,
} from '@/lib/salon/queries'
import { mealTypeEnum, salonStatusEnum, salonZoneEnum } from '@/lib/salon/schemas'
import { groupByService } from '@/lib/salon/services'
import {
  RESERVATION_OPERATOR_ROLES,
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CancelledSection } from './_components/cancelled-section'
import { DayNavigator } from './_components/day-navigator'
import { ReservationRangeChips } from './_components/range-chips'
import { ReservasTourButton } from './_components/reservas-tour'
import { ReservationsFilters } from './_components/reservations-filters'
import { ReservationsTable } from './_components/reservations-table'
import { RollCallDialog } from './_components/roll-call-dialog'
import { ServiceChips } from './_components/service-chips'

export const metadata = { title: 'Reservas' }
export const dynamic = 'force-dynamic'

// Un día entero en una sola página: la agenda se lee cortada por SERVICIO
// (Desayuno / Almuerzo / Merienda / Cena) y un servicio partido entre la página
// 1 y la 2 rompe justo lo que el corte vino a arreglar — el encabezado diría
// "Cena · 62 cubiertos" arriba de 9 filas. El día más cargado del HUB tiene 33
// reservas; 200 deja margen de sobra sin traer una página gigante.
const PAGE_SIZE_DAY = 200
// Un mes entero no entra en 25 filas: paginar cada 25 arruina justo la vista
// que el dueño pidió ("ver todas las reservas juntas en orden de fechas").
const PAGE_SIZE_RANGE = 100
// El bloque de canceladas se abre a mano y es de consulta: con 30 alcanza para
// cualquier día y para casi cualquier mes. Si hay más, se dicen y se ofrece el
// filtro por estado en vez de paginar un bloque que casi nadie abre.
const CANCELLED_PREVIEW_SIZE = 30

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
  // Filtro por servicio. Va en `?servicio=` (no `?meal=`) porque es lo que el
  // dueño ve escrito en la URL cuando comparte un link con un socio.
  const mealType =
    typeof sp.servicio === 'string' && mealTypeEnum.safeParse(sp.servicio).success
      ? mealTypeEnum.parse(sp.servicio)
      : undefined

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

  // Misma vista pero desde la primera página: se usa cuando el `page` de la URL
  // quedó apuntando a una página que ya no existe.
  const firstPageQs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (key === 'page') continue
    if (typeof value === 'string' && value) firstPageQs.set(key, value)
  }
  const firstPageHref = `/${tenantSlug}/reservas${
    firstPageQs.toString() ? `?${firstPageQs.toString()}` : ''
  }`

  // Todo lo que depende solo de los searchParams sale en un único round-trip:
  // el contador de cubiertos y la reserva "nueva" no necesitan el listado,
  // así que esperarlas después sumaba 1–2 hops secuenciales a Supabase.
  let loaded: [
    Awaited<ReturnType<typeof listSalonReservations>>,
    Awaited<ReturnType<typeof listManagers>>,
    Awaited<ReturnType<typeof getDayCapacitySnapshot>> | null,
    Awaited<ReturnType<typeof getRangeReservationTotals>> | null,
    Awaited<ReturnType<typeof getSalonReservation>> | null,
    Awaited<ReturnType<typeof listSalonReservations>> | null,
    Awaited<ReturnType<typeof listDayServiceRows>> | null,
    Awaited<ReturnType<typeof listScheduledEventsForDate>> | null,
    Awaited<ReturnType<typeof listDayCelebrations>> | null,
  ]
  try {
    loaded = await Promise.all([
      listSalonReservations({
        tenantId: access.tenant.id,
        q,
        status,
        zone,
        mealType,
        managerId,
        dateFrom,
        dateTo,
        page,
        pageSize,
        // Las canceladas salen de la agenda de trabajo: mezcladas con las activas
        // alguien termina armando la mesa igual. Van en su propio bloque al pie.
        // Si el usuario filtró por estado, manda su filtro.
        excludeStatus: ['cancelled'],
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
      // Canceladas del mismo período. Va en el Promise.all para no sumar un hop
      // secuencial. Solo en la vista por defecto: si el usuario eligió un estado
      // está haciendo una búsqueda puntual, no trabajando la agenda — y si eligió
      // "Cancelada", el listado principal ya se las muestra.
      status
        ? null
        : listSalonReservations({
            tenantId: access.tenant.id,
            q,
            zone,
            mealType,
            managerId,
            dateFrom,
            dateTo,
            status: 'cancelled',
            page: 1,
            pageSize: CANCELLED_PREVIEW_SIZE,
            sort: rangeMode ? 'asc' : 'desc',
          }),
      // Los chips de servicio cuentan el DÍA ENTERO, no la página filtrada: si
      // no, elegir "Cena" dejaría "Merienda" en 0 y no habría cómo volver.
      day
        ? listDayServiceRows({
            tenantId: access.tenant.id,
            date: day,
            // Todo menos el servicio: el chip cuenta lo que vas a ver si lo tocás.
            zone,
            status,
            managerId,
            q,
          })
        : null,
      // Eventos del día para el renglón de hitos (eventos + cumpleaños juntos).
      day ? listScheduledEventsForDate({ tenantId: access.tenant.id, date: day }) : null,
      // Y los festejos, con su propia query: los hitos hablan del DÍA, no de la
      // página filtrada (si no, filtrar por zona escondía el cumple y dejaba el
      // evento — el moco original de vuelta).
      day ? listDayCelebrations({ tenantId: access.tenant.id, date: day }) : null,
    ])
  } catch (error) {
    // Cancelar una reserva achica el listado; si el usuario estaba en la última
    // página, esa página deja de existir y PostgREST responde 416. Volvemos a la
    // primera con los mismos filtros en vez de mostrarle una pantalla de error
    // (el workspace del manager no tiene error.tsx).
    if (error instanceof PageOutOfRangeError) redirect(firstPageHref)
    throw error
  }

  const [
    { rows, total },
    managers,
    dayBuckets,
    rangeTotals,
    nuevaPuntual,
    cancelled,
    dayServiceRows,
    dayEvents,
    dayCelebrations,
  ] = loaded

  // El borde exacto `offset === total` no da 416: devuelve una página vacía. Sin
  // esto el usuario ve "Sin resultados" cuando en realidad hay reservas, en la
  // página anterior.
  if (page > 1 && rows.length === 0 && total > 0) redirect(firstPageHref)

  // Cubiertos del día = salón + eventos. El desglose lo arma `summarizeDayCovers`
  // a partir de los buckets del RPC (ver lib/salon/covers.ts).
  const dayCapacity: DayCovers | null = dayBuckets ? summarizeDayCovers(dayBuckets) : null

  // Registrar asistencia es una operación de servicio: mismo conjunto que
  // enforcean `updateActualGuests` y `transitionStatus` (incluye al mozo).
  const canRecordAttendance = (RESERVATION_OPERATOR_ROLES as ReadonlyArray<string>).includes(
    access.role,
  )

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasFilters = Boolean(q || status || zone || managerId || mealType)

  // Corte por servicio del día entero: alimenta los chips de filtro (contadores
  // que no mienten cuando hay un servicio elegido).
  const dayServices = dayServiceRows ? groupByService(dayServiceRows) : []
  // El chip cuenta lo que el usuario va a VER listado, no lo que ocupa mesa: el
  // listado saca las canceladas (`excludeStatus`) pero deja las no-show, así que
  // contar `activeCount` daba "Todo el día 16" al lado de un header que decía
  // "22 reservas activas" — tres números para la misma pregunta. Si el usuario
  // eligió un estado, manda su filtro y se cuentan todas las filas del bucket.
  const listedCountOf = (b: (typeof dayServices)[number]) =>
    status ? b.rows.length : b.rows.length - b.cancelledCount
  const serviceChips = dayServices
    .filter((b) => listedCountOf(b) > 0)
    .map((b) => ({
      mealType: b.mealType,
      label: b.label,
      count: listedCountOf(b),
      covers: b.covers,
      cakes: b.cakes,
    }))
  const dayActiveCount = dayServices.reduce((acc, b) => acc + listedCountOf(b), 0)

  // Eventos + cumpleaños del día, al mismo nivel: es lo que hay que PREPARAR.
  const dayHighlights =
    day && dayEvents
      ? buildDayHighlights({
          events: dayEvents,
          reservations: dayCelebrations ?? [],
          usedByEvent: usedByEventMap(dayBuckets ?? []),
        })
      : []

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
        description={`${total.toLocaleString('es-AR')} ${total === 1 ? 'reserva activa' : 'reservas activas'}${
          cancelled && cancelled.total > 0
            ? ` · ${cancelled.total} cancelada${cancelled.total === 1 ? '' : 's'}`
            : ''
        } · página ${page} de ${totalPages}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <ReservasTourButton role={access.role} />
            {/* Solo en modo día: "pasar lista" de un mes entero no es un cierre
                de noche, es una migración de datos. */}
            {day && canRecordAttendance ? (
              <RollCallDialog tenantSlug={tenantSlug} day={day} dayLabel={formatDayLabel(day)} />
            ) : null}
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
                {/* "activas" no es adorno: el header de arriba cuenta TODAS las filas
                    de la lista (incluidas canceladas y no_show) y este total las
                    excluye. Sin la palabra, el dueño lee dos totales de reservas
                    distintos en la misma pantalla y no sabe cuál creer. */}
                {rangeTotals.reservations}{' '}
                {rangeTotals.reservations === 1 ? 'reserva activa' : 'reservas activas'} ·{' '}
                {rangeTotals.guests} cubiertos
                {rangeTotals.eventos > 0
                  ? ` (${rangeTotals.salon} salón · ${rangeTotals.eventos} eventos)`
                  : null}
              </span>
            ) : null}
            {/* Lo que hay que PRODUCIR en el período. Una torta se encarga con
                días: verla recién al abrir el día correcto llega tarde. */}
            {rangeTotals && (rangeTotals.cakes > 0 || rangeTotals.birthdays > 0) ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                {rangeTotals.birthdays > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-tight text-primary">
                    <PartyPopper className="size-3" aria-hidden />
                    {/* "cumpleaños" es invariable en singular y plural. */}
                    {rangeTotals.birthdays} cumpleaños
                  </span>
                ) : null}
                {rangeTotals.cakes > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-tight text-primary">
                    <Cake className="size-3" aria-hidden />
                    {rangeTotals.cakes} {rangeTotals.cakes === 1 ? 'torta' : 'tortas'}
                  </span>
                ) : null}
              </span>
            ) : null}
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link href={`/${tenantSlug}/reservas`}>Volver a vista por día</Link>
            </Button>
          </div>
        ) : day ? (
          <DayNavigator tenantSlug={tenantSlug} day={day} today={today} capacity={dayCapacity} />
        ) : null}

        {/* El corte del día por servicio, pegado al navegador de día: son la
            misma decisión ("qué día miro" → "qué servicio de ese día"). */}
        {day && (serviceChips.length > 0 || mealType) ? (
          <ServiceChips
            tenantSlug={tenantSlug}
            chips={serviceChips}
            active={mealType}
            totalCount={dayActiveCount}
          />
        ) : null}
      </div>

      {day && dayHighlights.length > 0 ? (
        <DayHighlights
          tenantSlug={tenantSlug}
          date={day}
          highlights={dayHighlights}
          canBook={canRecordAttendance}
        />
      ) : null}

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
          defaults={{
            q,
            status,
            zone,
            mealType,
            managerId,
            dateFrom: fromParam,
            dateTo: toParam,
          }}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={
            hasFilters
              ? 'Sin resultados'
              : rangeMode
                ? 'No hay reservas activas en este período'
                : cancelled && cancelled.total > 0
                  ? 'Todas canceladas'
                  : 'No hay reservas este día'
          }
          description={
            hasFilters
              ? 'Probá cambiar los filtros o limpiar todo para ver toda la lista.'
              : rangeMode
                ? 'Probá con otro período (Este mes) o cargá una reserva nueva.'
                : cancelled && cancelled.total > 0
                  ? // Hay reservas, pero todas canceladas: decir "no hay
                    // ninguna" sería mentira y mandaría a buscar un bug.
                    'Las reservas de este día están todas canceladas — las ves abajo. Movete de día con las flechas o cargá una nueva.'
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
            canRecordAttendance={canRecordAttendance}
            today={today}
            page={page}
            totalPages={totalPages}
            totalCount={total}
            searchParams={sp}
            groupByDay={rangeMode}
            highlightId={nueva?.id}
          />
        </div>
      )}

      {/* Al pie y colapsado: existe (alguien va a preguntar "¿esta no había
          reservado?") pero cuesta un toque llegar, así que ya no se confunde
          con la agenda de trabajo. */}
      {cancelled ? (
        <CancelledSection
          tenantSlug={tenantSlug}
          rows={cancelled.rows}
          totalCount={cancelled.total}
          showDate={rangeMode}
        />
      ) : null}
    </PageShell>
  )
}
