import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import {
  EmptyTeach,
  LedgerList,
  LedgerRail,
  LedgerRow,
  StatusPill,
} from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import {
  isoDayInCordoba,
  isRealIsoDay,
  MONTH_NAMES_SHORT,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'
import type { ImportBatchCounts, ImportBatchStatus } from '@/lib/imports/server/types'
import type { ImportSource } from '@/lib/imports/types'
import { batchPeriodLabel, displayBatchStatus } from '@/lib/imports/ui/inbox'
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

/** «18 cargados · 3 para revisar · 2 no van»: qué pasó con lo que trajo el archivo. */
export function historyCounts(row: Pick<HistoryRow, 'counts' | 'pending' | 'status'>): string {
  const c = row.counts
  if (!c) return row.status === 'staging' ? 'Sin terminar de subir' : 'Sin detalle'
  const out = c.skipped + c.voided
  const parts = [
    c.posted > 0 ? count(c.posted, 'cargado', 'cargados') : null,
    row.pending > 0 ? `${row.pending} para revisar` : null,
    out > 0 ? (out === 1 ? '1 no va' : `${out} no van`) : null,
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  return c.items > 0 ? count(c.items, 'renglón', 'renglones') : 'Sin renglones'
}

/**
 * «Todo lo que subiste»: cada archivo en un renglón con margen (el día en que
 * se subió), el período como título, de dónde vino y qué pasó con lo que traía.
 * Todo el renglón lleva a su revisión.
 *
 * Reemplaza a la tabla «Filas · Repetidas · Cargados · Pendientes», que hablaba
 * en palabras de sistema. La tabla densa queda para la contadora
 * (`ImportHistory`), que en el celular también usa esta lista. Server-safe.
 */
export function HistoryList({
  slug,
  rows,
  today,
  bare = true,
}: {
  slug: string
  rows: readonly HistoryRow[]
  /** Hoy en Córdoba: los períodos de otro año llevan el año. */
  today: string
  /** Sin superficie propia (para ir adentro de un `Panel`). */
  bare?: boolean
}) {
  return (
    <LedgerList aria-label="Archivos subidos, del más nuevo al más viejo" bare={bare}>
      {rows.map((row) => {
        const day = isoDayInCordoba(row.createdAt) ?? row.createdAt.slice(0, 10)
        const real = isRealIsoDay(day)
        const shown = displayBatchStatus(row)
        return (
          <LedgerRow
            key={row.id}
            href={importBatchHref(slug, row.id)}
            rail={
              real ? (
                <LedgerRail
                  label={MONTH_NAMES_SHORT[Number(day.slice(5, 7)) - 1]}
                  value={day.slice(8, 10)}
                  unit={WEEKDAY_NAMES_SHORT[weekdayOf(day)]}
                />
              ) : undefined
            }
            title={batchPeriodLabel(row, today)}
            muted={shown.key === 'cancelled'}
            meta={
              <>
                <span className="block truncate" title={row.fileName ?? undefined}>
                  {historySourceLabel(row.source)}
                  {row.origin === 'api' ? ' · automática' : ''}
                  {row.fileName ? ` · ${row.fileName}` : ''}
                  {row.createdByName ? ` · lo subió ${row.createdByName}` : ''}
                </span>
                <span className="block">{historyCounts(row)}</span>
              </>
            }
            amount={
              <span className="inline-flex items-center gap-1.5" title={shown.hint}>
                <StatusPill tone={shown.tone}>{shown.label}</StatusPill>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </span>
            }
          />
        )
      })}
    </LedgerList>
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
        <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-9">
          <Link href={newestHref} scroll={false}>
            Más nuevos
          </Link>
        </Button>
      ) : null}
      {olderHref ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-9">
          <Link href={olderHref} scroll={false}>
            Más viejos
          </Link>
        </Button>
      ) : null}
    </nav>
  )
}

/** El historial sin archivos: la primera vez, o el final del paginado. */
export function HistoryEmpty({
  newestHref,
  reader = false,
}: {
  newestHref: string | null
  /** Quien solo lee: no se le habla de «subir». */
  reader?: boolean
}) {
  if (newestHref) {
    return (
      <EmptyTeach
        plain
        title="No hay archivos más viejos"
        action={
          <Button asChild variant="outline" className="h-11 md:pointer-fine:h-9">
            <Link href={newestHref} scroll={false}>
              Ver los más nuevos
            </Link>
          </Button>
        }
      >
        Ya viste todo lo que se subió.
      </EmptyTeach>
    )
  }
  return (
    <EmptyTeach
      plain
      title={reader ? 'Todavía no se subió ningún archivo' : 'Todavía no subiste ningún archivo'}
    >
      {reader
        ? 'Cuando alguien suba uno de ARCA, Mercado Pago o el banco, queda acá con lo que pasó con cada renglón.'
        : 'Cuando subas uno de ARCA, Mercado Pago o el banco, queda acá con lo que pasó con cada renglón.'}
    </EmptyTeach>
  )
}
