import { ArrowDownRight, ArrowUpRight, PartyPopper, Sparkles, UserCheck, Users } from 'lucide-react'
import { redirect } from 'next/navigation'
import { PeopleChart } from '@/components/charts/people-chart'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { formatCentsShort } from '@/lib/money/format'
import { getSetupStatus } from '@/lib/onboarding/setup'
import { isFeatureEnabled } from '@/lib/platform/features'
import { serviceDayAt } from '@/lib/pos/cash/screen'
import { getSalesDays } from '@/lib/pos/today/queries'
import type { SalesDay } from '@/lib/pos/today/types'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { getTodaySalonOverview } from '@/lib/salon/queries'
import { pulseDelta } from '@/lib/stats/pulse'
import { getBarPulse, getCustomerGrowth, listUpcomingEvents } from '@/lib/stats/pulse-queries'
import { getKpis } from '@/lib/stats/queries'
import { homePathForRole, requireTenantAccess } from '@/lib/tenant'
import type { Tenant } from '@/lib/tenant/types'
import { OnboardingChecklist } from './_components/onboarding-checklist'
import { QuickActions } from './_components/quick-actions'
import { TodaySalonOverview } from './_components/today-salon-overview'
import { UpcomingEventsCard } from './_components/upcoming-events-card'

export const dynamic = 'force-dynamic'

/** Los días que mira el Resumen hacia atrás (y otros tantos antes, para comparar). */
const WINDOW_DAYS = 30

const numberFmt = new Intl.NumberFormat('es-AR')

