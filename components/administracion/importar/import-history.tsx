import Link from 'next/link'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { formatDateTime, formatRange } from '@/lib/dates'
import { importBatchHref } from '@/lib/imports/ui/labels'
import { formatCount } from '@/lib/imports/ui/progress'
import { cn } from '@/lib/utils'
import {
  HistoryEmpty,
  HistoryList,
  HistoryPager,
  type HistoryRow,
  historySourceLabel,
} from './inbox/history-list'
import { BatchStatusPill } from './status-badge'

export type { HistoryRow }

function n(value: number | undefined): string {
  return formatCount(value ?? 0)
}

/**
 * «Todo lo que subiste» para quien solo lee (la contadora): la tabla densa, con
 * los títulos en castellano (Subido · Origen · Período · Renglones del archivo ·
 * Cargados · Pendientes · Estado). La primera celda lleva a la revisión, y no
 * hay ningún botón. En el celular usa la misma lista con margen que ve el dueño
 * (una tabla de siete columnas no entra).
 *
 * El dueño ve `HistoryList` en todos los anchos. Server-safe.
 */
export function ImportHistory({
  slug,
  rows,
  today,
  olderHref,
  newestHref,
}: {
  slug: string
  rows: readonly HistoryRow[]
  today: string
  /** Siguiente página (más viejos), si hay. */
  olderHref: string | null
  /** Volver a los más nuevos, si no estamos en la primera página. */
  newestHref: string | null
}) {
  if (rows.length === 0) return <HistoryEmpty newestHref={newestHref} reader />

  return (
    <div className="space-y-3">
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <DataTableHead>
              <tr>
                <DataTableHeader>Subido</DataTableHeader>
                <DataTableHeader>Origen</DataTableHeader>
                <DataTableHeader>Período</DataTableHeader>
                <DataTableHeader className="text-right">Renglones del archivo</DataTableHeader>
                {/* «Repetidos en otro archivo» y «Quién», solo con lugar: a 1280 con el menú
                    abierto la tabla se salía por la derecha y «Estado» quedaba escondido. */}
                <DataTableHeader className="hidden text-right 2xl:table-cell">
                  Repetidos en otro archivo
                </DataTableHeader>
                <DataTableHeader className="text-right">Cargados</DataTableHeader>
                <DataTableHeader className="text-right">Pendientes</DataTableHeader>
                <DataTableHeader>Estado</DataTableHeader>
                <DataTableHeader className="hidden 2xl:table-cell">Quién</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((r) => (
                <DataTableRow key={r.id}>
                  <DataTableCell className="whitespace-nowrap">
                    <Link
                      href={importBatchHref(slug, r.id)}
                      className="rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {formatDateTime(r.createdAt)}
                    </Link>
                    {r.fileName ? (
                      <span
                        className="block max-w-44 truncate text-xs text-muted-foreground"
                        title={r.fileName}
                      >
                        {r.fileName}
                      </span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap">
                    {historySourceLabel(r.source)}
                    {r.origin === 'api' ? (
                      <span className="block text-xs text-muted-foreground">Automática</span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap text-muted-foreground">
                    {r.periodFrom && r.periodTo ? formatRange(r.periodFrom, r.periodTo) : '—'}
                  </DataTableCell>
                  <DataTableCell className="text-right tabular-nums">
                    {n(r.counts?.items)}
                  </DataTableCell>
                  <DataTableCell className="hidden text-right tabular-nums text-muted-foreground 2xl:table-cell">
                    {n(r.counts?.duplicate)}
                  </DataTableCell>
                  <DataTableCell className="text-right tabular-nums">
                    {n(r.counts?.posted)}
                  </DataTableCell>
                  <DataTableCell
                    className={cn(
                      'text-right tabular-nums',
                      r.pending > 0 && 'font-medium text-warning-text',
                    )}
                  >
                    {n(r.pending)}
                  </DataTableCell>
                  <DataTableCell>
                    <BatchStatusPill batch={r} />
                  </DataTableCell>
                  <DataTableCell className="hidden max-w-40 truncate text-muted-foreground 2xl:table-cell">
                    {r.createdByName || '—'}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
        <DataTableFooter>
          <span>Mostrando {rows.length}</span>
          <HistoryPager olderHref={olderHref} newestHref={newestHref} />
        </DataTableFooter>
      </DataTableShell>

      <div className="space-y-3 sm:hidden">
        <HistoryList slug={slug} rows={rows} today={today} />
        <HistoryPager olderHref={olderHref} newestHref={newestHref} />
      </div>
    </div>
  )
}
