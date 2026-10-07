import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { KPI, type KPIDelta, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryTemplate } from '@/components/ui/page-templates'
import { Section } from '@/components/ui/section'
import { nowInCordoba, todayInCordoba } from '@/lib/dates'
import { formatNumber, formatNumberKind } from '@/lib/format/number-kind'
import { getTodaySalonOverview } from '@/lib/salon/queries'
import { getDailyMetrics, getKpis, getTopCustomersBySpent } from '@/lib/stats/queries'
import { createClient } from '@/lib/supabase/server'
import { homePathForRole, requireTenantAccess } from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { OnboardingChecklist } from './_components/onboarding-checklist'
import { QuickActions } from './_components/quick-actions'
import { TodaySalonOverview } from './_components/today-salon-overview'
import { TopCustomersCard } from './_components/top-customers-card'

export const dynamic = 'force-dynamic'

/** El saludo va con la hora del bar (Córdoba), no con la del server (UTC en Vercel). */
function greet(hour: number): string {
  if (hour < 6) return 'Buenas noches'
  if (hour < 13) return 'Buen día'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Lo que se compara en los KPIs: los últimos 30 días contra los 30 anteriores. */
const PREVIOUS_PERIOD = 'vs. 30 días previos'

/**
 * Variación porcentual para un KPI. Sin datos en el período anterior no hay
 * contra qué comparar y no se muestra (antes decía «sin base»).
 */
function periodDelta(curr: number, prev: number, label: string): KPIDelta | undefined {
  if (prev === 0) {
    return curr === 0 ? { value: '0 %', direction: 'flat', tone: 'neutral', label } : undefined
  }
  const rounded = Math.round(((curr - prev) / prev) * 100)
  if (rounded === 0) return { value: '0 %', direction: 'flat', tone: 'neutral', label }
  const pct = formatNumberKind(rounded, 'percent-100')
  return rounded > 0
    ? { value: `+${pct}`, direction: 'up', tone: 'positive', label }
    : { value: pct, direction: 'down', tone: 'negative', label }
}

async function getOnboardingStatus(
  tenantId: string,
  tenantSettings: Record<string, unknown> | null,
) {
  const supabase = await createClient()
  // El día del bar: con `toISOString()` (UTC), de 21 a 24 h ya era «mañana» y
  // un evento programado para hoy no contaba como próximo.
  const today = todayInCordoba()

  const [templates, scheduled, reservations, closed] = await Promise.all([
    supabase
      .from('scheduled_event_templates')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .limit(1),
    supabase
      .from('scheduled_events')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .gte('event_date', today)
      .limit(1),
    supabase
      .from('salon_reservations')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .limit(1),
    // "Se atendió al menos una reserva". Desde que el salón marca sólo "Llegó"
    // (rediseño del panel de mozos), esperar `closed` dejaba este paso del
    // checklist sin completar para siempre.
    supabase
      .from('salon_reservations')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .in('status', ['arrived', 'seated', 'closed'])
      .limit(1),
  ])

  const caps = (tenantSettings?.salon_capacities ?? null) as {
    planta_alta?: number
    planta_baja?: number
  } | null
  const capacitiesReady = Boolean(
    caps && Number(caps.planta_alta ?? 0) > 0 && Number(caps.planta_baja ?? 0) > 0,
  )

  return {
    capacitiesReady,
    templatesReady: (templates.count ?? 0) > 0,
    eventScheduledReady: (scheduled.count ?? 0) > 0,
    firstReservationReady: (reservations.count ?? 0) > 0,
    firstClosedReady: (closed.count ?? 0) > 0,
  }
}

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { tenant, role } = await requireTenantAccess(tenantSlug)
  // El Resumen es del dueño. El layout y la página se renderizan en paralelo,
  // así que el gate va acá también: cada rol vuelve a su home (la contadora a
  // Administración, el staff al salón) sin ver los números del bar.
  if (role !== 'owner') redirect(homePathForRole(role, tenantSlug))
  const isOwner = role === 'owner'

  // Si el owner no completó el onboarding wizard, redirigirlo allí.
  if (isOwner) {
    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    const onboardingFlag = (settings.onboarding ?? {}) as { completed?: boolean }
    if (!onboardingFlag.completed) {
      redirect(`/${tenantSlug}/onboarding`)
    }
  }

  const tenantSettings = (tenant.settings ?? {}) as Record<string, unknown>
  const today = todayInCordoba()

  const [kpis, daily60, topCustomers, onboarding, todayOverview] = await Promise.all([
    getKpis(tenant.id),
    getDailyMetrics(tenant.id, 60),
    isOwner ? getTopCustomersBySpent(tenant.id, 5) : Promise.resolve([]),
    isOwner ? getOnboardingStatus(tenant.id, tenantSettings) : Promise.resolve(null),
    getTodaySalonOverview({ tenantId: tenant.id, date: today }),
  ])

  const last30 = daily60.slice(-30)
  const prev30 = daily60.slice(0, Math.max(0, daily60.length - 30))

  const visitsLast = last30.reduce((acc, d) => acc + (d.visits ?? 0), 0)
  const visitsPrev = prev30.reduce((acc, d) => acc + (d.visits ?? 0), 0)
  const revenueLast = last30.reduce((acc, d) => acc + Number(d.revenue_cents ?? 0), 0)
  const revenuePrev = prev30.reduce((acc, d) => acc + Number(d.revenue_cents ?? 0), 0)
  const newLast = last30.reduce((acc, d) => acc + (d.customers_new ?? 0), 0)
  const newPrev = prev30.reduce((acc, d) => acc + (d.customers_new ?? 0), 0)

  const chartData = last30.map((d) => ({
    day: d.day,
    visits: d.visits ?? 0,
    revenue_cents: Number(d.revenue_cents ?? 0),
  }))

  const showOnboarding = isOwner && onboarding !== null

  return (
    <SummaryTemplate
      header={
        <PageHeader
          context={`${greet(nowInCordoba().hour)}, ${tenant.name}`}
          title="Resumen"
          description="Cómo viene tu bar hoy y en los últimos 30 días, comparado con los 30 anteriores."
          actions={<QuickActions tenantSlug={tenantSlug} />}
        />
      }
      kpis={
        <KPIGroup>
          <KPI
            label="Clientes"
            value={formatNumber(kpis.customers_total)}
            delta={periodDelta(newLast, newPrev, 'en clientes nuevos')}
            hint={
              newLast > 0
                ? `${formatNumber(newLast)} ${newLast === 1 ? 'nuevo' : 'nuevos'} en los últimos 30 días`
                : 'Sin clientes nuevos en los últimos 30 días'
            }
          />
          <KPI
            label="Activos en 30 días"
            value={formatNumber(kpis.customers_active_30d)}
            hint={
              kpis.customers_total > 0
                ? `${formatNumberKind(
                    Math.round((kpis.customers_active_30d / kpis.customers_total) * 100),
                    'percent-100',
                  )} del total`
                : 'Todavía no hay clientes'
            }
          />
          <KPI
            label="Visitas en 30 días"
            value={formatNumber(kpis.visits_30d)}
            delta={periodDelta(visitsLast, visitsPrev, PREVIOUS_PERIOD)}
            hint={
              visitsLast > 0
                ? `${formatNumber(visitsLast / 30, 1)} por día en promedio`
                : 'Todavía no hay visitas'
            }
          />
          <KPI
            label="Facturación en 30 días"
            value={<Amount cents={kpis.revenue_30d_cents} decimals={0} />}
            delta={periodDelta(revenueLast, revenuePrev, PREVIOUS_PERIOD)}
            hint={
              kpis.visits_30d > 0 ? (
                <>
                  Ticket promedio <Amount cents={kpis.avg_ticket_30d_cents} decimals={0} />
                </>
              ) : (
                'Todavía no hay facturación'
              )
            }
          />
        </KPIGroup>
      }
      attention={
        <div className="flex flex-col gap-8">
          {showOnboarding ? (
            <OnboardingChecklist tenantSlug={tenantSlug} steps={onboarding} />
          ) : null}
          <TodaySalonOverview tenantSlug={tenantSlug} overview={todayOverview} />
        </div>
      }
    >
      {/* El ranking va al costado recién en xl: a 1024 px, con el menú abierto, un tercio son ~210 px. */}
      <div className={cn('grid min-w-0 gap-8', isOwner && 'xl:grid-cols-3')}>
        <Section
          className={cn('min-w-0', isOwner && 'xl:col-span-2')}
          title="Visitas por día"
          description={
            visitsLast > 0
              ? `Últimos 30 días · ${formatNumber(visitsLast)} ${visitsLast === 1 ? 'visita' : 'visitas'} en total`
              : 'Últimos 30 días · todavía sin visitas'
          }
          actions={
            isOwner ? (
              <Button asChild variant="link" size="sm">
                <Link href={`/${tenantSlug}/estadisticas`}>
                  Ver estadísticas
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null
          }
        >
          <Card padding="sm">
            <div className="h-72">
              <RevenueChart data={chartData} metric="visits" />
            </div>
          </Card>
        </Section>

        {isOwner ? (
          <TopCustomersCard tenantSlug={tenantSlug} customers={topCustomers} className="min-w-0" />
        ) : null}
      </div>
    </SummaryTemplate>
  )
}
