import { ArrowRight, FileText, Landmark, Wallet } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatRange } from '@/lib/dates'
import type { ImportBatchStatus } from '@/lib/imports/server/types'
import {
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importHref,
  importSourceHref,
  type UiImportSource,
} from '@/lib/imports/ui/labels'
import { count } from '@/lib/imports/ui/progress'
import { BatchStatusBadge } from './status-badge'

const ICON: Readonly<Record<UiImportSource, typeof FileText>> = {
  arca_recibidos: FileText,
  mp_release: Wallet,
  bank_statement: Landmark,
}

/** Lo que la tarjeta necesita de la última importación (de `getImportsOverview`). */
export type SourceOverviewView = {
  lastBatch: {
    id: string
    status: ImportBatchStatus
    createdAt: string
    periodFrom: string | null
    periodTo: string | null
    pending: number
  } | null
  pendingBatches: number
  pendingProposals: number
} | null

/**
 * Una tarjeta del hub «Importar» (diseño §4.0): qué se importa, la última vez,
 * lo pendiente de revisar, «¿Cómo lo bajo?» y el botón para importar (solo a
 * quien puede cargar). Server-safe.
 */
export function ImportSourceCard({
  slug,
  source,
  overview,
  canWrite,
  howTo,
}: {
  slug: string
  source: UiImportSource
  /** `null` si no se pudo leer (la tarjeta igual se ve, sin estado). */
  overview: SourceOverviewView
  canWrite: boolean
  /** El plegable «¿Cómo lo bajo?» de este origen. */
  howTo: ReactNode
}) {
  const copy = IMPORT_SOURCE_COPY[source]
  const Icon = ICON[source]
  const last = overview?.lastBatch ?? null
  const titleId = `importar-${source}`

  return (
    <section
      aria-labelledby={titleId}
      className="card-hairline flex h-full flex-col gap-4 rounded-xl border border-border/70 bg-card/85 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="font-serif text-xl font-semibold tracking-tight">
            {copy.title}
          </h2>
          <p className="text-sm font-medium text-muted-foreground">{copy.loads}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground text-pretty">{copy.description}</p>

      <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
        {overview === null ? (
          <p className="text-muted-foreground">No pudimos leer la última importación.</p>
        ) : last === null ? (
          <p className="text-muted-foreground">Todavía no importaste nada de acá.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Última: {formatDateTime(last.createdAt)}</span>
              <BatchStatusBadge status={last.status} />
            </p>
            {last.periodFrom && last.periodTo ? (
              <p className="text-muted-foreground">
                Período {formatRange(last.periodFrom, last.periodTo)}
              </p>
            ) : null}
          </>
        )}
        {overview && overview.pendingProposals > 0 ? (
          <p className="font-medium text-warning-text">
            {count(overview.pendingProposals, 'comprobante', 'comprobantes')} para revisar o cargar
            {overview.pendingBatches > 1 ? (
              <>
                {' '}
                en{' '}
                <Link
                  href={`${importHref(slug)}?origen=${source}#historial`}
                  className="underline underline-offset-2"
                >
                  {overview.pendingBatches} importaciones
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        {last && last.pending > 0 ? (
          <Link
            href={importBatchHref(slug, last.id)}
            className="inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-2 md:min-h-0"
          >
            Seguir con la última
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>

      {howTo}

      {canWrite ? (
        <div className="mt-auto pt-1">
          <Button asChild className="h-11 w-full gap-2 md:h-10">
            <Link href={importSourceHref(slug, source)}>
              {copy.cta}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  )
}
