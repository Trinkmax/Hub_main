import { CalendarClock, Plus, Repeat } from 'lucide-react'
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
import {
  listRecurringExpenses,
  type RecurringExpenseRow,
  settleQuery,
} from '@/lib/accounting/queries'
import { formatDayMonth, formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { comprasHref, newPurchaseHref, recurringHref } from '../_lib/links'
import { BlockError } from './block-error'
import { RecurringActions } from './recurring-actions'

const FREQUENCY_LABELS: Readonly<Record<RecurringExpenseRow['frequency'], string>> = {
  monthly: 'Todos los meses',
  bimonthly: 'Cada 2 meses',
  quarterly: 'Cada 3 meses',
  yearly: 'Una vez por año',
}

/** «Este mes» de un gasto fijo, siempre con palabras (nunca solo color). */
function MonthStatus({ row }: { row: RecurringExpenseRow }) {
  if (!row.active) return <Badge variant="muted">Pausado</Badge>
  switch (row.monthStatus) {
    case 'loaded':
      return (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
          Cargado
        </Badge>
      )
    case 'skipped':
      return <span className="text-xs text-muted-foreground">Salteado</span>
    case 'upcoming':
      return <span className="text-xs text-muted-foreground">Este mes no vence</span>
    case 'pending': {
      const overdue = row.daysToDue < 0
      const today = row.daysToDue === 0
      const soon = row.daysToDue > 0 && row.daysToDue <= row.remindDaysBefore
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap text-xs',
            overdue
              ? 'text-destructive'
              : today || soon
                ? 'text-warning-text'
                : 'text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              overdue ? 'bg-destructive' : today || soon ? 'bg-warning' : 'bg-muted-foreground/40',
            )}
          />
          {overdue
            ? `Pendiente · venció el ${formatDayMonth(row.nextDueDate)}`
            : today
              ? 'Pendiente · vence hoy'
              : `Pendiente · vence el ${formatDayMonth(row.nextDueDate)}`}
        </span>
      )
    }
  }
}

function sortRows(rows: readonly RecurringExpenseRow[]): RecurringExpenseRow[] {
  // Activos primero (lo pendiente arriba, por vencimiento); los pausados al final.
  const weight = (r: RecurringExpenseRow) => (!r.active ? 2 : r.monthStatus === 'pending' ? 0 : 1)
  return [...rows].sort(
    (a, b) =>
      weight(a) - weight(b) ||
      (a.nextDueDate < b.nextDueDate ? -1 : a.nextDueDate > b.nextDueDate ? 1 : 0) ||
      a.name.localeCompare(b.name, 'es'),
  )
}

