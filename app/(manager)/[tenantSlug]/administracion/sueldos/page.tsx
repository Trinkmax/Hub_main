import { PanelError } from '@/components/administracion/kit'
import { PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import {
  parsePayrollMonth,
  payrollHref,
  payrollMonths,
  payrollTotals,
  settleHint,
} from '@/lib/accounting/payroll'
import { settleQuery } from '@/lib/accounting/queries'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { todayInCordoba } from '@/lib/dates'
import { firstParam } from '../compras/_lib/links'
import { requireComprasAccess } from '../compras/_lib/page-access'
import { MonthSeg } from '../gastos-fijos/_components/month-seg'
import { PayrollSheet } from './_components/payroll-sheet'

export const metadata = { title: 'Sueldos' }

/**
 * Sueldos: la planilla del personal (reunión del 29/10/2026, Luciano: «lo que más me importa es saber
 * cuánto le debo a fin de mes»). Un empleado por fila, con su sueldo, sus adelantos, lo pagado y el
 * saldo. El sueldo se escribe en su celda y los meses siguientes lo heredan.
 *
 * La misma puerta que Gastos fijos: leen los dueños con acceso y la contadora, y solo a quien carga se
 * le dibujan los controles que escriben. El mes vive en la URL (`?mes=yyyy-MM`).
 */
export default async function SueldosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])
  const { access, canWrite } = await requireComprasAccess(tenantSlug, payrollHref(tenantSlug))
  const today = todayInCordoba()
  const month = parsePayrollMonth(firstParam(sp.mes), today)
  const bar = (
    <PlanillaBar>
      <MonthSeg
        label="Mes de la planilla"
        months={payrollMonths(today, month)}
        active={month}
        hrefOf={(m) => payrollHref(tenantSlug, m)}
      />
      <ReadOnlyBadge className="ml-auto" />
    </PlanillaBar>
  )

  const outcome = await settleQuery(getPayrollReport(access.tenant.id, month))
  if (!outcome.ok) {
    return (
      <SimplePage>
        <h1 className="sr-only">Sueldos</h1>
        {bar}
        <PanelError title="La planilla de sueldos" message={outcome.message} />
      </SimplePage>
    )
  }

  const report = outcome.data
  const totals = payrollTotals(report.employees)
  // Sin sueldos ni movimientos no hay nada que sumar: nunca «$ 0» por un dato que falta.
  const blank = totals.salaryCents === 0 && totals.advancesCents === 0 && totals.paidCents === 0

  return (
    <SimplePage>
      <h1 className="sr-only">Sueldos</h1>
      {bar}
      <Totalizer
        items={[
          { label: 'Sueldos del mes', cents: blank ? null : totals.salaryCents },
          { label: 'Adelantos', cents: blank ? null : totals.advancesCents },
          { label: 'Pagado', cents: blank ? null : totals.paidCents, tone: 'ok' },
          {
            label: 'Le debés a fin de mes',
            cents: blank ? null : totals.owedCents,
            tone: totals.owedCents > 0 ? 'warn' : 'default',
            hint: settleHint(month),
          },
        ]}
      />
      <PayrollSheet report={report} today={today} canWrite={canWrite} />
    </SimplePage>
  )
}
