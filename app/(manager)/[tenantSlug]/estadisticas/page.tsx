import { ArrowDownToLine, Banknote, Receipt, Sparkles, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getStaffSummaries } from '@/lib/staff-performance/queries'
import { resolveFromSearchParams } from '@/lib/staff-performance/range-from-search-params'
import {
  getChurnRisk,
  getCommunicationStats,
  getDailyMetrics,
  getEventsRanking,
  getHeatmap,
  getKpis,
  getTopCustomersBySpent,
} from '@/lib/stats/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ChurnCard } from './_components/churn-card'
import { Heatmap } from './_components/heatmap'
import { RevenueChart } from './_components/revenue-chart'
import { StaffPerformanceTab } from './_components/staff-performance-tab'

export const metadata = { title: 'Estadísticas' }
export const dynamic = 'force-dynamic'

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

const numberFmt = new Intl.NumberFormat('es-AR')

const TAB_CLASS = 'data-[state=active]:bg-card data-[state=active]:shadow-sm'

export default async function EstadisticasPage({
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
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const { preset: staffPreset, range: staffRange } = resolveFromSearchParams(sp)
  const activeTab = typeof sp.tab === 'string' ? sp.tab : 'overview'

  const [kpis, daily90, heatmap, top, churn, events, comms, staffSummaries] = await Promise.all([
    getKpis(access.tenant.id),
    getDailyMetrics(access.tenant.id, 90),
    getHeatmap(access.tenant.id),
    getTopCustomersBySpent(access.tenant.id, 50),
    getChurnRisk(access.tenant.id, 200),
    getEventsRanking(access.tenant.id, 20),
    getCommunicationStats(access.tenant.id),
    getStaffSummaries(access.tenant.id, staffRange),
  ])

  const totalRevenue = daily90.reduce((acc, d) => acc + Number(d.revenue_cents ?? 0), 0)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Insights"
        title="Estadísticas"
        description="Vista profunda de tu bar: clientes, visitas, eventos y comunicaciones."
      />

      <Tabs defaultValue={activeTab} className="space-y-6">
        <TabsList className="bg-secondary/40">
          <TabsTrigger value="overview" className={TAB_CLASS}>
            Visión general
          </TabsTrigger>
          <TabsTrigger value="customers" className={TAB_CLASS}>
            Clientes
          </TabsTrigger>
          <TabsTrigger value="events" className={TAB_CLASS}>
            Eventos
          </TabsTrigger>
          <TabsTrigger value="comms" className={TAB_CLASS}>
            Comunicación
          </TabsTrigger>
          <TabsTrigger value="mozos" className={TAB_CLASS}>
            Mozos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Users}
              iconClassName="text-primary"
              label="Clientes"
              value={numberFmt.format(kpis.customers_total)}
            />
            <StatCard
              icon={Sparkles}
              iconClassName="text-info"
              label="Activos 30d"
              value={numberFmt.format(kpis.customers_active_30d)}
              hint={
                kpis.customers_total > 0
                  ? `${Math.round((kpis.customers_active_30d / kpis.customers_total) * 100)}% del total`
                  : undefined
              }
            />
            <StatCard
              icon={Receipt}
              iconClassName="text-warning"
              label="Visitas 30d"
              value={numberFmt.format(kpis.visits_30d)}
              hint={kpis.visits_30d > 0 ? `${(kpis.visits_30d / 30).toFixed(1)}/día` : undefined}
            />
            <StatCard
              icon={Banknote}
              iconClassName="text-success"
              label="Ticket promedio"
              value={fmtCents(kpis.avg_ticket_30d_cents)}
            />
          </section>

          <div className="card-hairline rounded-xl border bg-card">
            <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div>
                <h2 className="font-serif text-lg font-semibold tracking-tight">
                  Revenue últimos 90 días
                </h2>
                <p className="text-xs text-muted-foreground">{fmtCents(totalRevenue)} acumulado</p>
              </div>
              <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                90d
              </span>
            </header>
            <div className="h-72 px-2 pb-4">
              <RevenueChart
                data={daily90.map((d) => ({
                  day: d.day,
                  visits: d.visits,
                  revenue_cents: Number(d.revenue_cents ?? 0),
                }))}
                metric="revenue_cents"
              />
            </div>
          </div>
          <Heatmap data={heatmap} />
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          <DataTableShell>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div>
                <h2 className="font-serif text-lg font-semibold tracking-tight">
                  Top 50 por gasto
                </h2>
                <p className="text-xs text-muted-foreground">Clientes con más spent acumulado.</p>
              </div>
              <Button asChild variant="outline" size="sm" className="gap-2">
                <a
                  href={`/api/stats/export?slug=${encodeURIComponent(tenantSlug)}&type=top_customers`}
                  download
                >
                  <ArrowDownToLine className="size-3.5" />
                  Exportar CSV
                </a>
              </Button>
            </header>
            {top.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Sin datos"
                description="Cuando empieces a registrar visitas, vas a ver acá tu ranking de clientes."
                className="m-3 border-0 bg-transparent"
              />
            ) : (
              <DataTableScroll>
                <DataTableRoot>
                  <DataTableHead>
                    <tr>
                      <DataTableHeader>Cliente</DataTableHeader>
                      <DataTableHeader>Visitas</DataTableHeader>
                      <DataTableHeader>Spent</DataTableHeader>
                      <DataTableHeader>Ticket prom.</DataTableHeader>
                      <DataTableHeader>Última visita</DataTableHeader>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {top.map((c) => (
                      <tr key={c.customer_id} className="transition-colors hover:bg-secondary/40">
                        <DataTableCell>
                          <Link
                            href={`/${tenantSlug}/clientes/${c.customer_id}`}
                            className="font-medium hover:text-primary"
                          >
                            {c.first_name} {c.last_name}
                          </Link>
                        </DataTableCell>
                        <DataTableCell className="tabular-nums">{c.total_visits}</DataTableCell>
                        <DataTableCell className="font-display font-semibold tabular-nums">
                          {fmtCents(c.total_spent_cents)}
                        </DataTableCell>
                        <DataTableCell className="tabular-nums text-muted-foreground">
                          {fmtCents(c.avg_ticket_cents)}
                        </DataTableCell>
                        <DataTableCell className="text-xs text-muted-foreground">
                          {c.last_visit_at
                            ? new Date(c.last_visit_at).toLocaleDateString('es-AR')
                            : '—'}
                        </DataTableCell>
                      </tr>
                    ))}
                  </DataTableBody>
                </DataTableRoot>
              </DataTableScroll>
            )}
          </DataTableShell>

          <ChurnCard rows={churn} tenantSlug={tenantSlug} />

          <div>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a
                href={`/api/stats/export?slug=${encodeURIComponent(tenantSlug)}&type=churn_risk`}
                download
              >
                <ArrowDownToLine className="size-3.5" />
                Exportar churn CSV
              </a>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <DataTableShell>
            <header className="border-b border-border/60 px-5 py-4">
              <h2 className="font-serif text-lg font-semibold tracking-tight">
                Eventos por asistencia
              </h2>
              <p className="text-xs text-muted-foreground">
                Últimos 20 eventos del calendario, por asistencia de las reservas.
              </p>
            </header>
            {events.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="Sin eventos"
                description="Cuando organices eventos, vas a ver acá su tasa de asistencia."
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
                      <DataTableHeader>Asistieron</DataTableHeader>
                      <DataTableHeader>No-show</DataTableHeader>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {events.map((e) => (
                      <tr key={e.event_id} className="transition-colors hover:bg-secondary/40">
                        <DataTableCell className="font-medium">{e.event_name}</DataTableCell>
                        <DataTableCell className="text-xs text-muted-foreground">
                          {new Date(e.starts_at).toLocaleDateString('es-AR')}
                        </DataTableCell>
                        <DataTableCell className="tabular-nums">{e.reservations}</DataTableCell>
                        <DataTableCell className="tabular-nums">{e.attended}</DataTableCell>
                        <DataTableCell>
                          <Badge variant={e.no_show_rate > 0.2 ? 'destructive' : 'secondary'}>
                            {(e.no_show_rate * 100).toFixed(0)}%
                          </Badge>
                        </DataTableCell>
                      </tr>
                    ))}
                  </DataTableBody>
                </DataTableRoot>
              </DataTableScroll>
            )}
          </DataTableShell>
        </TabsContent>

        <TabsContent value="mozos" className="space-y-6">
          <StaffPerformanceTab
            tenantId={access.tenant.id}
            summaries={staffSummaries}
            preset={staffPreset}
          />
        </TabsContent>

        <TabsContent value="comms" className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Recipients"
              value={numberFmt.format(comms.total_recipients)}
              hint="Total alcanzado"
            />
            <StatCard
              label="Enviados"
              value={numberFmt.format(comms.sent)}
              hint={
                comms.total_recipients > 0
                  ? `${Math.round((comms.sent / comms.total_recipients) * 100)}% del total`
                  : undefined
              }
            />
            <StatCard
              label="Entregados"
              value={numberFmt.format(comms.delivered)}
              hint={
                comms.sent > 0
                  ? `${Math.round((comms.delivered / comms.sent) * 100)}% delivery rate`
                  : undefined
              }
            />
            <StatCard
              label="Leídos"
              value={numberFmt.format(comms.read)}
              hint={
                comms.sent > 0
                  ? `${((comms.read / comms.sent) * 100).toFixed(1)}% open (proxy)`
                  : undefined
              }
              deltaTone={comms.failed > 0 ? 'negative' : 'muted'}
            />
          </section>

          <div className="card-hairline rounded-xl border bg-card p-5">
            <h3 className="font-display text-sm font-semibold tracking-tight">Diagnóstico</h3>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between border-b border-border/40 py-1.5">
                <dt className="text-muted-foreground">Open rate (proxy)</dt>
                <dd className="font-medium tabular-nums">
                  {comms.sent > 0 ? `${((comms.read / comms.sent) * 100).toFixed(1)}%` : '—'}
                </dd>
              </div>
              <div className="flex justify-between border-b border-border/40 py-1.5">
                <dt className="text-muted-foreground">Reply rate</dt>
                <dd className="text-xs text-muted-foreground">No implementado en v1</dd>
              </div>
              <div className="flex justify-between border-b border-border/40 py-1.5">
                <dt className="text-muted-foreground">Failed</dt>
                <dd className="font-medium tabular-nums text-destructive">
                  {numberFmt.format(comms.failed)}
                </dd>
              </div>
            </dl>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
