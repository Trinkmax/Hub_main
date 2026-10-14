import { Plus } from 'lucide-react'
import Link from 'next/link'
import {
  AdmHeader,
  AdmPage,
  PanelError,
  StatusPill,
  type ViewPillItem,
  ViewPills,
} from '@/components/administracion/kit'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { listAccounts, listRecurringExpenses, settleQuery } from '@/lib/accounting/queries'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import {
  addMonthsToYearMonth,
  formatDayMonth,
  monthOf,
  todayInCordoba,
  weekdayName,
} from '@/lib/dates'
import { BulkRecurringDialog } from '../compras/_components/bulk-recurring-dialog'
import { isPurchaseImputation } from '../compras/_lib/accounts'
import { firstParam, gastosFijosHref, isUuidLike, recurringHref } from '../compras/_lib/links'
import { requireComprasAccess } from '../compras/_lib/page-access'
import { SheetView } from './_components/sheet'
import { SheetCharts } from './_components/sheet-charts'
import { SheetEmpty } from './_components/sheet-empty'
import { buildSheet, defaultSheetMonth, parseSheetMonth } from './_lib/planilla'
import {
  monthTitle,
  monthWord,
  parseInvoiceBucket,
  parseSheetFilter,
  type Sheet,
} from './_lib/planilla-words'

export const metadata = { title: 'Gastos fijos' }

/** «Octubre, este mes: 3 por pagar», para quien no ve la pastilla. */
function monthAria(sheet: Sheet): string {
  const which = sheet.isCurrent ? 'este mes' : 'el mes que viene'
  const left = sheet.counts.falta
  return `${monthTitle(sheet.month)}, ${which}: ${left === 0 ? 'nada por pagar' : `${left} por pagar`}`
}

/**
 * Gastos fijos: la planilla de todos los meses, viva. Una sola hoja con el
 * número que manda («Te falta de gasto fijo», el mismo del Resumen), los
 * renglones colgados del día en que vencen y la fila de suma. Se paga y se
 * escribe en el renglón; el alta y la ficha completa siguen en
 * `/compras/gastos-fijos/[id]` y los montos de corrido, en `./completar`.
 *
 * La misma puerta que Compras: leen los dueños con acceso y la contadora, y
 * solo a quien carga se le dibujan los controles que escriben.
 *
 * El estado vive en la URL: `?mes=` (el de hoy o el que viene), `?ver=`,
 * `?categoria=`, `?factura=` y `?abrir=<uuid>` (el renglón que entra abierto).
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

  const header = (
    <AdmHeader
      title="Gastos fijos"
      description="Tu planilla de todos los meses: qué vence, qué pagaste y cuánto te falta."
      badge={<ReadOnlyBadge className="ml-0" />}
    />
  )

  const [rowsOutcome, paymentsOutcome, accountsOutcome] = await Promise.all([
    settleQuery(listRecurringExpenses(tenantId, { includeInactive: true, today })),
    settleQuery(listRecurringPayments(tenantId)),
    canWrite ? settleQuery(listAccounts(tenantId)) : null,
  ])

  // Sin los pagos no se dibuja la hoja: un pagado que se ve «sin pagar» invita a pagar dos veces.
  if (!rowsOutcome.ok || !paymentsOutcome.ok) {
    const message = !rowsOutcome.ok
      ? rowsOutcome.message
      : !paymentsOutcome.ok
        ? paymentsOutcome.message
        : ''
    return (
      <AdmPage>
        {header}
        <PanelError title="La planilla del mes" message={message} />
      </AdmPage>
    )
  }

  const rows = rowsOutcome.data
  const payments = paymentsOutcome.data

  // «Pegar una lista»: las cuentas que sirven para un gasto (y sus grupos, para la ruta).
  const catalog = accountsOutcome?.ok ? accountsOutcome.data : []
  const imputable = new Set(catalog.filter(isPurchaseImputation).map((a) => a.id))
  const miscAccountId = catalog.find((a) => a.systemKey === 'misc_expenses')?.id ?? null
  const pasteList = (trigger: 'link' | 'primary') =>
    canWrite && accountsOutcome?.ok ? (
      <BulkRecurringDialog
        tenantSlug={tenantSlug}
        today={today}
        trigger={trigger}
        accounts={catalog
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

  if (rows.length === 0) {
    return (
      <AdmPage>
        {header}
        <SheetEmpty
          canWrite={canWrite}
          pasteList={pasteList('primary')}
          addOne={
            <Button asChild variant="outline" className="h-11 gap-2">
              <Link href={recurringHref(tenantSlug, 'nuevo')}>
                <Plus aria-hidden className="size-4" />
                Cargar uno
              </Link>
            </Button>
          }
        />
        <QuickActionsBar />
      </AdmPage>
    )
  }

  const currentMonth = monthOf(today)
  const nextMonth = addMonthsToYearMonth(currentMonth, 1)
  const build = (month: string) =>
    buildSheet(rows, payments, { month, today, miscAccountId, canWrite })
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

  const categoryRaw = firstParam(sp.categoria)
  const query = {
    ver: parseSheetFilter(firstParam(sp.ver)),
    categoria: isUuidLike(categoryRaw) ? categoryRaw : null,
    factura: parseInvoiceBucket(firstParam(sp.factura)),
  }

  const monthPills: ViewPillItem[] = [sheets.current, sheets.next].map((s) => ({
    key: s.month,
    label: monthTitle(s.month),
    href: gastosFijosHref(tenantSlug, { mes: s.month }),
    count: s.counts.falta > 0 ? s.counts.falta : undefined,
    active: s.month === month,
    ariaLabel: monthAria(s),
    scroll: false,
  }))

  return (
    <AdmPage>
      {header}

      <div className="space-y-2">
        <ViewPills
          label="Mes de la planilla"
          items={monthPills}
          aside={
            <>
              {sheet.isCurrent ? null : <StatusPill tone="info">Todavía no empezó</StatusPill>}
              <span className="text-sm text-muted-foreground">
                Hoy es {weekdayName(today)} {formatDayMonth(today)}
              </span>
            </>
          }
        />
        {auto ? (
          <p className="text-sm text-muted-foreground">
            En {monthWord(currentMonth)} no vence ninguno: te muestro {monthWord(nextMonth)}.
          </p>
        ) : null}
      </div>

      <SheetView
        sheet={sheet}
        tenantSlug={tenantSlug}
        canWrite={canWrite}
        query={query}
        openId={openId}
        miscAccountId={miscAccountId}
        pasteList={pasteList('link')}
      />

      <SheetCharts sheet={sheet} tenantSlug={tenantSlug} />

      <QuickActionsBar />
    </AdmPage>
  )
}
