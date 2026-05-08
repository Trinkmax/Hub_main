import { ArrowDownRight, ArrowUpRight, Banknote, Receipt, Sparkles, Users } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Sparkline } from '@/components/charts/sparkline'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { getDailyMetrics, getKpis, getTopCustomersBySpent } from '@/lib/stats/queries'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'
import { OnboardingChecklist } from './_components/onboarding-checklist'
import { QuickActions } from './_components/quick-actions'
import { TopCustomersCard } from './_components/top-customers-card'
import { RevenueChart } from './estadisticas/_components/revenue-chart'

export const dynamic = 'force-dynamic'

const numberFmt = new Intl.NumberFormat('es-AR')

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function greet(): string {
  const hour = new Date().getHours()
  if (hour < 6) return 'Buenas noches'
  if (hour < 13) return 'Buen día'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function diffPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return ((curr - prev) / prev) * 100
}

function deltaLabel(pct: number | null): {
  label: string
  tone: 'positive' | 'negative' | 'muted'
} {
  if (pct === null) return { label: 'sin base', tone: 'muted' }
  const rounded = Math.round(pct)
  if (rounded === 0) return { label: '0%', tone: 'muted' }
  if (rounded > 0) return { label: `+${rounded}%`, tone: 'positive' }
  return { label: `${rounded}%`, tone: 'negative' }
}

