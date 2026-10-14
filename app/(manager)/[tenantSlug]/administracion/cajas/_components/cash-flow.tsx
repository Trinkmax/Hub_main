import { Fragment } from 'react'
import { Amount } from '@/components/administracion/amount'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
} from '@/components/ui/data-table'
import { CASH_FLOW_CATEGORIES, type CashFlowRow } from '@/lib/accounting/queries/treasury'
import { formatMonthLabel } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { flowCategoryLabel } from '../_lib/flow-view'

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

/** «Entró $ X · Salió $ Y» (sin la parte que es cero), para la lista del celular. */
function flowDetail(inCents: number, outCents: number): string {
  return [
    inCents > 0 ? `Entró ${formatCents(inCents)}` : null,
    outCents > 0 ? `Salió ${formatCents(outCents)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * «Entró y salió» EN TABLA: lo que entró y salió de las cajas por mes y por
 * categoría, al centavo, con sus totales. Es lo que se ve con «Ver como tabla»
 * (y lo primero que ve la contadora). El dibujo, el título y la oración los
 * pone `FlowChartBlock`; los movimientos entre cajas no cuentan (se compensan).
 */
export function CashFlow({
  rows,
  label,
}: {
  rows: readonly CashFlowRow[]
  /** «Agosto – octubre 2026». */
  label: string
}) {
  const groups = groupByMonth(rows)
  const total = groups.reduce(
    (acc, g) => ({
      inflowCents: acc.inflowCents + g.inflowCents,
      outflowCents: acc.outflowCents + g.outflowCents,
    }),
    { inflowCents: 0, outflowCents: 0 },
  )
  const name = (r: CashFlowRow) => flowCategoryLabel(r.category, r.categoryLabel)

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      {/* Compu y tablet: la tabla por mes y categoría. */}
      <div className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Lo que entró y salió por mes y categoría, {label}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Categoría</DataTableHeader>
                <DataTableHeader className="text-right">Entró</DataTableHeader>
                <DataTableHeader className="text-right">Salió</DataTableHeader>
                <DataTableHeader className="text-right">Diferencia</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {groups.map((g) => (
                <Fragment key={g.month}>
                  <tr className="bg-secondary/20">
                    <th
                      scope="colgroup"
                      colSpan={4}
                      className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {formatMonthLabel(g.month)}
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr
                      key={`${g.month}-${r.category}`}
                      className="transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-cream-tint"
                    >
                      <DataTableCell>{name(r)}</DataTableCell>
                      <DataTableCell className="text-right">
                        {r.inflowCents > 0 ? <Amount cents={r.inflowCents} /> : null}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        {r.outflowCents > 0 ? <Amount cents={r.outflowCents} /> : null}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <Amount cents={r.netCents} sign="always" tone="auto" />
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
                </tr>
              </tfoot>
            ) : null}
          </DataTableRoot>
        </DataTableScroll>
      </div>

      {/* Celular: cada categoría con su diferencia; lo que entró y salió, debajo (la tabla no entra). */}
      <div className="sm:hidden">
        {groups.map((g) => (
          <section key={g.month} aria-label={formatMonthLabel(g.month)}>
            <h3 className="border-b border-border/60 bg-secondary/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {formatMonthLabel(g.month)}
            </h3>
            <ul className="divide-y divide-border/60">
              {g.rows.map((r) => (
                <li
                  key={`${g.month}-${r.category}`}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm">{name(r)}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {flowDetail(r.inflowCents, r.outflowCents)}
                    </span>
                  </span>
                  <Amount
                    cents={r.netCents}
                    sign="always"
                    tone="auto"
                    className="shrink-0 text-sm font-medium"
                  />
                </li>
              ))}
              <li className="flex items-start justify-between gap-3 bg-secondary/30 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    Total {formatMonthLabel(g.month).toLowerCase()}
                  </span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    Entró {formatCents(g.inflowCents)} · Salió {formatCents(g.outflowCents)}
                  </span>
                </span>
                <Amount
                  cents={g.netCents}
                  sign="always"
                  className="shrink-0 text-sm font-semibold"
                />
              </li>
            </ul>
          </section>
        ))}
        {groups.length > 1 ? (
          <div className="flex items-start justify-between gap-3 border-t border-border bg-secondary/30 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Total del período</span>
              <span className="block text-xs tabular-nums text-muted-foreground">
                Entró {formatCents(total.inflowCents)} · Salió {formatCents(total.outflowCents)}
              </span>
            </span>
            <Amount
              cents={total.inflowCents - total.outflowCents}
              sign="always"
              className="shrink-0 text-sm font-semibold"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
