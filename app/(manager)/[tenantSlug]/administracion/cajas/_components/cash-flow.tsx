import { Fragment } from 'react'
import { Amount } from '@/components/administracion/amount'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  CASH_FLOW_CATEGORIES,
  type CashFlowRow,
  type CashProjectionRow,
} from '@/lib/accounting/queries/treasury'
import { formatDayMonth, formatMonthLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'

type MonthGroup = {
  month: string
  rows: CashFlowRow[]
  inflowCents: number
  outflowCents: number
  netCents: number
}

function categoryOrder(category: string): number {
  const index = (CASH_FLOW_CATEGORIES as readonly string[]).indexOf(category)
  return index === -1 ? CASH_FLOW_CATEGORIES.length : index
}

/** Las filas del reporte agrupadas por mes (en orden) y por categoría (en el orden de F.9). */
function groupByMonth(rows: readonly CashFlowRow[]): MonthGroup[] {
  const byMonth = new Map<string, CashFlowRow[]>()
  for (const row of rows) {
    if (row.inflowCents === 0 && row.outflowCents === 0) continue
    const list = byMonth.get(row.month) ?? []
    list.push(row)
    byMonth.set(row.month, list)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const sorted = [...list].sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category))
      const inflowCents = sorted.reduce((acc, r) => acc + r.inflowCents, 0)
      const outflowCents = sorted.reduce((acc, r) => acc + r.outflowCents, 0)
      return {
        month,
        rows: sorted,
        inflowCents,
        outflowCents,
        netCents: inflowCents - outflowCents,
      }
    })
}

/** Una barra chica para el neto (proporcional al más grande del período). La cifra va al lado. */
function NetBar({ cents, max }: { cents: number; max: number }) {
  const width = max > 0 ? Math.max(2, Math.round((Math.abs(cents) / max) * 100)) : 0
  if (cents === 0 || width === 0) return null
  return (
    <span aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
      <span
        className={cn('h-full rounded-full', cents > 0 ? 'bg-success/70' : 'bg-destructive/60')}
        style={{ width: `${width}%` }}
      />
    </span>
  )
}

/**
 * Flujo de caja (H.11, F.9): lo que entró y salió de las cajas por mes y por
 * categoría, con una barra chica para el neto. Los movimientos entre cajas no
 * cuentan (se compensan).
 */
export function CashFlow({
  rows,
  label,
  exportHref,
  exportFileName,
}: {
  rows: readonly CashFlowRow[]
  /** «Agosto – octubre 2026». */
  label: string
  exportHref: string
  exportFileName: string
}) {
  const groups = groupByMonth(rows)
  const max = Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => Math.abs(r.netCents))))
  const total = groups.reduce(
    (acc, g) => ({
      inflowCents: acc.inflowCents + g.inflowCents,
      outflowCents: acc.outflowCents + g.outflowCents,
    }),
    { inflowCents: 0, outflowCents: 0 },
  )

  return (
    <DataTableShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">Flujo de caja</h2>
          <p className="text-xs text-muted-foreground">
            {label} · Lo que entró y salió de las cajas, por categoría. Mover plata entre cajas no
            cuenta.
          </p>
        </div>
        <ExportButton
          href={exportHref}
          fileName={exportFileName}
          size="sm"
          className="h-11 md:h-8"
        />
      </header>
      {groups.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          No entró ni salió plata de las cajas en este período.
        </p>
      ) : (
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Flujo de caja por mes y categoría, {label}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Categoría</DataTableHeader>
                <DataTableHeader className="text-right">Entró</DataTableHeader>
                <DataTableHeader className="text-right">Salió</DataTableHeader>
                <DataTableHeader className="text-right">Neto</DataTableHeader>
                <DataTableHeader className="hidden w-32 sm:table-cell">
                  <span className="sr-only">Proporción</span>
                </DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {groups.map((g) => (
                <Fragment key={g.month}>
                  <tr className="bg-secondary/20">
                    <th
                      scope="colgroup"
                      colSpan={5}
                      className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {formatMonthLabel(g.month)}
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr
                      key={`${g.month}-${r.category}`}
                      className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                    >
                      <DataTableCell>{r.categoryLabel}</DataTableCell>
                      <DataTableCell className="text-right">
                        {r.inflowCents > 0 ? <Amount cents={r.inflowCents} /> : null}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        {r.outflowCents > 0 ? <Amount cents={r.outflowCents} /> : null}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <Amount cents={r.netCents} sign="always" tone="auto" />
                      </DataTableCell>
                      <DataTableCell className="hidden sm:table-cell">
                        <NetBar cents={r.netCents} max={max} />
                      </DataTableCell>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <DataTableCell className="text-xs">
                      Total {formatMonthLabel(g.month).toLowerCase()}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={g.inflowCents} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={g.outflowCents} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={g.netCents} sign="always" />
                    </DataTableCell>
                    <DataTableCell className="hidden sm:table-cell">{null}</DataTableCell>
                  </tr>
                </Fragment>
              ))}
            </DataTableBody>
            {groups.length > 1 ? (
              <tfoot className="bg-secondary/30 font-semibold">
                <tr className="border-t border-border">
                  <DataTableCell className="text-xs">Total del período</DataTableCell>
                  <DataTableCell className="text-right">
                    <Amount cents={total.inflowCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Amount cents={total.outflowCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Amount cents={total.inflowCents - total.outflowCents} sign="always" />
                  </DataTableCell>
                  <DataTableCell className="hidden sm:table-cell">{null}</DataTableCell>
                </tr>
              </tfoot>
            ) : null}
          </DataTableRoot>
        </DataTableScroll>
      )}
    </DataTableShell>
  )
}

/** La proyección de las próximas semanas (F.9, si la base ya la tiene). */
export function CashProjection({ rows }: { rows: readonly CashProjectionRow[] }) {
  return (
    <DataTableShell>
      <header className="border-b border-border/60 px-5 py-4">
        <h2 className="font-serif text-lg font-semibold tracking-tight">Próximas semanas</h2>
        <p className="text-xs text-muted-foreground">
          Estimado: lo que te deben y lo que debés según sus vencimientos, más los gastos fijos.
        </p>
      </header>
      <DataTableScroll>
        <DataTableRoot>
          <caption className="sr-only">Proyección de las próximas semanas</caption>
          <DataTableHead>
            <tr>
              <DataTableHeader>Semana</DataTableHeader>
              <DataTableHeader className="text-right">Entra</DataTableHeader>
              <DataTableHeader className="text-right">Sale</DataTableHeader>
              <DataTableHeader className="text-right">Saldo proyectado</DataTableHeader>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {rows.map((r) => (
              <tr key={r.weekStart}>
                <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  Desde el {formatDayMonth(r.weekStart)}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={r.inCents} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={r.outCents} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={r.projectedBalanceCents} balance="treasury" tone="auto" />
                </DataTableCell>
              </tr>
            ))}
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
    </DataTableShell>
  )
}
