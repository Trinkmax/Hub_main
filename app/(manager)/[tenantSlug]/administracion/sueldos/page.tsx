import { PanelError } from '@/components/administracion/kit'
import { PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { Totalizer, type TotalizerItem } from '@/components/administracion/planilla/totalizer'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import {
  parsePayrollMonth,
  payrollExtras,
  payrollHref,
  payrollMonths,
  payrollTotals,
  settleHint,
} from '@/lib/accounting/payroll'
import { posCashFor } from '@/lib/accounting/pos-cash'
import { settleQuery } from '@/lib/accounting/queries'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listPosCashPending } from '@/lib/accounting/queries/pos-cash'
import { todayInCordoba } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { firstParam } from '../compras/_lib/links'
import { requireComprasAccess } from '../compras/_lib/page-access'
import { MonthSeg } from '../gastos-fijos/_components/month-seg'
import { PayrollSheet } from './_components/payroll-sheet'

export const metadata = { title: 'Sueldos' }

/** «$ 50.000 de la caja»: la parte de un total que salió de la caja del salón y falta pasar. */
function cashHint(cents: number): string | undefined {
  return cents > 0 ? `${formatCentsShort(cents)} de la caja` : undefined
}

/**
 * Sueldos: la planilla del personal (reunión del 29/10/2026, Luciano: «lo que más me importa es saber
 * cuánto le debo a fin de mes»). Un empleado por fila, con su sueldo, sus adelantos, lo pagado y el
 * saldo. El sueldo se escribe en su celda y los meses siguientes lo heredan.
 *
 * Desde el 22/11/2026 (pedido de los socios): el sueldo se puede abrir en blanco y en negro, cada
 * adelanto o pago dice de qué parte fue y qué fechas cubre, hay horas extra (aparte del saldo) y,
 * arriba, la bandeja «De la caja del salón» con los retiros para el personal que esperan su
 * comprobante (la planilla ya los cuenta desde que salen).
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

  const [outcome, cashOutcome] = await Promise.all([
    settleQuery(getPayrollReport(access.tenant.id, month)),
    // La bandeja es de quien carga (la contadora no lee la caja del salón). Si no se puede leer, la
    // planilla sigue igual: es un atajo, no un dato de la pantalla.
    canWrite ? settleQuery(listPosCashPending(access.tenant.id)) : null,
  ])
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
  const pendingCash = cashOutcome?.ok ? posCashFor(cashOutcome.data, 'payroll') : []
  const totals = payrollTotals(report.employees)
  const extras = payrollExtras(report.employees)
  // Sin sueldos ni movimientos no hay nada que sumar: nunca «$ 0» por un dato que falta.
  const blank = totals.salaryCents === 0 && totals.advancesCents === 0 && totals.paidCents === 0
  const items: TotalizerItem[] = [
    {
      label: 'Sueldos del mes',
      cents: blank ? null : totals.salaryCents,
      // La apertura en blanco y en negro es de quien carga.
      hint:
        canWrite && extras.salaryOffBooksCents > 0
          ? `${formatCentsShort(extras.salaryOffBooksCents)} en negro`
          : undefined,
    },
    // Lo que salió de la caja del salón ya está contado, aunque falte su comprobante.
    {
      label: 'Adelantos',
      cents: blank ? null : totals.advancesCents,
      hint: cashHint(extras.pendingAdvancesCents),
    },
    {
      label: 'Pagado',
      cents: blank ? null : totals.paidCents,
      tone: 'ok',
      hint: cashHint(extras.pendingPaidCents),
    },
    {
      label: 'Le debés a fin de mes',
      cents: blank ? null : totals.owedCents,
      tone: totals.owedCents > 0 ? 'warn' : 'default',
      hint: settleHint(month),
    },
  ]
  // Las horas extra van aparte: no son parte de lo que se le debe.
  if (extras.overtimeCents > 0) {
    items.push({ label: 'Horas extra', cents: extras.overtimeCents })
  }

  return (
    <SimplePage>
      <h1 className="sr-only">Sueldos</h1>
      {bar}
      <Totalizer items={items} />
      <PayrollSheet report={report} today={today} canWrite={canWrite} pendingCash={pendingCash} />
    </SimplePage>
  )
}
