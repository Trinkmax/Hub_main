import Link from 'next/link'
import { BlockError } from '@/components/administracion/cajas-ventas/block-error'
import {
  HowToBanco,
  HowToMercadoPago,
  HowToMisComprobantes,
} from '@/components/administracion/guias/how-to'
import { ImportHistory } from '@/components/administracion/importar/import-history'
import { StillManual } from '@/components/administracion/importar/page-bits'
import {
  ImportSourceCard,
  type SourceOverviewView,
} from '@/components/administracion/importar/source-card'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { getImportsOverview, listImportBatches } from '@/lib/imports/server/queries'
import {
  IMPORT_SOURCE_COPY,
  importHref,
  isUiImportSource,
  UI_IMPORT_SOURCES,
  type UiImportSource,
} from '@/lib/imports/ui/labels'
import { cn } from '@/lib/utils'
import { firstParam, requireImportAccess } from './_lib/page-access'

export const metadata = { title: 'Importar · Administración' }

/** Filas del historial por página. */
const HISTORY_PAGE = 20

const HOW_TO: Readonly<Record<UiImportSource, typeof HowToMisComprobantes>> = {
  arca_recibidos: HowToMisComprobantes,
  mp_release: HowToMercadoPago,
  bank_statement: HowToBanco,
}

/**
 * «Importar» (diseño §4.0): las tres tarjetas (compras desde ARCA, Mercado
 * Pago y banco), cada una con su última importación, lo que falta revisar y
 * «¿Cómo lo bajo?», y abajo el historial. La contadora ve todo, sin botones.
 */
export default async function ImportarPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const origen = firstParam(sp.origen)
  const source = isUiImportSource(origen) ? origen : null
  const antes = firstParam(sp.antes)
  const before = /^\d{4}-\d{2}-\d{2}T/.test(antes) ? antes : null
  const { access, canWrite } = await requireImportAccess(tenantSlug, importHref(tenantSlug))
  const tenantId = access.tenant.id

  const [overview, history] = await Promise.all([
    settleQuery(getImportsOverview(tenantId)),
    settleQuery(listImportBatches(tenantId, { source, before, limit: HISTORY_PAGE + 1 })),
  ])

  const cardOverview = (s: UiImportSource): SourceOverviewView => {
    if (!overview.ok) return null
    const o = overview.data[s]
    return {
      lastBatch: o.lastBatch
        ? {
            id: o.lastBatch.id,
            status: o.lastBatch.status,
            createdAt: o.lastBatch.createdAt,
            periodFrom: o.lastBatch.periodFrom,
            periodTo: o.lastBatch.periodTo,
            pending: o.lastBatch.pending,
          }
        : null,
      pendingBatches: o.pendingBatches,
      pendingProposals: o.pendingProposals,
    }
  }

  const historyHref = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams()
    if (source) q.set('origen', source)
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
    const s = q.toString()
    return `${importHref(tenantSlug)}${s ? `?${s}` : ''}#historial`
  }
  const rows = history.ok ? history.data.slice(0, HISTORY_PAGE) : []
  const hasOlder = history.ok && history.data.length > HISTORY_PAGE
  const last = rows[rows.length - 1]

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Importar <ReadOnlyBadge />
          </>
        }
        description={
          canWrite
            ? 'Subí lo que bajás de ARCA, de Mercado Pago y del banco: armamos los comprobantes, vos completás lo poco que falta y los cargás todos juntos. Así no tipeás compras ni cobros a mano.'
            : 'Lo que se importó de ARCA, Mercado Pago y el banco, y en qué quedó cada importación.'
        }
      />

      {/* Si no se pudo leer nada (p. ej., la función todavía no está), un solo aviso con «Reintentar». */}
      {!overview.ok && !history.ok ? <BlockError message={overview.message} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {UI_IMPORT_SOURCES.map((s) => {
          const HowTo = HOW_TO[s]
          return (
            <ImportSourceCard
              key={s}
              slug={tenantSlug}
              source={s}
              overview={cardOverview(s)}
              canWrite={canWrite}
              howTo={<HowTo className="bg-background/60" />}
            />
          )
        })}
      </div>

      {canWrite ? <StillManual slug={tenantSlug} /> : null}

      <section id="historial" aria-labelledby="historial-titulo" className="scroll-mt-24 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-0.5">
            <h2 id="historial-titulo" className="font-serif text-xl font-semibold tracking-tight">
              Historial
            </h2>
            <p className="text-sm text-muted-foreground">
              Cada archivo que se subió, del más nuevo al más viejo.
            </p>
          </div>
          <nav aria-label="Filtrar el historial por origen" className="flex flex-wrap gap-2">
            {[null, ...UI_IMPORT_SOURCES].map((s) => {
              const active = s === source
              const q = new URLSearchParams()
              if (s) q.set('origen', s)
              const href = `${importHref(tenantSlug)}${q.toString() ? `?${q}` : ''}#historial`
              return (
                <Link
                  key={s ?? 'todos'}
                  href={href}
                  scroll={false}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors md:h-9',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  {s ? IMPORT_SOURCE_COPY[s].short : 'Todos'}
                </Link>
              )
            })}
          </nav>
        </div>
        {history.ok ? (
          <ImportHistory
            slug={tenantSlug}
            rows={rows}
            olderHref={hasOlder && last ? historyHref({ antes: last.createdAt }) : null}
            newestHref={before ? historyHref({}) : null}
          />
        ) : overview.ok ? (
          <BlockError message={history.message} />
        ) : null}
      </section>
    </PageShell>
  )
}
