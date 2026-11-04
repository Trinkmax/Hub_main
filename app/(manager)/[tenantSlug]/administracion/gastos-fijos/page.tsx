import { PanelError } from '@/components/administracion/kit'
import { PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { loadPostingCatalog } from '@/lib/accounting/context'
import { payrollTotals } from '@/lib/accounting/payroll'
import { listRecurringExpenses, settleQuery } from '@/lib/accounting/queries'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import { addMonthsToYearMonth, monthOf, todayInCordoba } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { BulkRecurringDialog } from '../compras/_components/bulk-recurring-dialog'
import { isPurchaseImputation } from '../compras/_lib/accounts'
import { firstParam, gastosFijosHref, isUuidLike } from '../compras/_lib/links'
import { requireComprasAccess } from '../compras/_lib/page-access'
import { MonthSeg } from './_components/month-seg'
import { SheetView } from './_components/sheet'
import { VoidedNotice } from './_components/voided-notice'
import { buildSheet, defaultSheetMonth, parseSheetMonth } from './_lib/planilla'
import {
  type AutoTaxPlan,
  autoTaxPlan,
  monthWord,
  type Sheet,
  sheetTotals,
} from './_lib/planilla-words'

export const metadata = { title: 'Gastos fijos' }

/**
 * Gastos fijos: la planilla de todos los meses, como la que ya llevan los socios. Arriba, el
 * totalizador que pidió Tomi (total, pagado, por pagar y vencido, con los sueldos adentro). Abajo, una
 * fila por gasto: tildar paga («como pagar la EPEC, vas marcando») y el monto se escribe en su celda.
 * El alta y la ficha completa siguen en `/compras/gastos-fijos/[id]` y los montos de corrido, en
 * `./completar`.
 *
 * La misma puerta que Compras: leen los dueños con acceso y la contadora, y solo a quien carga se le
 * dibujan los controles que escriben.
 *
 * El estado vive en la URL: `?mes=` (el de hoy o el que viene) y `?abrir=<uuid>` (el renglón que entra
 * a la vista).
 */
export default async function GastosFijosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])
  const { access, canWrite } = await requireComprasAccess(tenantSlug, gastosFijosHref(tenantSlug))
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const [rowsOutcome, paymentsOutcome, catalogOutcome] = await Promise.all([
    settleQuery(listRecurringExpenses(tenantId, { includeInactive: true, today })),
    settleQuery(listRecurringPayments(tenantId)),
    canWrite ? settleQuery(loadPostingCatalog(tenantId)) : null,
  ])

  // Sin los pagos no se dibuja la hoja: un pagado que se ve «sin pagar» invita a pagar dos veces.
  if (!rowsOutcome.ok || !paymentsOutcome.ok) {
    const message = !rowsOutcome.ok
      ? rowsOutcome.message
      : !paymentsOutcome.ok
        ? paymentsOutcome.message
        : ''
    return (
      <SimplePage>
        <h1 className="sr-only">Gastos fijos</h1>
        <PanelError title="La planilla del mes" message={message} />
      </SimplePage>
    )
  }

  const rows = rowsOutcome.data
  const payments = paymentsOutcome.data

  // «Pegar una lista»: las cuentas que sirven para un gasto (y sus grupos, para la ruta).
  const catalog = catalogOutcome?.ok ? catalogOutcome.data : null
  const accounts = catalog?.accounts ?? []
  const imputable = new Set(accounts.filter(isPurchaseImputation).map((a) => a.id))
  const miscAccountId = accounts.find((a) => a.systemKey === 'misc_expenses')?.id ?? null
  const pasteList =
    canWrite && catalog ? (
      <BulkRecurringDialog
        tenantSlug={tenantSlug}
        today={today}
        trigger={rows.length === 0 ? 'primary' : 'link'}
        accounts={accounts
          .filter((a) => imputable.has(a.id) || !a.postable)
          .map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            postable: a.postable && imputable.has(a.id),
            active: a.active,
            description: a.description,
          }))}
        existingNames={rows.map((r) => r.name)}
        fallbackAccountId={
          miscAccountId !== null && imputable.has(miscAccountId) ? miscAccountId : null
        }
      />
    ) : null
  // Si el catálogo no se pudo leer, la tira de pago lo vuelve a decidir con lo que trae al abrirse.
  const autoTax: AutoTaxPlan = catalog
    ? autoTaxPlan({
        settings: catalog.settings.taxSettings,
        accounts: catalog.accounts,
        parties: catalog.parties,
      })
    : {}

  const currentMonth = monthOf(today)
  const nextMonth = addMonthsToYearMonth(currentMonth, 1)
  const build = (month: string) => buildSheet(rows, payments, { month, today })
  const sheets = { current: build(currentMonth), next: build(nextMonth) }

  const openRaw = firstParam(sp.abrir)
  const openId = isUuidLike(openRaw) ? openRaw : null
  const asked = parseSheetMonth(firstParam(sp.mes), today)
  const fallback = defaultSheetMonth(sheets.current, sheets.next)
  // `?abrir=` sin mes: la hoja donde ese renglón vence.
  const holds = (sheet: Sheet) => sheet.items.some((item) => item.row.id === openId)
  const opened =
    openId === null || asked !== null
      ? null
      : holds(sheets.current)
        ? currentMonth
        : holds(sheets.next)
          ? nextMonth
          : null
  const month = asked ?? opened ?? fallback.month
  const sheet = month === nextMonth ? sheets.next : sheets.current
  const auto = asked === null && opened === null && fallback.auto

  // Si los sueldos no se pueden leer, la planilla igual se dibuja: su fila lo dice y no suman.
  const payrollOutcome = await settleQuery(getPayrollReport(tenantId, month))
  const payroll = payrollOutcome.ok ? payrollTotals(payrollOutcome.data.employees) : null
  const totals = sheetTotals(sheet, payroll)

  return (
    <SimplePage>
      <h1 className="sr-only">Gastos fijos</h1>
      <PlanillaBar>
        <MonthSeg
          label="Mes de la planilla"
          months={[currentMonth, nextMonth]}
          active={month}
          hrefOf={(m) => gastosFijosHref(tenantSlug, { mes: m })}
        />
        {auto ? (
          <span className="text-sm text-muted-foreground">
            En {monthWord(currentMonth)} no vence ninguno: te muestro {monthWord(nextMonth)}.
          </span>
        ) : null}
        <ReadOnlyBadge className="ml-auto" />
      </PlanillaBar>

      <Totalizer
        items={[
          {
            label: 'Total del mes',
            cents: totals.totalCents,
            hint:
              totals.payrollCents !== null
                ? `Con ${formatCentsShort(totals.payrollCents)} de sueldos`
                : undefined,
          },
          { label: 'Pagado', cents: totals.paidCents, tone: 'ok' },
          {
            label: 'Por pagar',
            cents: totals.pendingCents,
            hint:
              totals.noAmount === 0
                ? undefined
                : totals.noAmount === 1
                  ? '1 sin monto: no suma'
                  : `${totals.noAmount} sin monto: no suman`,
          },
          {
            label: 'Vencido',
            cents: totals.overdueCents,
            tone: (totals.overdueCents ?? 0) > 0 ? 'bad' : 'default',
          },
        ]}
      />

      <VoidedNotice items={sheet.voided} canWrite={canWrite} />

      <SheetView
        sheet={sheet}
        totals={totals}
        payroll={payroll}
        autoTax={autoTax}
        tenantSlug={tenantSlug}
        canWrite={canWrite}
        openId={openId}
        miscAccountId={miscAccountId}
        pasteList={pasteList}
      />
    </SimplePage>
  )
}
