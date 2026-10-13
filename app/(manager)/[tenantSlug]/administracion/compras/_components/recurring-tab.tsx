import { CalendarClock, CircleAlert, CircleCheck, Plus, Repeat, Wallet } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import {
  listAccounts,
  listRecurringExpenses,
  type RecurringExpenseRow,
  settleQuery,
} from '@/lib/accounting/queries'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import {
  installmentLabel,
  needsAction,
  type RecurringLine,
  recurringLine,
  recurringTotals,
} from '@/lib/accounting/recurring-status'
import { formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { isPurchaseImputation } from '../_lib/accounts'
import { comprasHref, documentHref, newPurchaseHref, recurringHref } from '../_lib/links'
import { BlockError } from './block-error'
import { BulkRecurringDialog } from './bulk-recurring-dialog'
import { RecurringActions } from './recurring-actions'

const FREQUENCY_LABELS: Readonly<Record<RecurringExpenseRow['frequency'], string>> = {
  monthly: 'Todos los meses',
  bimonthly: 'Cada 2 meses',
  quarterly: 'Cada 3 meses',
  yearly: 'Una vez por año',
}

/** Un gasto fijo con su renglón de la planilla (cuota, monto, pagado, falta y estado). */
type Item = { row: RecurringExpenseRow; line: RecurringLine }

function Dash() {
  return (
    <span className="text-muted-foreground/60">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Nada</span>
    </span>
  )
}

/** El estado del vencimiento que muestra el renglón, siempre con palabras (nunca solo color). */
function LineStatus({ row, line }: Item) {
  const main = (() => {
    switch (line.state) {
      case 'paid':
        return (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Pago
          </Badge>
        )
      case 'partial':
        return (
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-text">
            Pago parcial
          </Badge>
        )
      case 'unpaid':
        return <Badge variant="outline">Sin pagar</Badge>
      case 'overdue':
        return (
          <Badge
            variant="outline"
            className="border-destructive/30 bg-destructive/10 text-destructive"
          >
            Vencido
          </Badge>
        )
      case 'no_amount':
        return (
          <>
            <Badge variant="muted">Sin monto</Badge>
            {line.pastDue ? (
              <span className="whitespace-nowrap text-xs text-destructive">
                venció el {formatDayMonth(line.dueDate)}
              </span>
            ) : null}
          </>
        )
      case 'upcoming':
        return (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Vence el {formatDayMonth(line.dueDate)}
          </span>
        )
      case 'skipped':
        return <span className="text-xs text-muted-foreground">Salteado</span>
      case 'ended':
        return <Badge variant="muted">Terminó</Badge>
      case 'paused':
        return <Badge variant="muted">Pausado</Badge>
    }
  })()
  return (
    <span className="block space-y-1">
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {main}
        {/* La última cuota ya se cargó: se informa su pago y se avisa que no sigue. */}
        {row.ended && line.state !== 'ended' ? <Badge variant="muted">Terminó</Badge> : null}
      </span>
      {line.priorOpenCents > 0 ? (
        <span className="block text-[11px] text-muted-foreground">
          Debés <Amount cents={line.priorOpenCents} /> de antes
        </span>
      ) : null}
    </span>
  )
}

/**
 * «Proveedor · Todos los meses · 8 renglones de detalle». La cuota y la cuenta
 * se suman acá cuando sus columnas no entran (y siempre en el celular).
 */
function Subtitle({ row, line }: Item) {
  const detail =
    row.breakdown.length === 0
      ? null
      : row.breakdown.length === 1
        ? '1 renglón de detalle'
        : `${row.breakdown.length} renglones de detalle`
  const base = [row.partyName, FREQUENCY_LABELS[row.frequency], detail].filter(Boolean).join(' · ')
  const installment = installmentLabel(line.installment, 'long')
  return (
    <span className="block truncate text-[11px] text-muted-foreground">
      {base}
      {installment ? <span className="@[52rem]:hidden"> · {installment}</span> : null}
      {row.accountName ? <span className="@[84rem]:hidden"> · {row.accountName}</span> : null}
    </span>
  )
}

function sortItems(items: readonly Item[]): Item[] {
  // Primero lo que pide hacer algo (cargar o pagar), por vencimiento; los pausados y terminados al final.
  const weight = ({ line }: Item) =>
    line.state === 'paused' || line.state === 'ended' ? 2 : needsAction(line.state) ? 0 : 1
  const due = ({ row, line }: Item) => line.dueDate ?? row.nextDueDate
  return [...items].sort(
    (a, b) =>
      weight(a) - weight(b) ||
      (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0) ||
      a.row.name.localeCompare(b.row.name, 'es'),
  )
}

/**
 * «Gastos fijos» (H.7), como la planilla de los socios (12/10/2026): por cada
 * uno qué cuota es, cuánto había que pagar, cuánto se pagó, cuánto falta y si
 * está pago, y arriba los tres totales de lo que vence hasta fin de mes. Sigue
 * siendo un recordatorio: no es deuda hasta que se carga la factura.
 */
export async function RecurringTab({
  tenantId,
  tenantSlug,
  today,
  canWrite,
}: {
  tenantId: string
  tenantSlug: string
  today: string
  canWrite: boolean
}) {
  const [outcome, paymentsOutcome, accountsOutcome] = await Promise.all([
    settleQuery(listRecurringExpenses(tenantId, { includeInactive: true, today })),
    settleQuery(listRecurringPayments(tenantId)),
    canWrite ? settleQuery(listAccounts(tenantId)) : null,
  ])
  if (!outcome.ok) return <BlockError message={outcome.message} />
  if (!paymentsOutcome.ok) return <BlockError message={paymentsOutcome.message} />

  // «Cargar una lista»: las cuentas que sirven para un gasto (y sus grupos, para la ruta).
  const catalog = accountsOutcome?.ok ? accountsOutcome.data : []
  const imputable = new Set(catalog.filter(isPurchaseImputation).map((a) => a.id))
  const bulkAccounts = catalog
    .filter((a) => imputable.has(a.id) || !a.postable)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      postable: a.postable && imputable.has(a.id),
      active: a.active,
      description: a.description,
    }))
  const fallbackAccountId =
    catalog.find((a) => a.systemKey === 'misc_expenses' && imputable.has(a.id))?.id ?? null
  const bulk =
    canWrite && accountsOutcome?.ok ? (
      <BulkRecurringDialog
        tenantSlug={tenantSlug}
        today={today}
        accounts={bulkAccounts}
        existingNames={outcome.data.map((r) => r.name)}
        fallbackAccountId={fallbackAccountId}
      />
    ) : null

  const payments = paymentsOutcome.data
  const items = sortItems(
    outcome.data.map((row) => ({ row, line: recurringLine(row, payments.get(row.id), today) })),
  )
  const totals = recurringTotals(items.map((item) => item.line))
  const back = comprasHref(tenantSlug, 'gastos-fijos')
  const loadHref = (row: RecurringExpenseRow) =>
    newPurchaseHref(tenantSlug, { proveedor: row.partyId, gastoFijo: row.id, volver: back })
  const pendingCount = items.filter(({ row }) => row.active && row.monthStatus === 'pending').length

  const intro = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl space-y-1 text-sm text-muted-foreground text-pretty">
        <p>
          No es una deuda hasta que cargás la factura: es un recordatorio para que no se te pase.
          Los que son en cuotas se sacan solos después de la última.
          {pendingCount > 0
            ? ` Este mes te ${pendingCount === 1 ? 'falta cargar 1' : `faltan cargar ${pendingCount}`}.`
            : ''}
        </p>
        {totals.priorOpenCents > 0 ? (
          <p>
            De vencimientos anteriores quedan{' '}
            <Amount cents={totals.priorOpenCents} className="font-medium text-foreground" /> sin
            pagar: están en{' '}
            <Link
              href={comprasHref(tenantSlug)}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Proveedores
            </Link>
            .
          </p>
        ) : null}
      </div>
      {canWrite && items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {bulk}
          <Button asChild className="h-11 gap-2 md:h-9">
            <Link href={recurringHref(tenantSlug, 'nuevo')}>
              <Plus className="size-4" aria-hidden />
              Nuevo gasto fijo
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  )

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="Todavía no hay gastos fijos"
        description="Cargá el alquiler, la luz o internet: te avisamos antes de que venzan y los cargás en un toque. Si tenés la lista, cargala toda de una."
        action={
          canWrite ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild className="h-11 gap-2 md:h-9">
                <Link href={recurringHref(tenantSlug, 'nuevo')}>
                  <Plus className="size-4" aria-hidden />
                  Nuevo gasto fijo
                </Link>
              </Button>
              {bulk}
            </div>
          ) : null
        }
      />
    )
  }

  // Los sin monto vencen este mes pero no suman: se dice cuántos son.
  const noAmountHint =
    totals.noAmountCount > 0
      ? `${totals.noAmountCount} sin monto: no ${totals.noAmountCount === 1 ? 'suma' : 'suman'}`
      : null
  const remainingHint = [
    totals.remainingCents > 0
      ? 'De lo que vence hasta fin de mes'
      : totals.countedRows > 0
        ? 'Lo de este mes está pago'
        : noAmountHint
          ? null
          : 'Este mes no vence ninguno',
    noAmountHint,
  ]
    .filter(Boolean)
    .join(' · ')

  const actionsOf = ({ row, line }: Item) => (
    <RecurringActions
      tenantSlug={tenantSlug}
      id={row.id}
      name={row.name}
      nextDueDate={row.nextDueDate}
      updatedAt={row.updatedAt}
      pending={row.active && row.monthStatus === 'pending'}
      loadHref={row.active ? loadHref(row) : null}
      editHref={recurringHref(tenantSlug, row.id)}
      documentHref={line.documentId ? documentHref(tenantSlug, line.documentId) : null}
    />
  )

  return (
    <div className="space-y-6">
      <section aria-label="Gastos fijos de este mes" className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Wallet}
          iconClassName="text-primary"
          label="Falta pagar"
          value={formatCentsShort(totals.remainingCents)}
          hint={remainingHint}
        />
        <StatCard
          icon={CircleCheck}
          iconClassName="text-success"
          label="Ya pagaste"
          value={formatCentsShort(totals.paidCents)}
          hint={totals.paidCents > 0 ? 'De lo de este mes' : 'Todavía nada este mes'}
        />
        <StatCard
          icon={CircleAlert}
          iconClassName={totals.overdueCents > 0 ? 'text-destructive' : 'text-muted-foreground'}
          label="Vencido"
          value={formatCentsShort(totals.overdueCents)}
          hint={totals.overdueCents > 0 ? 'Ya pasó el vencimiento' : 'Nada vencido'}
        />
      </section>

      <div className="space-y-4">
        {intro}

        {/* Compu y tablet. Las columnas se muestran según el ancho de la tabla
            (@container), como en Proveedores: la cuenta, lo pagado y la cuota
            se van primero (la cuota y la cuenta pasan abajo del nombre). */}
        <DataTableShell className="@container hidden sm:block">
          <DataTableScroll>
            <DataTableRoot>
              <caption className="sr-only">Gastos fijos</caption>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Gasto</DataTableHeader>
                  <DataTableHeader className="hidden @[84rem]:table-cell">Cuenta</DataTableHeader>
                  <DataTableHeader className="hidden @[52rem]:table-cell">Cuota</DataTableHeader>
                  <DataTableHeader className="text-right">Monto</DataTableHeader>
                  <DataTableHeader>Vencimiento</DataTableHeader>
                  <DataTableHeader className="hidden text-right @[68rem]:table-cell">
                    Pagado
                  </DataTableHeader>
                  <DataTableHeader className="text-right">Falta</DataTableHeader>
                  <DataTableHeader>Estado</DataTableHeader>
                  {canWrite ? (
                    <DataTableHeader className="text-right">
                      <span className="sr-only">Acciones</span>
                    </DataTableHeader>
                  ) : null}
                </tr>
              </DataTableHead>
              <DataTableBody>
                {items.map((item) => {
                  const { row, line } = item
                  const cuota = installmentLabel(line.installment)
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint',
                        (line.state === 'paused' || line.state === 'ended') &&
                          'text-muted-foreground',
                      )}
                    >
                      {/* min-w: el nombre no se parte en dos renglones por los importes y botones de al lado. */}
                      <DataTableCell className="min-w-40 max-w-[18rem]">
                        {canWrite ? (
                          <Link
                            href={recurringHref(tenantSlug, row.id)}
                            title={`Editar ${row.name}`}
                            className="block min-w-0 rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="block font-medium">{row.name}</span>
                        )}
                        <Subtitle row={row} line={line} />
                      </DataTableCell>
                      <DataTableCell className="hidden max-w-[220px] text-muted-foreground @[84rem]:table-cell">
                        <span className="block truncate">{row.accountName ?? '—'}</span>
                      </DataTableCell>
                      <DataTableCell className="hidden whitespace-nowrap tabular-nums @[52rem]:table-cell">
                        {cuota ?? <Dash />}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        {line.dueCents === null ? (
                          <span className="text-xs text-muted-foreground">Variable</span>
                        ) : (
                          <Amount cents={line.dueCents} />
                        )}
                      </DataTableCell>
                      <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {line.dueDate ? formatIsoDay(line.dueDate) : <Dash />}
                      </DataTableCell>
                      <DataTableCell className="hidden text-right @[68rem]:table-cell">
                        {line.paidCents ? <Amount cents={line.paidCents} /> : <Dash />}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        {line.remainingCents ? (
                          <Amount
                            cents={line.remainingCents}
                            className={cn(
                              'font-medium',
                              line.state === 'overdue' && 'text-destructive',
                            )}
                          />
                        ) : (
                          <Dash />
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        <LineStatus row={row} line={line} />
                      </DataTableCell>
                      {canWrite ? (
                        <DataTableCell className="text-right">{actionsOf(item)}</DataTableCell>
                      ) : null}
                    </tr>
                  )
                })}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
          <DataTableFooter>
            <span>
              <strong className="tabular-nums text-foreground">
                {plural(items.length, 'gasto fijo', 'gastos fijos')}
              </strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" aria-hidden />
              Hoy es {formatIsoDay(today)}
            </span>
          </DataTableFooter>
        </DataTableShell>

        {/* Celular: tarjetas, con lo mismo que la tabla. «Falta» se dice solo si
            no es todo el monto (un pago parcial); si no, alcanza con el estado. */}
        <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
          <ul aria-label="Gastos fijos" className="divide-y divide-border/60">
            {items.map((item) => {
              const { row, line } = item
              const off = line.state === 'paused' || line.state === 'ended'
              // La fecha, salvo que el estado ya la diga («Vence el…», «venció el…») o esté pago.
              const dueText =
                line.dueDate === null ||
                line.state === 'paid' ||
                line.state === 'upcoming' ||
                line.pastDue
                  ? null
                  : `${line.dueDate < today ? 'Venció' : 'Vence'} ${formatIsoDay(line.dueDate)}`
              return (
                <li key={row.id} className={cn('space-y-2 px-4 py-3', off && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      {canWrite ? (
                        <Link
                          href={recurringHref(tenantSlug, row.id)}
                          className="block truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring active:text-primary"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium">{row.name}</p>
                      )}
                      <Subtitle row={row} line={line} />
                      <LineStatus row={row} line={line} />
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {line.dueCents === null ? (
                        <span className="text-xs text-muted-foreground">Variable</span>
                      ) : (
                        <Amount cents={line.dueCents} block />
                      )}
                      {dueText ? (
                        <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                          {dueText}
                        </span>
                      ) : null}
                      {line.paidCents ? (
                        <span className="mt-0.5 block text-[11px] text-success">
                          Pagado <Amount cents={line.paidCents} />
                        </span>
                      ) : null}
                      {line.paidCents && line.remainingCents ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-[11px]',
                            line.state === 'overdue' ? 'text-destructive' : 'text-warning-text',
                          )}
                        >
                          Falta <Amount cents={line.remainingCents} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {canWrite ? actionsOf(item) : null}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