/**
 * «Gastos fijos» (H.7): recordatorios con vencimiento (alquiler, luz,
 * internet). No son deuda hasta que se carga la factura.
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
  const outcome = await settleQuery(
    listRecurringExpenses(tenantId, { includeInactive: true, today }),
  )
  if (!outcome.ok) return <BlockError message={outcome.message} />

  const rows = sortRows(outcome.data)
  const back = comprasHref(tenantSlug, 'gastos-fijos')
  const loadHref = (row: RecurringExpenseRow) =>
    newPurchaseHref(tenantSlug, { proveedor: row.partyId, gastoFijo: row.id, volver: back })
  const pendingCount = rows.filter((r) => r.active && r.monthStatus === 'pending').length

  const intro = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-xl text-sm text-muted-foreground text-pretty">
        No es una deuda hasta que cargás la factura: es un recordatorio para que no se te pase.
        {pendingCount > 0
          ? ` Este mes te ${pendingCount === 1 ? 'falta cargar 1' : `faltan cargar ${pendingCount}`}.`
          : ''}
      </p>
      {canWrite && rows.length > 0 ? (
        <Button asChild className="h-11 gap-2 self-start sm:self-auto md:h-9">
          <Link href={recurringHref(tenantSlug, 'nuevo')}>
            <Plus className="size-4" aria-hidden />
            Nuevo gasto fijo
          </Link>
        </Button>
      ) : null}
    </div>
  )

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="Todavía no hay gastos fijos"
        description="Cargá el alquiler, la luz o internet: te avisamos antes de que venzan y los cargás en un toque."
        action={
          canWrite ? (
            <Button asChild className="h-11 gap-2 md:h-9">
              <Link href={recurringHref(tenantSlug, 'nuevo')}>
                <Plus className="size-4" aria-hidden />
                Nuevo gasto fijo
              </Link>
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {intro}

      {/* Compu y tablet */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Gastos fijos</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Gasto</DataTableHeader>
                <DataTableHeader className="hidden lg:table-cell">Cuenta</DataTableHeader>
                <DataTableHeader className="text-right">Monto</DataTableHeader>
                <DataTableHeader className="hidden md:table-cell">
                  Próximo vencimiento
                </DataTableHeader>
                <DataTableHeader>Este mes</DataTableHeader>
                {canWrite ? (
                  <DataTableHeader className="text-right">
                    <span className="sr-only">Acciones</span>
                  </DataTableHeader>
                ) : null}
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint',
                    !row.active && 'text-muted-foreground',
                  )}
                >
                  {/* min-w: el nombre no se parte en dos renglones por los importes y botones de al lado. */}
                  <DataTableCell className="min-w-40">
                    {canWrite ? (
                      <Link
                        href={recurringHref(tenantSlug, row.id)}
                        className="block min-w-0 rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="block font-medium">{row.name}</span>
                    )}
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[row.partyName, FREQUENCY_LABELS[row.frequency]].filter(Boolean).join(' · ')}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="hidden max-w-[220px] text-muted-foreground lg:table-cell">
                    <span className="block truncate">{row.accountName ?? '—'}</span>
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    {row.amountCents === null ? (
                      <span className="text-xs text-muted-foreground">Variable</span>
                    ) : (
                      <span className="whitespace-nowrap">
                        <span className="text-xs text-muted-foreground">aprox. </span>
                        <Amount cents={row.amountCents} />
                      </span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground md:table-cell">
                    {row.active ? formatIsoDay(row.nextDueDate) : '—'}
                  </DataTableCell>
                  <DataTableCell>
                    <MonthStatus row={row} />
                  </DataTableCell>
                  {canWrite ? (
                    <DataTableCell className="text-right">
                      <RecurringActions
                        tenantSlug={tenantSlug}
                        id={row.id}
                        name={row.name}
                        nextDueDate={row.nextDueDate}
                        pending={row.active && row.monthStatus === 'pending'}
                        loadHref={row.active ? loadHref(row) : null}
                        editHref={recurringHref(tenantSlug, row.id)}
                      />
                    </DataTableCell>
                  ) : null}
                </tr>
              ))}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
        <DataTableFooter>
          <span>
            <strong className="tabular-nums text-foreground">
              {plural(rows.length, 'gasto fijo', 'gastos fijos')}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden />
            Hoy es {formatIsoDay(today)}
          </span>
        </DataTableFooter>
      </DataTableShell>

      {/* Celular: tarjetas */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul aria-label="Gastos fijos" className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.id} className={cn('space-y-2 px-4 py-3', !row.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[row.partyName, FREQUENCY_LABELS[row.frequency]].filter(Boolean).join(' · ')}
                  </p>
                  <MonthStatus row={row} />
                </div>
                <div className="shrink-0 text-right text-sm">
                  {row.amountCents === null ? (
                    <span className="text-xs text-muted-foreground">Variable</span>
                  ) : (
                    <Amount cents={row.amountCents} block />
                  )}
                  {row.active ? (
                    <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                      Vence {formatIsoDay(row.nextDueDate)}
                    </span>
                  ) : null}
                </div>
              </div>
              {canWrite ? (
                <RecurringActions
                  tenantSlug={tenantSlug}
                  id={row.id}
                  name={row.name}
                  nextDueDate={row.nextDueDate}
                  pending={row.active && row.monthStatus === 'pending'}
                  loadHref={row.active ? loadHref(row) : null}
                  editHref={recurringHref(tenantSlug, row.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
