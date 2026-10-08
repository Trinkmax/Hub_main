import { ChevronRight, History } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime, formatRange } from '@/lib/dates'
import type { ImportBatchCounts, ImportBatchStatus } from '@/lib/imports/server/types'
import type { ImportSource } from '@/lib/imports/types'
import { IMPORT_SOURCE_COPY, importBatchHref, isUiImportSource } from '@/lib/imports/ui/labels'
import { formatCount } from '@/lib/imports/ui/progress'
import { cn } from '@/lib/utils'
import { BatchStatusBadge } from './status-badge'

/** Una fila del historial (lo de `listImportBatches`, sin `meta`). */
export type HistoryRow = {
  id: string
  source: ImportSource
  origin: 'upload' | 'api'
  fileName: string | null
  periodFrom: string | null
  periodTo: string | null
  status: ImportBatchStatus
  counts: ImportBatchCounts | null
  pending: number
  createdByName: string
  createdAt: string
}

function sourceLabel(source: ImportSource): string {
  return isUiImportSource(source) ? IMPORT_SOURCE_COPY[source].short : 'ARCA (emitidos)'
}

function n(value: number | undefined): string {
  return formatCount(value ?? 0)
}

/**
 * «Historial» del hub (diseño §4.0): cada archivo subido, cuándo, de qué
 * período, cuántas filas, cuántas ya estaban, qué falta y quién lo subió. En
 * la compu es una tabla; en el celular, tarjetas. La primera celda lleva a la
 * revisión. Server-safe (la contadora lo ve igual, sin botones).
 */
export function ImportHistory({
  slug,
  rows,
  olderHref,
  newestHref,
}: {
  slug: string
  rows: HistoryRow[]
  /** Siguiente página (más viejas), si hay. */
  olderHref: string | null
  /** Volver a las más nuevas, si no estamos en la primera página. */
  newestHref: string | null
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={newestHref ? 'No hay importaciones más viejas' : 'Todavía no importaste nada'}
        description={
          newestHref
            ? 'Ya viste todo el historial.'
            : 'Cuando subas un archivo de ARCA, Mercado Pago o el banco, lo vas a ver acá.'
        }
        action={
          newestHref ? (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={newestHref}>Ver las más nuevas</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Compu: tabla. */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <DataTableHead>
              <tr>
                <DataTableHeader>Fecha</DataTableHeader>
                <DataTableHeader>Origen</DataTableHeader>
                <DataTableHeader>Período</DataTableHeader>
                <DataTableHeader className="text-right">Filas</DataTableHeader>
                {/* «Repetidas» y «Quién», solo con lugar: a 1280 con el menú abierto la tabla se salía
                    por la derecha y «Estado» quedaba escondido. «Repetidas» (filas que ya estaban
                    en otra importación) no es «Ya estaban cargados» de la revisión. */}
                <DataTableHeader className="hidden text-right 2xl:table-cell">
                  Repetidas
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
                      className="font-medium underline-offset-2 hover:underline"
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
                    {sourceLabel(r.source)}
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
                    <BatchStatusBadge status={r.status} />
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
          <Pager olderHref={olderHref} newestHref={newestHref} />
        </DataTableFooter>
      </DataTableShell>

      {/* Celular: tarjetas. */}
      <ul className="card-hairline divide-y divide-border/60 rounded-xl border bg-card sm:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={importBatchHref(slug, r.id)}
              className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-cream-tint"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {sourceLabel(r.source)} · {formatDateTime(r.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.periodFrom && r.periodTo ? `${formatRange(r.periodFrom, r.periodTo)} · ` : ''}
                  {n(r.counts?.items)} filas · {n(r.counts?.posted)} cargados
                  {r.pending > 0 ? ` · ${n(r.pending)} pendientes` : ''}
                </p>
                <BatchStatusBadge status={r.status} />
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="sm:hidden">
        <Pager olderHref={olderHref} newestHref={newestHref} />
      </div>
    </div>
  )
}

function Pager({ olderHref, newestHref }: { olderHref: string | null; newestHref: string | null }) {
  if (!olderHref && !newestHref) return null
  return (
    <nav aria-label="Más importaciones" className="flex items-center gap-2">
      {newestHref ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href={newestHref} scroll={false}>
            Más nuevas
          </Link>
        </Button>
      ) : null}
      {olderHref ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href={olderHref} scroll={false}>
            Más viejas
          </Link>
        </Button>
      ) : null}
    </nav>
  )
}
