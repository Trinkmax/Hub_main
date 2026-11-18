import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Moon,
  Receipt,
  UserCheck,
  Users,
} from 'lucide-react'
import { notFound } from 'next/navigation'
import { PeopleChart } from '@/components/charts/people-chart'
import { Badge } from '@/components/ui/badge'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { formatCentsShort } from '@/lib/money/format'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { pulseDelta } from '@/lib/stats/pulse'
import { getBarPulse } from '@/lib/stats/pulse-queries'
import { getDailyMetrics, getEventsRanking, getHeatmap, getKpis } from '@/lib/stats/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { Heatmap } from './_components/heatmap'
import { RevenueChart } from './_components/revenue-chart'

export const metadata = { title: 'Estadísticas' }
export const dynamic = 'force-dynamic'

/** Cuánto mira esta pantalla hacia atrás (y otro tanto antes, para comparar). */
const WINDOW_DAYS = 90

const numberFmt = new Intl.NumberFormat('es-AR')

/**
 * Estadísticas › Resumen: los últimos 90 días en una sola página, de arriba para abajo.
 *
 *  1. La gente que vino (de las reservas marcadas «Llegó»), contra los 90 días anteriores.
 *  2. Lo que se cargó en el club (los consumos a los que se les sumaron puntos).
 *  3. Los últimos eventos, por asistencia.
 *
 * Antes eran cinco solapas adentro de la pestaña (una segunda fila de pestañas debajo de las de la
 * sección). «Clientes» pasó a ser una pestaña de la sección; «Comunicación» está en cada difusión de
 * Mensajería; «Mozos» salía de las mesas del servicio anterior y se fue con él.
 */
