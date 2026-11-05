import 'server-only'
import { buildSetup, buildToday, type SetupStrip, type TodayItem } from '@/lib/accounting/home'
import { type PayrollTotals, payrollTotals } from '@/lib/accounting/payroll'
import { buildProjection, type Projection } from '@/lib/accounting/projection'
import {
  type AccountingSettings,
  type AccSummary,
  getAccountingSettings,
  getSummary,
  getSupplierCategoryCount,
  listRecurringExpenses,
  type QueryOutcome,
  type RecurringExpenseRow,
  settleQuery,
} from '@/lib/accounting/queries'
import {
  getIntegrationAttention,
  type IntegrationAttentionItem,
} from '@/lib/accounting/queries/integrations'
import { getOnboarding, type OnboardingOverview } from '@/lib/accounting/queries/onboarding'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { getSalesProjection } from '@/lib/accounting/queries/projection'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import type { RecurringPaymentFacts } from '@/lib/accounting/recurring-status'
import { mondayOf, type WeekPlanTotals, weekPlanTotals } from '@/lib/accounting/week-plan'
import { monthOf, monthRange } from '@/lib/dates'

/**
 * Las lecturas del Resumen, pedidas todas juntas y SIN esperarlas: la página
 * arma la pantalla y cada bloque espera solo lo que necesita, adentro de su
 * `Suspense`. Así la fecha sale al instante y `acc_report_summary` (la lenta: de
 * 330 ms a 2 s) no frena a lo demás.
 *
 * Cada promesa se crea UNA vez y se reparte: el módulo no cachea lecturas, dos
 * bloques que pidieran lo mismo harían dos viajes. `settleQuery` nunca rechaza,
 * así que una lectura que falla se dice ahí y el resto sale igual.
 */

type Settled<T> = Promise<QueryOutcome<T>>

/** «Para hoy» y la puesta en marcha, ya armados. */
export type HomeAgenda = {
  today: TodayItem[]
  setup: SetupStrip
}

export type HomeData = {
  /** `/<bar>/administracion`. */
  base: string
  /** El bar de la URL, ya validado por `requireAccountingAccess`: va explícito en cada lectura. */
  tenantId: string
  tenantSlug: string
  /** Hoy en Córdoba: la plata y los vencimientos. */
  today: string
  /** El día de servicio (antes de las 5:00 es ayer): las ventas. */
  serviceDay: string
  canWrite: boolean
  summary: Settled<AccSummary>
  /** `null` si el bar todavía no tiene ajustes (no pasa una vez configurada la sección). */
  settings: Settled<AccountingSettings | null>
  /** La proyección del mes ya armada (`buildProjection`): la misma de Ventas › Proyección. */
  projection: Settled<Projection>
  recurring: Settled<RecurringExpenseRow[]>
  payments: Settled<Map<string, RecurringPaymentFacts>>
  /** Los sueldos del mes: lo que falta pagar es `owedCents`. */
  payroll: Settled<PayrollTotals>
  /** El Plan de la semana en curso, sumado. */
  weekPlan: Settled<WeekPlanTotals>
  onboarding: Settled<OnboardingOverview | null>
  /** Avisos de ARCA, Mercado Pago, el banco y Mis Comprobantes. `null`: quien solo lee. */
  integration: Settled<IntegrationAttentionItem[]> | null
  agenda: Promise<HomeAgenda>
}

export function loadHome(input: {
  tenantId: string
  tenantSlug: string
  today: string
  serviceDay: string
  canWrite: boolean
}): HomeData {
  const { tenantId, tenantSlug, today, serviceDay, canWrite } = input
  const base = `/${tenantSlug}/administracion`

  const summary = settleQuery(getSummary(tenantId, { asOf: today }))
  const settings = settleQuery(getAccountingSettings(tenantId))
  const projection = settleQuery(
    getSalesProjection(tenantId, monthRange(today)).then((rows) =>
      buildProjection(rows, { serviceDay }),
    ),
  )
  // Con los inactivos: un gasto en cuotas que terminó este mes se apaga solo, pero lo que
  // se pagó sigue contando (así el número coincide con el de la pestaña Gastos fijos).
  const recurring = settleQuery(listRecurringExpenses(tenantId, { includeInactive: true, today }))
  const payments = settleQuery(listRecurringPayments(tenantId))
  const payroll = settleQuery(
    getPayrollReport(tenantId, monthOf(today)).then((report) => payrollTotals(report.employees)),
  )
  const weekPlan = settleQuery(getWeekPlan(tenantId, mondayOf(today)).then(weekPlanTotals))
  const onboarding = settleQuery(getOnboarding(tenantId))
  const integration = canWrite ? settleQuery(getIntegrationAttention(tenantId)) : null
  // Solo para la puesta en marcha, que quien solo lee no recibe con acciones.
  const suppliers = canWrite ? settleQuery(getSupplierCategoryCount(tenantId)) : null

  const agenda = Promise.all([
    summary,
    settings,
    projection,
    recurring,
    onboarding,
    integration,
    suppliers,
  ]).then(([s, st, p, r, o, i, sup]): HomeAgenda => {
    const summaryData = s.ok ? s.data : null
    const settingsData = st.ok ? st.data : null
    const recurringRows = r.ok ? r.data : null
    const guide = o.ok ? o.data : null
    return {
      today: buildToday({
        summary: summaryData,
        settings: settingsData,
        projection: p.ok ? p.data : null,
        recurring: recurringRows,
        onboarding: guide,
        integration: i?.ok ? i.data : null,
        today,
        serviceDay,
        canWrite,
        base,
      }),
      setup: buildSetup({
        summary: summaryData,
        settings: settingsData,
        onboarding: guide,
        recurring: recurringRows,
        suppliers: sup?.ok ? sup.data : null,
        canWrite,
        base,
      }),
    }
  })

  return {
    base,
    tenantId,
    tenantSlug,
    today,
    serviceDay,
    canWrite,
    summary,
    settings,
    projection,
    recurring,
    payments,
    payroll,
    weekPlan,
    onboarding,
    integration,
    agenda,
  }
}
