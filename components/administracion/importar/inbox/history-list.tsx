import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
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
 * «Todo lo que subiste»: cada archivo en un renglón con margen (el día en que
 * se subió), el período como título, de dónde vino y qué pasó con lo que traía.
 * Todo el renglón lleva a su revisión.
 *
 * Reemplaza a la tabla «Filas · Repetidas · Cargados · Pendientes», que hablaba
 * en palabras de sistema. La tabla densa queda para la contadora
 * (`ImportHistory`), que en el celular también usa esta lista. Server-safe.
 *
 * El estado va a la derecha cuando la hoja tiene lugar; en una hoja angosta (el
 * celular) baja a su propio renglón al pie: al lado aplastaba el texto y no se
 * leía qué archivo era cada uno.
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
        const parts = historyCountParts(row)
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
                {/* Cada tramo va entero: «4 no se cargan» nunca se parte en «4 / no se cargan». El punto
                    queda pegado al tramo de antes (espacio duro) y el corte cae después. */}
                <span className="block">
                  {parts.map((part, index) => (
                    <Fragment key={part}>
                      {index > 0 ? '\u00A0· ' : null}
                      <span className="whitespace-nowrap">{part}</span>
                    </Fragment>
                  ))}
                </span>
                <span
                  title={shown.hint}
                  className="mt-1.5 flex items-center gap-1.5 @[28rem]/ledger:hidden"
                >
                  <StatusPill tone={shown.tone}>{shown.label}</StatusPill>
                  <ChevronRight
                    aria-hidden
                    className="ml-auto size-4 shrink-0 text-muted-foreground"
                  />
                </span>
              </>
            }
            amount={
              <span
                title={shown.hint}
                className="hidden items-center gap-1.5 @[28rem]/ledger:inline-flex"
              >
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
