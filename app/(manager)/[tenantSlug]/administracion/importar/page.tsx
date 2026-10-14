import { ImportHistory } from '@/components/administracion/importar/import-history'
import {
  HistoryEmpty,
  HistoryList,
  HistoryPager,
} from '@/components/administracion/importar/inbox/history-list'
import { HowItWorks } from '@/components/administracion/importar/inbox/how-it-works'
import { AgendaLine, NextUp } from '@/components/administracion/importar/inbox/next-up'
import { ImportTray } from '@/components/administracion/importar/inbox/tray'
import { StillManual } from '@/components/administracion/importar/page-bits'
import { AdmHeader, AdmPage, Panel, PanelError, PillLink } from '@/components/administracion/kit'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { todayInCordoba } from '@/lib/dates'
import { listImportBatches } from '@/lib/imports/server/queries'
import { buildInbox } from '@/lib/imports/ui/inbox'
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
/** Con cuántos archivos se arman las bandejas (cobertura, lo que espera y lo que toca). */
const INBOX_BATCHES = 200

/**
 * «Importar»: la bandeja de entrada. Arriba, lo que toca ahora (o «Así
 * funciona» mientras el bar nunca cargó nada desde un archivo); después las
 * tres bandejas (ARCA, Mercado Pago, el banco), cada una con lo que falta
 * traer, lo ya traído y las hojas que esperan; y abajo todo lo que se subió.
 *
 * Todo lo que se muestra sale de `buildInbox()` (puro, con tests): acá solo se
 * lee y se dibuja. La contadora ve las bandejas y el historial, sin ningún
 * botón de carga.
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

  const header = (
    <AdmHeader
      title="Importar"
      badge={<ReadOnlyBadge />}
      description={
        canWrite
          ? 'Lo que ARCA, Mercado Pago y el banco ya saben no hace falta tipearlo: lo bajás de allá, lo subís acá y lo revisás.'
          : 'Lo que se subió de ARCA, Mercado Pago y el banco, y en qué quedó cada archivo.'
      }
    />
  )

  if (!batches.ok) {
    return (
      <AdmPage>
        {header}
        <PanelError title="Tus archivos" message={batches.message} />
      </AdmPage>
    )
  }

  const inbox = buildInbox({
    today,
    batches: batches.data,
    treasuries: treasuries.ok ? treasuries.data : null,
    booksStartDate: settings.ok ? (settings.data?.booksStartDate ?? null) : null,
    hasCuit: settings.ok && settings.data ? settings.data.cuit !== null : null,
    canWrite,
    slug: tenantSlug,
  })

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

  return (
    <AdmPage>
      {header}

      {canWrite && inbox.next ? <NextUp next={inbox.next} /> : null}
      {canWrite && !inbox.everLoaded ? (
        <HowItWorks startNote={inbox.startNote} agenda={inbox.agenda} />
      ) : canWrite && !inbox.next ? (
        <AgendaLine agenda={inbox.agenda} />
      ) : null}

      {!treasuries.ok || !settings.ok ? (
        <p className="text-sm text-muted-foreground">
          No pude leer tus cajas: puede faltar algún aviso.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {inbox.trays.map((tray) => (
          <ImportTray key={tray.source} tray={tray} />
        ))}
      </div>

      {history.ok ? (
        <Panel
          id="historial"
          title="Todo lo que subiste"
          description="Cada archivo, del más nuevo al más viejo."
        >
          <nav aria-label="Filtrar los archivos por origen" className="mb-3 flex flex-wrap gap-1.5">
            {[null, ...UI_IMPORT_SOURCES].map((s) => {
              const q = new URLSearchParams()
              if (s) q.set('origen', s)
              return (
                <PillLink
                  key={s ?? 'todos'}
                  href={`${importHref(tenantSlug)}${q.toString() ? `?${q}` : ''}#historial`}
                  scroll={false}
                  active={s === source}
                  className="h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
                >
                  {s ? IMPORT_SOURCE_COPY[s].short : 'Todos'}
                </PillLink>
              )
            })}
          </nav>
          {canWrite ? (
            rows.length === 0 ? (
              <HistoryEmpty newestHref={newestHref} />
            ) : (
              <div className="space-y-3">
                <HistoryList slug={tenantSlug} rows={rows} today={today} />
                <HistoryPager olderHref={olderHref} newestHref={newestHref} />
              </div>
            )
          ) : (
            <ImportHistory
              slug={tenantSlug}
              rows={rows}
              today={today}
              olderHref={olderHref}
              newestHref={newestHref}
            />
          )}
        </Panel>
      ) : (
        <PanelError title="Todo lo que subiste" message={history.message} />
      )}

      {canWrite ? <StillManual slug={tenantSlug} /> : null}
    </AdmPage>
  )
}