export default async function EstadisticasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const [pulse, kpis, daily, heatmap, events] = await Promise.all([
    getBarPulse({ tenantId, today, windowDays: WINDOW_DAYS }),
    getKpis(tenantId),
    getDailyMetrics(tenantId, WINDOW_DAYS),
    getHeatmap(tenantId),
    // Solo las que ya pasaron: con el calendario cargado para adelante, las 20 más nuevas serían
    // todas futuras y en cero.
    getEventsRanking(tenantId, 20, today),
  ])

  const { current, previous } = pulse
  const delta = pulseDelta(current.covers, previous.covers)
  const nights = pulse.days.filter((day) => day.covers > 0).length
  const attendancePct = current.attendance === null ? null : Math.round(current.attendance * 100)
  const loaded = daily.reduce((total, day) => total + Number(day.revenue_cents ?? 0), 0)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      {/* Clientes, Cómo nos fue, Señas, Comisiones y Reseñas son pestañas de la sección, arriba del título. */}
      <PageHeader
        title="Estadísticas"
        description={`Los últimos ${WINDOW_DAYS} días: la gente que vino, lo que se cargó en el club y cómo anduvieron los eventos.`}
      />

      <section aria-labelledby="stats-people" className="space-y-4">
        <SectionTitle id="stats-people" title="La gente que vino">
          Sale de las reservas marcadas «Llegó». El detalle de cada noche está en Cómo nos fue.
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            icon={Users}
            iconClassName="text-primary"
            label="Personas"
            numberValue={current.covers}
            numberFormatKind="integer"
            hint={`En ${numberFmt.format(current.arrived)} ${current.arrived === 1 ? 'reserva' : 'reservas'}`}
            delta={delta === null ? undefined : <Delta pct={delta} />}
            deltaTone={
              delta === null || delta === 0 ? 'muted' : delta > 0 ? 'positive' : 'negative'
            }
          />
          <StatCard
            icon={Moon}
            iconClassName="text-info"
            label="Promedio por día"
            value={nights > 0 ? numberFmt.format(Math.round(current.covers / nights)) : '—'}
            hint={
              nights > 0
                ? `Personas por día, en ${numberFmt.format(nights)} ${nights === 1 ? 'día' : 'días'} con gente`
                : 'Todavía no hay reservas marcadas'
            }
          />
          <StatCard
            icon={UserCheck}
            iconClassName="text-success"
            label="Asistencia"
            value={attendancePct === null ? '—' : `${attendancePct}%`}
            hint={
              attendancePct === null
                ? 'Se calcula con las reservas marcadas'
                : current.noShows === 0
                  ? 'Ninguna marcada «No vino»'
                  : `${numberFmt.format(current.noShows)} no ${current.noShows === 1 ? 'vino' : 'vinieron'}`
            }
          />
          <StatCard
            icon={Receipt}
            iconClassName="text-warning"
            label="Sin marcar"
            value={numberFmt.format(current.unmarked)}
            hint={
              current.unmarked === 0
                ? 'Todas tienen «Llegó» o «No vino»'
                : 'Reservas que ya pasaron y nadie marcó. No entran en la cuenta.'
            }
          />
        </div>
        <div className="card-hairline rounded-xl border bg-card">
          <div className="h-72 px-2 pt-4 pb-4">
            <PeopleChart data={pulse.days} />
          </div>
        </div>
      </section>

      <section aria-labelledby="stats-club" className="space-y-4">
        <SectionTitle id="stats-club" title="Lo que se cargó en el club">
          Los consumos a los que alguien les sumó puntos. No es toda la venta del bar: es lo que
          pasó por el club.
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            icon={Receipt}
            iconClassName="text-primary"
            label="Consumos · 30 días"
            numberValue={kpis.visits_30d}
            numberFormatKind="integer"
            hint={
              kpis.visits_30d > 0
                ? `${(kpis.visits_30d / 30).toLocaleString('es-AR', { maximumFractionDigits: 1 })} por día`
                : 'Nadie sumó puntos en estos días'
            }
          />
          <StatCard
            icon={Banknote}
            iconClassName="text-success"
            label="Cargado · 30 días"
            value={formatCentsShort(kpis.revenue_30d_cents)}
            hint={`${formatCentsShort(loaded)} en ${WINDOW_DAYS} días`}
          />
          <StatCard
            icon={Banknote}
            iconClassName="text-info"
            label="Consumo promedio"
            value={kpis.visits_30d > 0 ? formatCentsShort(kpis.avg_ticket_30d_cents) : '—'}
            hint="Por consumo cargado, en 30 días"
          />
        </div>
        <div className="card-hairline rounded-xl border bg-card">
          <header className="border-b border-border/60 px-5 py-4">
            <h3 className="font-serif text-lg font-semibold tracking-tight">Cargado por día</h3>
            <p className="text-xs text-muted-foreground">
              {formatCentsShort(loaded)} en los últimos {WINDOW_DAYS} días.
            </p>
          </header>
          <div className="h-64 px-2 pb-4">
            <RevenueChart
              data={daily.map((day) => ({
                day: day.day,
                visits: day.visits,
                revenue_cents: Number(day.revenue_cents ?? 0),
              }))}
              metric="revenue_cents"
            />
          </div>
        </div>
        <Heatmap data={heatmap} />
      </section>

      <section aria-labelledby="stats-events" className="space-y-4">
        <SectionTitle id="stats-events" title="Los últimos eventos">
          Las últimas 20 fechas que ya pasaron, con cuántas reservas llegaron y cuántas no vinieron.
        </SectionTitle>
        <DataTableShell>
          {events.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Todavía no pasó ningún evento"
              description="Cuando pase la primera fecha del calendario, acá vas a ver cuántas reservas llegaron."
              className="m-3 border-0 bg-transparent"
            />
          ) : (
            <DataTableScroll>
              <DataTableRoot>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Evento</DataTableHeader>
                    <DataTableHeader>Fecha</DataTableHeader>
                    <DataTableHeader>Reservas</DataTableHeader>
                    <DataTableHeader>Llegaron</DataTableHeader>
                    <DataTableHeader>No vinieron</DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {events.map((event) => (
                    <tr key={event.event_id} className="transition-colors hover:bg-secondary/40">
                      <DataTableCell className="font-medium">{event.event_name}</DataTableCell>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {new Date(`${event.starts_at}T12:00:00`).toLocaleDateString('es-AR')}
                      </DataTableCell>
                      <DataTableCell className="tabular-nums">{event.reservations}</DataTableCell>
                      <DataTableCell className="tabular-nums">{event.attended}</DataTableCell>
                      <DataTableCell>
                        {event.attended + event.no_show === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Badge variant={event.no_show_rate > 0.2 ? 'destructive' : 'secondary'}>
                            {(event.no_show_rate * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </DataTableCell>
                    </tr>
                  ))}
                </DataTableBody>
              </DataTableRoot>
            </DataTableScroll>
          )}
        </DataTableShell>
      </section>
    </div>
  )
}

function SectionTitle({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <header>
      <h2 id={id} className="font-serif text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground text-pretty">{children}</p>
    </header>
  )
}

function Delta({ pct }: { pct: number }) {
  if (pct === 0) return <>igual</>
  return pct > 0 ? (
    <>
      <ArrowUpRight className="size-3" />+{pct}%
    </>
  ) : (
    <>
      <ArrowDownRight className="size-3" />
      {pct}%
    </>
  )
}
