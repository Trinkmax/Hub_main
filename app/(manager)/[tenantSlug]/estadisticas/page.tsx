import { Banknote, CalendarX2, Coins, PartyPopper, Receipt, Sparkles, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DataTable, ExportButton } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate, formatIsoDay } from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
import { NBSP } from '@/lib/money/format'
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
import { StaffPerformanceTab } from './_components/staff-performance-tab'

export const metadata = { title: 'Estadísticas' }
export const dynamic = 'force-dynamic'

/** Las pestañas que entiende `?tab=`; cualquier otro valor cae en la primera. */
const TABS = ['overview', 'customers', 'events', 'comms', 'mozos'] as const
type StatsTab = (typeof TABS)[number]

/** `0,45` → `'45 %'` (entero, espacio duro antes del `%`, como el resto del kit). */
function wholePercent(part: number, total: number): string {
  return `${formatNumber(Math.round((part / total) * 100))}${NBSP}%`
}

/** `0,123` → `'12,3 %'`. */
function percentOneDecimal(part: number, total: number): string {
  return `${formatNumber((part / total) * 100, 1)}${NBSP}%`
}

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
  const activeTab: StatsTab =
    typeof sp.tab === 'string' && (TABS as readonly string[]).includes(sp.tab)
      ? (sp.tab as StatsTab)
      : 'overview'

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
  const exportBase = `/api/stats/export?slug=${encodeURIComponent(tenantSlug)}`

  return (
    <PageShell>
      <PageHeader
        title="Estadísticas"
        description="Vista profunda de tu bar: clientes, visitas, eventos y comunicaciones."
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${tenantSlug}/estadisticas/como-nos-fue`}>
                <PartyPopper aria-hidden />
                Cómo nos fue
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${tenantSlug}/estadisticas/senas`}>
                <Banknote aria-hidden />
                Señas
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${tenantSlug}/estadisticas/comisiones`}>
                <Coins aria-hidden />
                Comisiones
              </Link>
            </Button>
          </>
        }
      />

      {/* `syncParam`: la pestaña queda en la URL (`?tab=`), así se puede volver
          o compartir; el selector de período de «Mozos» ya escribe `tab=mozos`. */}
      <Tabs defaultValue={activeTab} syncParam="tab">
        <TabsList aria-label="Secciones de estadísticas">
          <TabsTrigger value="overview">Visión general</TabsTrigger>
          <TabsTrigger value="customers">Clientes</TabsTrigger>
          <TabsTrigger value="events">Eventos</TabsTrigger>
          <TabsTrigger value="comms">Comunicación</TabsTrigger>
          <TabsTrigger value="mozos">Mozos</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-8 pt-4">
          <KPIGroup columns={4}>
            <KPI icon={Users} label="Clientes" value={formatNumber(kpis.customers_total)} />
            <KPI
              icon={Sparkles}
              label="Activos en 30 días"
              value={formatNumber(kpis.customers_active_30d)}
              hint={
                kpis.customers_total > 0
                  ? `${wholePercent(kpis.customers_active_30d, kpis.customers_total)} del total`
                  : undefined
              }
            />
            <KPI
              icon={Receipt}
              label="Visitas en 30 días"
              value={formatNumber(kpis.visits_30d)}
              hint={
                kpis.visits_30d > 0 ? `${formatNumber(kpis.visits_30d / 30, 1)} por día` : undefined
              }
            />
            <KPI
              icon={Banknote}
              label="Ticket promedio"
              value={<Amount cents={kpis.avg_ticket_30d_cents} decimals={0} />}
            />
          </KPIGroup>

          <Section
            title="Facturación de los últimos 90 días"
            description={
              <>
                <Amount cents={totalRevenue} decimals={0} className="font-medium text-foreground" />{' '}
                acumulado en 90 días
              </>
            }
          >
            <Card padding="sm">
              <div className="h-72">
                <RevenueChart
                  data={daily90.map((d) => ({
                    day: d.day,
                    visits: d.visits,
                    revenue_cents: Number(d.revenue_cents ?? 0),
                  }))}
                  metric="revenue_cents"
                />
              </div>
            </Card>
          </Section>

          <Heatmap data={heatmap} />
        </TabsContent>

        <TabsContent value="customers" className="flex flex-col gap-8 pt-4">
          <Section
            title="Los 50 que más gastaron"
            description="Clientes con más gasto acumulado. Tocá uno para abrir su ficha."
            actions={<ExportButton href={`${exportBase}&type=top_customers`} size="sm" />}
          >
            <DataTable
              caption="Los 50 clientes que más gastaron"
              rows={top}
              getRowId={(c) => c.customer_id}
              rowHref={(c) => `/${tenantSlug}/clientes/${c.customer_id}`}
              rowLabel={(c) => `${c.first_name} ${c.last_name}`.trim()}
              columns={[
                {
                  id: 'cliente',
                  header: 'Cliente',
                  cell: (c) => `${c.first_name} ${c.last_name}`.trim(),
                },
                {
                  id: 'visitas',
                  header: 'Visitas',
                  numeric: true,
                  mobile: 'hidden',
                  cell: (c) => formatNumber(c.total_visits),
                },
                // La plata lleva su `$` en la celda: en el celular la lista pasa
                // a tarjetas y el encabezado no se ve.
                {
                  id: 'gasto',
                  header: 'Gastó',
                  numeric: true,
                  cell: (c) => <Amount cents={c.total_spent_cents} decimals={0} />,
                },
                {
                  id: 'ticket',
                  header: 'Ticket promedio',
                  numeric: true,
                  hideBelow: 'lg',
                  mobile: 'hidden',
                  cell: (c) => <Amount cents={c.avg_ticket_cents} decimals={0} tone="muted" />,
                },
                {
                  id: 'ultima',
                  header: 'Última visita',
                  mobile: 'meta',
                  cell: (c) =>
                    c.last_visit_at ? (
                      <span className="type-amount text-muted-foreground">
                        {formatDate(c.last_visit_at)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
              ]}
              empty={
                <EmptyState
                  size="sm"
                  icon={Users}
                  title="Todavía no hay ranking"
                  description="Cuando empieces a registrar visitas, vas a ver acá a los clientes que más gastan."
                />
              }
            />
          </Section>

          <ChurnCard
            rows={churn}
            tenantSlug={tenantSlug}
            exportHref={`${exportBase}&type=churn_risk`}
          />
        </TabsContent>

        <TabsContent value="events" className="flex flex-col gap-8 pt-4">
          <Section
            title="Eventos por asistencia"
            description="Las últimas 20 fechas del calendario, con la asistencia de sus reservas."
          >
            <DataTable
              caption="Eventos por asistencia"
              rows={events}
              getRowId={(e) => e.event_id}
              // Un reporte de cifras: en el celular se desliza de costado con el
              // nombre fijo, así cada número sigue debajo de su encabezado.
              mobile="scroll"
              columns={[
                { id: 'evento', header: 'Evento', cell: (e) => e.event_name },
                {
                  id: 'fecha',
                  header: 'Fecha',
                  // `starts_at` es un `date` civil: se corta el string. Con
                  // `new Date()` caía un día antes en Córdoba.
                  cell: (e) => (
                    <span className="type-amount text-muted-foreground">
                      {formatIsoDay(e.starts_at)}
                    </span>
                  ),
                },
                {
                  id: 'reservas',
                  header: 'Reservas',
                  numeric: true,
                  cell: (e) => formatNumber(e.reservations),
                },
                {
                  id: 'asistieron',
                  header: 'Vinieron',
                  numeric: true,
                  cell: (e) => formatNumber(e.attended),
                },
                {
                  id: 'noshow',
                  header: 'No vinieron',
                  align: 'end',
                  cell: (e) => (
                    <Badge tone={e.no_show_rate > 0.2 ? 'danger' : 'neutral'}>
                      {`${formatNumber(Math.round(e.no_show_rate * 100))}${NBSP}%`}
                    </Badge>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  size="sm"
                  icon={CalendarX2}
                  title="Todavía no hay eventos"
                  description="Cuando programes eventos en el calendario, vas a ver acá cuánta gente vino a cada uno."
                />
              }
            />
          </Section>
        </TabsContent>

        <TabsContent value="mozos" className="flex flex-col gap-8 pt-4">
          <StaffPerformanceTab
            tenantId={access.tenant.id}
            summaries={staffSummaries}
            preset={staffPreset}
          />
        </TabsContent>

        <TabsContent value="comms" className="flex flex-col gap-8 pt-4">
          <KPIGroup columns={4}>
            <KPI
              label="Destinatarios"
              value={formatNumber(comms.total_recipients)}
              hint="Total alcanzado"
            />
            <KPI
              label="Enviados"
              value={formatNumber(comms.sent)}
              hint={
                comms.total_recipients > 0
                  ? `${wholePercent(comms.sent, comms.total_recipients)} del total`
                  : undefined
              }
            />
            <KPI
              label="Entregados"
              value={formatNumber(comms.delivered)}
              hint={
                comms.sent > 0
                  ? `${wholePercent(comms.delivered, comms.sent)} de los enviados`
                  : undefined
              }
            />
            <KPI
              label="Leídos"
              value={formatNumber(comms.read)}
              hint={
                comms.sent > 0
                  ? `${percentOneDecimal(comms.read, comms.sent)} de los enviados (aprox.)`
                  : undefined
              }
            />
          </KPIGroup>

          <Section
            title="Diagnóstico"
            description="La lectura es aproximada: solo se cuenta cuando el cliente tiene activadas las confirmaciones de lectura."
          >
            <Card padding="sm">
              <dl className="grid gap-x-8 sm:grid-cols-2">
                <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
                  <dt className="type-small text-muted-foreground">Tasa de lectura (aprox.)</dt>
                  <dd className="type-body type-amount font-medium">
                    {comms.sent > 0 ? percentOneDecimal(comms.read, comms.sent) : '—'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
                  <dt className="type-small text-muted-foreground">Tasa de respuesta</dt>
                  <dd className="type-small text-muted-foreground">Todavía no la medimos</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="type-small text-muted-foreground">Fallidos</dt>
                  <dd
                    className={
                      comms.failed > 0
                        ? 'type-body type-amount font-medium text-destructive-text'
                        : 'type-body type-amount font-medium'
                    }
                  >
                    {formatNumber(comms.failed)}
                  </dd>
                </div>
              </dl>
            </Card>
          </Section>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