async function getOnboardingStatus(tenantId: string) {
  const supabase = await createClient()
  const [menu, capture, channel, visit] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .limit(1),
    supabase
      .from('customer_capture_links')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .limit(1),
    supabase
      .from('channels')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'connected')
      .limit(1),
    supabase
      .from('visits')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .limit(1),
  ])

  return {
    menuReady: (menu.count ?? 0) > 0,
    captureLinkReady: (capture.count ?? 0) > 0,
    channelConnected: (channel.count ?? 0) > 0,
    firstVisit: (visit.count ?? 0) > 0,
  }
}

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { tenant, role } = await requireTenantAccess(tenantSlug)
  const isOwner = role === 'owner'

  // Si el owner no completó el onboarding wizard, redirigirlo allí.
  if (isOwner) {
    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    const onboardingFlag = (settings.onboarding ?? {}) as { completed?: boolean }
    if (!onboardingFlag.completed) {
      redirect(`/${tenantSlug}/onboarding`)
    }
  }

  const [kpis, daily60, topCustomers, onboarding] = await Promise.all([
    getKpis(tenant.id),
    getDailyMetrics(tenant.id, 60),
    isOwner ? getTopCustomersBySpent(tenant.id, 5) : Promise.resolve([]),
    isOwner ? getOnboardingStatus(tenant.id) : Promise.resolve(null),
  ])

  const last30 = daily60.slice(-30)
  const prev30 = daily60.slice(0, Math.max(0, daily60.length - 30))

  const visitsLast = last30.reduce((acc, d) => acc + (d.visits ?? 0), 0)
  const visitsPrev = prev30.reduce((acc, d) => acc + (d.visits ?? 0), 0)
  const revenueLast = last30.reduce((acc, d) => acc + Number(d.revenue_cents ?? 0), 0)
  const revenuePrev = prev30.reduce((acc, d) => acc + Number(d.revenue_cents ?? 0), 0)
  const newLast = last30.reduce((acc, d) => acc + (d.customers_new ?? 0), 0)
  const newPrev = prev30.reduce((acc, d) => acc + (d.customers_new ?? 0), 0)

  const visitsDelta = deltaLabel(diffPct(visitsLast, visitsPrev))
  const revenueDelta = deltaLabel(diffPct(revenueLast, revenuePrev))
  const newCustomersDelta = deltaLabel(diffPct(newLast, newPrev))

  const visitsSparkData = last30.map((d) => ({ value: d.visits ?? 0 }))
  const revenueSparkData = last30.map((d) => ({ value: Number(d.revenue_cents ?? 0) }))
  const activitySparkData = last30.map((d) => ({ value: d.customers_active ?? 0 }))

  const chartData = last30.map((d) => ({
    day: d.day,
    visits: d.visits ?? 0,
    revenue_cents: Number(d.revenue_cents ?? 0),
  }))

  const showOnboarding = isOwner && onboarding && !onboarding.firstVisit

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${greet()}, ${tenant.name}`}
        title="Resumen"
        description="Lo que pasó en tu bar en los últimos 30 días."
        actions={<QuickActions tenantSlug={tenantSlug} role={role as TenantRole} />}
      />

      <section aria-label="Indicadores clave" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label="Clientes"
          numberValue={kpis.customers_total}
          numberFormatKind="integer"
          hint={newLast > 0 ? `+${numberFmt.format(newLast)} nuevos en 30d` : 'Sin altas en 30d'}
          delta={newCustomersDelta.label}
          deltaTone={newCustomersDelta.tone}
        />
        <StatCard
          icon={Sparkles}
          label="Activos 30d"
          numberValue={kpis.customers_active_30d}
          numberFormatKind="integer"
          hint={
            kpis.customers_total > 0
              ? `${Math.round((kpis.customers_active_30d / kpis.customers_total) * 100)}% del total`
              : 'Aún sin clientes'
          }
          sparkline={
            <Sparkline
              data={activitySparkData}
              dataKey="value"
              color="var(--chart-2)"
              height={48}
            />
          }
        />
        <StatCard
          icon={Receipt}
          label="Visitas 30d"
          numberValue={kpis.visits_30d}
          numberFormatKind="integer"
          hint={
            visitsLast > 0 ? `Promedio ${(visitsLast / 30).toFixed(1)}/día` : 'Sin visitas todavía'
          }
          delta={<DeltaContent label={visitsDelta.label} tone={visitsDelta.tone} />}
          deltaTone={visitsDelta.tone}
          sparkline={
            <Sparkline data={visitsSparkData} dataKey="value" color="var(--chart-1)" height={48} />
          }
        />
        <StatCard
          icon={Banknote}
          label="Revenue 30d"
          numberValue={kpis.revenue_30d_cents}
          numberFormatKind="currency-cents-ars"
          hint={
            kpis.visits_30d > 0
              ? `Ticket promedio ${fmtCents(kpis.avg_ticket_30d_cents)}`
              : 'Sin revenue todavía'
          }
          delta={<DeltaContent label={revenueDelta.label} tone={revenueDelta.tone} />}
          deltaTone={revenueDelta.tone}
          sparkline={
            <Sparkline data={revenueSparkData} dataKey="value" color="var(--chart-3)" height={48} />
          }
        />
      </section>

      {showOnboarding ? <OnboardingChecklist tenantSlug={tenantSlug} steps={onboarding} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card-hairline relative overflow-hidden rounded-xl border bg-card lg:col-span-2">
          <header className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight">
                Visitas últimos 30 días
              </h2>
              <p className="text-xs text-muted-foreground">
                {visitsLast > 0
                  ? `${numberFmt.format(visitsLast)} visitas en total`
                  : 'Sin visitas en el rango'}
              </p>
            </div>
            <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              30d
            </span>
          </header>
          <div className="h-72 px-2 pb-4">
            <RevenueChart data={chartData} metric="visits" />
          </div>
        </div>

        {isOwner ? <TopCustomersCard tenantSlug={tenantSlug} customers={topCustomers} /> : null}
      </div>
    </div>
  )
}

function DeltaContent({ label, tone }: { label: string; tone: 'positive' | 'negative' | 'muted' }) {
  if (tone === 'positive') {
    return (
      <>
        <ArrowUpRight className="size-3" />
        {label}
      </>
    )
  }
  if (tone === 'negative') {
    return (
      <>
        <ArrowDownRight className="size-3" />
        {label}
      </>
    )
  }
  return <>{label}</>
}
