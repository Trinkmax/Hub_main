import Link from 'next/link'
import { DroppedFileQuestion } from '@/components/administracion/importar/dropped-file-question'
import {
  HistoryEmpty,
  HistoryPager,
  HistoryTable,
} from '@/components/administracion/importar/inbox/history-list'
import {
  ImportCoverage,
  ImportSourcesTable,
} from '@/components/administracion/importar/inbox/source-table'
import { PanelError } from '@/components/administracion/kit'
import {
  Planilla,
  PlanillaFoot,
  PlanillaTitle,
  SimplePage,
} from '@/components/administracion/planilla'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { todayInCordoba } from '@/lib/dates'
import { listImportBatches } from '@/lib/imports/server/queries'
import { buildInbox, importSourceRows } from '@/lib/imports/ui/inbox'
import {
  IMPORT_SOURCE_COPY,
  importHref,
  isUiImportSource,
  UI_IMPORT_SOURCES,
} from '@/lib/imports/ui/labels'
import { firstParam, requireImportAccess } from './_lib/page-access'

export const metadata = { title: 'Importar · Administración' }

/** Archivos del historial por página. */
const HISTORY_PAGE = 20
/** Con cuántos archivos se arma la tabla (qué falta traer y qué quedó esperando). */
const INBOX_BATCHES = 200

/**
 * «Importar», al que se llega por el engranaje: el archivo se arrastra a cualquier pantalla, así
 * que esto queda como una tabla (de dónde, qué archivo, la última vez y «Subir») y el historial.
 * Si lo que se soltó no se reconoció, arriba se pregunta de dónde es.
 *
 * Todo lo que se muestra sale de `buildInbox()` (puro, con tests): acá solo se lee y se dibuja. La
 * contadora ve lo mismo sin ningún botón de carga.
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
  const today = todayInCordoba()
  const paged = source !== null || before !== null

  const [batches, page, treasuries, settings] = await Promise.all([
    settleQuery(listImportBatches(tenantId, { limit: INBOX_BATCHES })),
    // El historial filtrado o paginado se pide aparte; la primera página sale de la lectura de arriba.
    paged
      ? settleQuery(listImportBatches(tenantId, { source, before, limit: HISTORY_PAGE + 1 }))
      : Promise.resolve(null),
    settleQuery(listTreasuryAccounts(tenantId)),
    settleQuery(getAccountingSettings(tenantId)),
  ])

  const inbox = batches.ok
    ? buildInbox({
        today,
        batches: batches.data,
        treasuries: treasuries.ok ? treasuries.data : null,
        booksStartDate: settings.ok ? (settings.data?.booksStartDate ?? null) : null,
        hasCuit: settings.ok && settings.data ? settings.data.cuit !== null : null,
        canWrite,
        slug: tenantSlug,
      })
    : null

  const sourceRows = inbox ? importSourceRows(inbox, tenantSlug) : []

  const historyHref = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams()
    if (source) q.set('origen', source)
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
    const s = q.toString()
    return `${importHref(tenantSlug)}${s ? `?${s}` : ''}#historial`
  }
  const history = page ?? batches
  const rows = history.ok ? history.data.slice(0, HISTORY_PAGE) : []
  const hasOlder = history.ok && history.data.length > HISTORY_PAGE
  const last = rows[rows.length - 1]
  const olderHref = hasOlder && last ? historyHref({ antes: last.createdAt }) : null
  const newestHref = before ? historyHref({}) : null
  // Filtrar por origen sirve cuando hay archivos de más de uno.
  const sourcesUsed = batches.ok ? new Set(batches.data.map((b) => b.source)).size : 0
  const showFilter = source !== null || sourcesUsed > 1

  return (
    <SimplePage>
      <h1 className="sr-only">Importar</h1>
      <ReadOnlyBadge className="w-fit" />
      {canWrite ? <DroppedFileQuestion slug={tenantSlug} /> : null}

      {inbox ? (
        <Planilla>
          <ImportSourcesTable
            rows={sourceRows}
            photoHref={canWrite ? `/${tenantSlug}/administracion/compras/nueva` : null}
          />
          <ImportCoverage rows={sourceRows} />
          {canWrite ? (
            <PlanillaFoot className="text-xs text-muted-foreground">
              <span>También podés arrastrar el archivo a cualquier pantalla.</span>
              <span>{inbox.agenda}</span>
            </PlanillaFoot>
          ) : null}
        </Planilla>
      ) : (
        <PanelError title="Tus archivos" message={batches.ok ? '' : batches.message} />
      )}

      {!treasuries.ok || !settings.ok ? (
        <p className="text-sm text-muted-foreground">
          No pude leer tus cuentas: puede faltar algún aviso.
        </p>
      ) : null}

      <section id="historial" aria-label="Historial" className="scroll-mt-28">
        <Planilla>
          <PlanillaTitle
            title="Historial"
            actions={
              showFilter ? (
                <nav aria-label="Filtrar los archivos por origen" className="flex flex-wrap gap-1">
                  {[null, ...UI_IMPORT_SOURCES].map((s) => {
                    const q = new URLSearchParams()
                    if (s) q.set('origen', s)
                    return (
                      <Button
                        key={s ?? 'todos'}
                        asChild
                        size="sm"
                        variant={s === source ? 'secondary' : 'ghost'}
                      >
                        <Link
                          href={`${importHref(tenantSlug)}${q.toString() ? `?${q}` : ''}#historial`}
                          scroll={false}
                          aria-current={s === source ? 'true' : undefined}
                        >
                          {s ? IMPORT_SOURCE_COPY[s].short : 'Todos'}
                        </Link>
                      </Button>
                    )
                  })}
                </nav>
              ) : null
            }
          />
          {!history.ok ? (
            <PanelError title="Historial" message={history.message} />
          ) : rows.length === 0 ? (
            <HistoryEmpty newestHref={newestHref} reader={!canWrite} />
          ) : (
            <>
              <HistoryTable slug={tenantSlug} rows={rows} today={today} />
              {olderHref || newestHref ? (
                <PlanillaFoot>
                  <span className="text-xs text-muted-foreground">Mostrando {rows.length}</span>
                  <HistoryPager olderHref={olderHref} newestHref={newestHref} />
                </PlanillaFoot>
              ) : null}
            </>
          )}
        </Planilla>
      </section>
    </SimplePage>
  )
}