function greet(): string {
  const hour = Number(
    new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  )
  if (hour < 6) return 'Buenas noches'
  if (hour < 13) return 'Buen día'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function deltaLabel(pct: number | null): {
  label: string
  tone: 'positive' | 'negative' | 'muted'
} {
  if (pct === null) return { label: 'sin comparación', tone: 'muted' }
  if (pct === 0) return { label: 'igual', tone: 'muted' }
  if (pct > 0) return { label: `+${pct}%`, tone: 'positive' }
  return { label: `${pct}%`, tone: 'negative' }
}

/**
 * Lo vendido hoy en el salón, solo si el bar usa el punto de venta (para un superadmin en un bar que
 * no lo tiene sería un cero que no dice nada). Si la lectura falla, el Resumen va sin la ficha.
 */
async function posSalesToday(
  tenant: Pick<Tenant, 'id' | 'timezone'>,
  usesPos: boolean,
): Promise<{ shown: boolean; sales: SalesDay | null }> {
  if (!usesPos) return { shown: false, sales: null }
  const timeZone = tenant.timezone || 'America/Argentina/Cordoba'
  // El día de servicio: hasta las 5 de la mañana sigue siendo la noche anterior.
  const day = serviceDayAt(new Date().toISOString(), timeZone) ?? todayInCordoba()
  const rows = await getSalesDays(tenant.id, day, day, null)
  if (rows === null) return { shown: false, sales: null }
  return { shown: true, sales: rows.find((row) => row.day === day) ?? null }
}

/**
 * El Resumen: lo primero que ve el dueño. Cómo viene hoy (reservas, gente, eventos de la noche y,
 * con punto de venta, lo vendido) y cómo viene el mes (la gente que vino de verdad, contra el mes
 * anterior), más lo que viene en el calendario.
 *
 * Hasta el 18/11/2026 mostraba «visitas» y «facturación», que salen solo de los consumos con puntos
 * cargados (uno o dos por día), y su botón principal era «Cerrar mesa», una pantalla del sistema
 * anterior. Esos números siguen en Estadísticas, con su nombre: consumos del club.
 */
export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { tenant, role } = await requireTenantAccess(tenantSlug)
  // El home es del dueño: cualquier otro rol va al suyo (backstop del proxy).
  if (role !== 'owner') redirect(homePathForRole(role, tenantSlug))

  // Los primeros pasos se muestran hasta que estén todos hechos o el dueño oculte la lista. (Antes
  // un bar nuevo era mandado a un asistente aparte, del servicio de mesa anterior.)
  const tenantSettings = (tenant.settings ?? {}) as Record<string, unknown>
  const onboardingFlag = (tenantSettings.onboarding ?? {}) as { completed?: boolean }
  const showSetup = !onboardingFlag.completed

  const today = todayInCordoba()
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const [pulse, customers, club, upcoming, setup, todayOverview, pos] = await Promise.all([
    getBarPulse({ tenantId: tenant.id, today, windowDays: WINDOW_DAYS }),
    getCustomerGrowth({ tenantId: tenant.id, since }),
    getKpis(tenant.id),
    listUpcomingEvents({ tenantId: tenant.id, today, days: 7 }),
    showSetup
      ? getSetupStatus({ tenantId: tenant.id, today, settings: tenantSettings })
      : Promise.resolve(null),
    getTodaySalonOverview({ tenantId: tenant.id, date: today }),
    posSalesToday(tenant, isFeatureEnabled(tenant, 'pos')),
  ])

  const { current, previous } = pulse
  const coversPct = pulseDelta(current.covers, previous.covers)
  const coversDelta = deltaLabel(coversPct)
  const attendancePct = current.attendance === null ? null : Math.round(current.attendance * 100)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${greet()}, ${tenant.name}`}
        title="Resumen"
        description="Cómo viene hoy y cómo viene el mes."
        actions={<QuickActions tenantSlug={tenantSlug} />}
      />

      {/* Para un bar que recién arranca es lo primero: todavía no tiene números que mirar. */}
      {setup ? <OnboardingChecklist tenantSlug={tenantSlug} steps={setup} /> : null}

      <TodaySalonOverview
        tenantSlug={tenantSlug}
        overview={todayOverview}
        sales={pos.shown ? pos.sales : undefined}
      />

      <section aria-labelledby="home-window" className="space-y-3">
        <h2
          id="home-window"
          className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
        >
          Los últimos {WINDOW_DAYS} días
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            icon={Users}
            iconClassName="text-primary"
            label="Gente que vino"
            numberValue={current.covers}
            numberFormatKind="integer"
            hint={
              current.arrived > 0
                ? `En ${numberFmt.format(current.arrived)} ${current.arrived === 1 ? 'reserva' : 'reservas'}`
                : 'Todavía no hay reservas marcadas «Llegó»'
            }
            // Sin días anteriores con los que comparar no se muestra nada: una etiqueta «sin
            // comparación» ocupa lugar y no dice nada.
            delta={
              coversPct === null ? undefined : (
                <DeltaContent label={coversDelta.label} tone={coversDelta.tone} />
              )
            }
            deltaTone={coversDelta.tone}
          />
          <StatCard
            icon={UserCheck}
            iconClassName="text-success"
            label="Asistencia"
            value={attendancePct === null ? '—' : `${attendancePct}%`}
            hint={
              <>
                {attendancePct === null
                  ? 'Se calcula con las reservas marcadas'
                  : current.noShows === 0
                    ? 'Ninguna marcada «No vino»'
                    : `${numberFmt.format(current.noShows)} no ${current.noShows === 1 ? 'vino' : 'vinieron'}`}
                {current.unmarked > 0 ? (
                  <span className="mt-0.5 block text-(--warning-text)">
                    {numberFmt.format(current.unmarked)}{' '}
                    {current.unmarked === 1 ? 'reserva quedó' : 'reservas quedaron'} sin marcar
                  </span>
                ) : null}
              </>
            }
          />
          <StatCard
            icon={Sparkles}
            iconClassName="text-info"
            label="Clientes"
            numberValue={customers.total}
            numberFormatKind="integer"
            hint={
              customers.added > 0
                ? `+${numberFmt.format(customers.added)} nuevos`
                : 'Sin altas en estos días'
            }
          />
          <StatCard
            icon={PartyPopper}
            iconClassName="text-warning"
            label="Club"
            numberValue={club.visits_30d}
            numberFormatKind="integer"
            hint={
              club.visits_30d > 0 ? (
                <>
                  {club.visits_30d === 1 ? 'consumo' : 'consumos'} con puntos
                  <span className="block">{formatCentsShort(club.revenue_30d_cents)} cargados</span>
                </>
              ) : (
                'Nadie sumó puntos todavía'
              )
            }
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section
          aria-label="Gente por día"
          className="card-hairline relative overflow-hidden rounded-xl border bg-card lg:col-span-2"
        >
          <header className="px-5 py-4">
            <h2 className="font-serif text-lg font-semibold tracking-tight">Gente por día</h2>
            <p className="text-xs text-muted-foreground">
              Los últimos {WINDOW_DAYS} días, según las reservas marcadas «Llegó».
            </p>
          </header>
          <div className="h-64 px-2 pb-4">
            <PeopleChart data={pulse.days} />
          </div>
        </section>

        <UpcomingEventsCard tenantSlug={tenantSlug} events={upcoming} today={today} />
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
