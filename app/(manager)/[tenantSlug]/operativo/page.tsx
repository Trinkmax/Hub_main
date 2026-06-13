import { ArrowRight, CalendarCheck, CalendarClock, PartyPopper, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  getTodaySalonOverview,
  listScheduledEventsForDateRange,
  listTimelineForDate,
} from '@/lib/salon/queries'
import { STATUS_LABELS } from '@/lib/salon/types'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { ReservationRow } from './_components/reservation-row'

export const metadata = { title: 'Operativo' }
export const dynamic = 'force-dynamic'

/** Fecha de hoy en la zona horaria del local (Córdoba). */
function todayCordoba(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatLongDate(date: string): string {
  // date = YYYY-MM-DD; lo interpretamos como fecha local sin desfase de TZ.
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dt)
}

export default async function OperativoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const date = todayCordoba()
  const tenantId = access.tenant.id

  const [reservations, overview, todayEvents] = await Promise.all([
    listTimelineForDate({ tenantId, date }),
    getTodaySalonOverview({ tenantId, date }),
    listScheduledEventsForDateRange({ tenantId, from: date, to: date }),
  ])

  // Reservas operables (no canceladas) ordenadas por hora — el query ya viene ordenado.
  const activeReservations = reservations.filter((r) => r.status !== 'cancelled')

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Hoy"
        title="Operativo"
        description="Lo que pasa hoy en el salón: reservas en curso y eventos del día."
      >
        <p className="text-sm font-medium capitalize text-muted-foreground">
          {formatLongDate(date)}
        </p>
      </PageHeader>

      {/* Tira de resumen / capacidad */}
      <section
        aria-label="Resumen del día"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        <SummaryStat label="Reservas" value={overview.reservationsCount} accent="default" />
        <SummaryStat label="Cubiertos" value={overview.estimatedGuests} accent="default" />
        <SummaryStat label="Pendientes" value={overview.byStatus.pending} accent="muted" />
        <SummaryStat label="Llegaron" value={overview.byStatus.arrived} accent="info" />
        <SummaryStat label="Sentadas" value={overview.byStatus.seated} accent="success" />
        <SummaryStat label="Cerradas" value={overview.byStatus.closed} accent="muted" />
      </section>

      {overview.peak ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-4 py-2.5 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0 text-primary" />
          <span>
            Pico estimado:{' '}
            <strong className="text-foreground tabular-nums">
              {overview.peak.startHHMM}–{overview.peak.endHHMM}
            </strong>{' '}
            con <strong className="text-foreground tabular-nums">{overview.peak.guests}</strong>{' '}
            personas.
          </span>
        </div>
      ) : null}

      {/* Timeline de reservas */}
      <section aria-label="Reservas de hoy" className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          <h2 className="font-serif text-lg font-semibold tracking-tight">Reservas de hoy</h2>
          <Badge variant="muted" className="tabular-nums">
            {activeReservations.length}
          </Badge>
        </div>

        {activeReservations.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="No hay reservas para hoy"
            description="Cuando carguen reservas para la fecha de hoy van a aparecer acá en orden por horario."
          />
        ) : (
          <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {activeReservations.map((reservation) => (
              <li key={reservation.id}>
                <ReservationRow tenantSlug={tenantSlug} reservation={reservation} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Eventos de hoy */}
      <section aria-label="Eventos de hoy" className="space-y-3">
        <div className="flex items-center gap-2">
          <PartyPopper className="size-4 text-muted-foreground" />
          <h2 className="font-serif text-lg font-semibold tracking-tight">Eventos de hoy</h2>
          <Badge variant="muted" className="tabular-nums">
            {todayEvents.length}
          </Badge>
        </div>

        {todayEvents.length === 0 ? (
          <EmptyState
            icon={PartyPopper}
            title="No hay eventos programados para hoy"
            description="Los eventos del calendario con fecha de hoy aparecen acá con su acceso a las reservas del día."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {todayEvents.map((event) => {
              const name = event.name_override ?? event.template?.name ?? 'Evento'
              const color = event.template?.color_hex ?? null
              return (
                <li
                  key={event.id}
                  className="card-hairline flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {color ? (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="truncate font-medium leading-tight">{name}</p>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          {event.starts_at_local.slice(0, 5)} · cupo {event.capacity}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full gap-2 sm:w-auto sm:self-start"
                  >
                    <Link href={`/${tenantSlug}/eventos/programados/${event.id}`}>
                      <CalendarCheck className="size-4" />
                      Ver reservas
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="sr-only">Estados de reserva: {Object.values(STATUS_LABELS).join(', ')}.</p>
    </PageShell>
  )
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: 'default' | 'muted' | 'info' | 'success'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl border border-border/70 bg-card px-4 py-3',
        accent === 'info' && 'border-info/40',
        accent === 'success' && 'border-success/40',
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-serif text-2xl font-semibold tabular-nums leading-none',
          accent === 'info' && 'text-info',
          accent === 'success' && 'text-success',
          accent === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    </div>
  )
}
