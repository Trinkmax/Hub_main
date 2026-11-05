import Link from 'next/link'
import { Fragment } from 'react'
import { StatusPill } from '@/components/administracion/kit'
import { PRow, PTable, PTd, PTh } from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/dates'
import type { ImportBatchCounts, ImportBatchStatus } from '@/lib/imports/server/types'
import type { ImportSource } from '@/lib/imports/types'
import { batchPeriodLabel, batchWaiting, displayBatchStatus } from '@/lib/imports/ui/inbox'
import { IMPORT_SOURCE_COPY, importBatchHref, isUiImportSource } from '@/lib/imports/ui/labels'
import { count } from '@/lib/imports/ui/progress'

/** Un archivo del historial (lo de `listImportBatches`, sin `meta`). */
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

export function historySourceLabel(source: ImportSource): string {
  return isUiImportSource(source) ? IMPORT_SOURCE_COPY[source].short : 'ARCA (emitidos)'
}

/**
 * Qué pasó con lo que trajo el archivo, tramo por tramo: «18 cargados», «3 con
 * una pregunta», «2 no se cargan». Lo que espera se dice con las mismas palabras que
 * la hoja de la bandeja («3 con una pregunta», «5 listos»): es el mismo archivo.
 */
export function historyCountParts(
  row: Pick<HistoryRow, 'counts' | 'pending' | 'status'>,
): string[] {
  const c = row.counts
  if (!c) return [row.status === 'staging' ? 'Sin terminar de subir' : 'Sin detalle']
  const out = c.skipped + c.voided
  const { questions, ready } = row.pending > 0 ? batchWaiting(row) : { questions: 0, ready: 0 }
  const parts = [
    c.posted > 0 ? count(c.posted, 'cargado', 'cargados') : null,
    questions > 0 ? `${questions} con una pregunta` : null,
    ready > 0 ? count(ready, 'listo', 'listos') : null,
    out > 0 ? (out === 1 ? '1 no se carga' : `${out} no se cargan`) : null,
  ].filter((part): part is string => part !== null)
  if (parts.length > 0) return parts
  return [c.items > 0 ? count(c.items, 'renglón', 'renglones') : 'Sin renglones']
}

/** «18 cargados · 3 con una pregunta · 2 no se cargan», en una sola línea. */
export function historyCounts(row: Pick<HistoryRow, 'counts' | 'pending' | 'status'>): string {
  return historyCountParts(row).join(' · ')
}

/**
 * «Historial»: cada archivo en un renglón, del más nuevo al más viejo, con de dónde vino, de qué
 * período es y qué pasó con lo que traía. La fecha lleva a su revisión. Es la misma tabla para el
 * dueño y para la contadora: no tiene nada para cargar. Server-safe.
 */
export function HistoryTable({
  slug,
  rows,
  today,
}: {
  slug: string
  rows: readonly HistoryRow[]
  /** Hoy en Córdoba: los períodos de otro año llevan el año. */
  today: string
}) {
  return (
    <PTable label="Archivos subidos, del más nuevo al más viejo" minWidth={720}>
      <thead>
        <tr>
          <PTh>Subido</PTh>
          <PTh>Origen</PTh>
          <PTh>Período</PTh>
          <PTh>Qué pasó</PTh>
          <PTh>Estado</PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const shown = displayBatchStatus(row)
          return (
            <PRow
              key={row.id}
              className={shown.key === 'cancelled' ? 'text-muted-foreground' : undefined}
            >
              <PTd className="whitespace-nowrap">
                <Link
                  href={importBatchHref(slug, row.id)}
                  className="rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {formatDateTime(row.createdAt)}
                </Link>
                {row.createdByName ? (
                  <span className="block text-xs text-muted-foreground">{row.createdByName}</span>
                ) : null}
              </PTd>
              <PTd className="whitespace-nowrap">
                {historySourceLabel(row.source)}
                {row.origin === 'api' ? ' · automática' : ''}
                {row.fileName ? (
                  <span
                    className="block max-w-44 truncate text-xs text-muted-foreground"
                    title={row.fileName}
                  >
                    {row.fileName}
                  </span>
                ) : null}
              </PTd>
              <PTd className="whitespace-nowrap">{batchPeriodLabel(row, today)}</PTd>
              <PTd className="text-muted-foreground">
                {/* Cada tramo va entero: «4 no se cargan» nunca se parte en «4 / no se cargan». */}
                {historyCountParts(row).map((part, index) => (
                  <Fragment key={part}>
                    {index > 0 ? '\u00A0· ' : null}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))}
              </PTd>
              <PTd className="whitespace-nowrap">
                <span title={shown.hint}>
                  <StatusPill tone={shown.tone}>{shown.label}</StatusPill>
                </span>
              </PTd>
            </PRow>
          )
        })}
      </tbody>
    </PTable>
  )
}

/** «Más nuevos» / «Más viejos» (misma paginación de siempre, por `?antes=`). */
export function HistoryPager({
  olderHref,
  newestHref,
}: {
  olderHref: string | null
  newestHref: string | null
}) {
  if (!olderHref && !newestHref) return null
  return (
    <nav aria-label="Más archivos" className="flex items-center gap-2">
      {newestHref ? (
        <Button asChild variant="outline" size="sm">
          <Link href={newestHref} scroll={false}>
            Más nuevos
          </Link>
        </Button>
      ) : null}
      {olderHref ? (
        <Button asChild variant="outline" size="sm">
          <Link href={olderHref} scroll={false}>
            Más viejos
          </Link>
        </Button>
      ) : null}
    </nav>
  )
}

/** El historial sin archivos: la primera vez, o el final del paginado. Adentro de la misma hoja. */
export function HistoryEmpty({
  newestHref,
  reader = false,
}: {
  newestHref: string | null
  /** Quien solo lee: no se le habla de «subir». */
  reader?: boolean
}) {
  return (
    <div className="grid justify-items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground">
      <p className="text-pretty">
        {newestHref
          ? 'No hay archivos más viejos.'
          : reader
            ? 'Todavía no se subió ningún archivo.'
            : 'Todavía no subiste ningún archivo.'}
      </p>
      {newestHref ? (
        <Button asChild variant="outline" size="sm">
          <Link href={newestHref} scroll={false}>
            Ver los más nuevos
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
