import Link from 'next/link'
import { Suspense } from 'react'
import { Planilla, PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Skeleton } from '@/components/ui/skeleton'
import { settleQuery } from '@/lib/accounting/queries'
import { getMonthPlan, getWeekPlan, listPlanParties } from '@/lib/accounting/queries/week-plan'
import {
  addWeeks,
  mondayOf,
  parseMonthParam,
  parseWeekParam,
  weekLabel,
} from '@/lib/accounting/week-plan'
import {
  addMonthsToYearMonth,
  capitalizeFirst,
  formatMonthYear,
  monthOf,
  todayInCordoba,
} from '@/lib/dates'
import { SheetError } from '../_components/planilla-bits'
import { SheetSkeleton, TotalizerSkeleton } from '../_components/planilla-skeleton'
import { firstParam, weekPlanHref } from '../_lib/links'
import { requireComprasAccess } from '../_lib/page-access'
import { MonthTable } from './_components/month-table'
import { StepNav } from './_components/step-nav'
import { WeekSheet } from './_components/week-sheet'

export const metadata = { title: 'Plan de la semana' }

const QUIET_LINK =
  'inline-flex min-h-10 items-center rounded-sm text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-0'

/**
 * Plan de la semana (`?semana=` cualquier día de la semana): la planilla «Pagos Proveedores» de Tomi,
 * con su presupuesto de cada lunes contra lo que se compró y se pagó. `?vista=mes&mes=yyyy-MM`: las
 * semanas una al lado de la otra.
 *
 * La misma puerta que Compras: leen los dueños con acceso y la contadora; a ella, todo en solo
 * lectura. Las solapas las dibuja `AdmNav`.
 */
export default async function WeekPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const { access, canWrite } = await requireComprasAccess(tenantSlug, weekPlanHref(tenantSlug))
  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const thisWeek = mondayOf(today)
  const weekStart = parseWeekParam(firstParam(sp.semana), today)

  if (firstParam(sp.vista) === 'mes') {
    const month = parseMonthParam(firstParam(sp.mes), weekStart)
    const monthHref = (value: string) => weekPlanHref(tenantSlug, { vista: 'mes', mes: value })
    return (
      <SimplePage>
        <h1 className="sr-only">Plan del mes</h1>
        <PlanillaBar>
          <StepNav
            label={capitalizeFirst(formatMonthYear(month))}
            prevHref={monthHref(addMonthsToYearMonth(month, -1))}
            prevLabel="Mes anterior"
            nextHref={monthHref(addMonthsToYearMonth(month, 1))}
            nextLabel="Mes siguiente"
          />
          <Link
            href={weekPlanHref(tenantSlug, {
              semana: monthOf(thisWeek) === month ? null : `${month}-01`,
            })}
            className={QUIET_LINK}
          >
            Ver la semana
          </Link>
          <ReadOnlyBadge className="ml-auto" />
        </PlanillaBar>
        <Suspense
          key={month}
          fallback={
            <>
              <TotalizerSkeleton items={3} />
              <SheetSkeleton rows={6} columns={4} />
            </>
          }
        >
          <MonthBody tenantId={tenantId} tenantSlug={tenantSlug} month={month} />
        </Suspense>
      </SimplePage>
    )
  }

  const weekHref = (monday: string) =>
    weekPlanHref(tenantSlug, { semana: monday === thisWeek ? null : monday })

  return (
    <SimplePage>
      <h1 className="sr-only">Plan de la semana</h1>
      <PlanillaBar>
        <StepNav
          label={weekLabel(weekStart)}
          prevHref={weekHref(addWeeks(weekStart, -1))}
          prevLabel="Semana anterior"
          nextHref={weekHref(addWeeks(weekStart, 1))}
          nextLabel="Semana siguiente"
        />
        {weekStart === thisWeek ? null : (
          <Link href={weekHref(thisWeek)} scroll={false} className={QUIET_LINK}>
            Volver a esta semana
          </Link>
        )}
        <ReadOnlyBadge className="ml-auto" />
      </PlanillaBar>
      <Suspense key={weekStart} fallback={<WeekSkeleton />}>
        <WeekBody
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          weekStart={weekStart}
          canWrite={canWrite}
        />
      </Suspense>
    </SimplePage>
  )
}

/** El totalizador, la barra y las filas. */
function WeekSkeleton() {
  return (
    <>
      <TotalizerSkeleton items={3} />
      <Skeleton className="h-1.5 w-full rounded-full" />
      <SheetSkeleton rows={8} columns={5} />
    </>
  )
}

async function WeekBody({
  tenantId,
  tenantSlug,
  weekStart,
  canWrite,
}: {
  tenantId: string
  tenantSlug: string
  weekStart: string
  canWrite: boolean
}) {
  const [plan, parties] = await Promise.all([
    settleQuery(getWeekPlan(tenantId, weekStart)),
    canWrite ? settleQuery(listPlanParties(tenantId)) : null,
  ])
  if (!plan.ok) {
    return (
      <Planilla>
        <SheetError message={plan.message} />
      </Planilla>
    )
  }
  return (
    <WeekSheet
      // Otra semana es otra planilla: nada de lo escrito se arrastra.
      key={weekStart}
      tenantSlug={tenantSlug}
      weekStart={weekStart}
      rows={plan.data}
      parties={parties?.ok ? parties.data : null}
      canWrite={canWrite}
      monthHref={weekPlanHref(tenantSlug, { vista: 'mes', mes: monthOf(weekStart) })}
    />
  )
}

async function MonthBody({
  tenantId,
  tenantSlug,
  month,
}: {
  tenantId: string
  tenantSlug: string
  month: string
}) {
  const outcome = await settleQuery(getMonthPlan(tenantId, month))
  if (!outcome.ok) {
    return (
      <Planilla>
        <SheetError message={outcome.message} />
      </Planilla>
    )
  }
  const plan = outcome.data
  return (
    <>
      <Totalizer
        items={[
          { label: 'Presupuesto', cents: plan.totals.budgetCents },
          { label: 'Pagado', cents: plan.totals.paidCents, tone: 'ok' },
          {
            label: 'Variación',
            cents: plan.totals.variationCents,
            tone: plan.totals.variationCents > 0 ? 'bad' : 'default',
          },
        ]}
      />
      <MonthTable tenantSlug={tenantSlug} plan={plan} />
    </>
  )
}
