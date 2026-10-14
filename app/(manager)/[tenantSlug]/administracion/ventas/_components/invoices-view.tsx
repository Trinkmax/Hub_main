import { ArrowRight, CalendarCheck, FilePlus2, Hash } from 'lucide-react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { firstParam, type PageSearchParams } from '@/components/administracion/cajas-ventas/periods'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { INVOICED_SWATCH, NOT_INVOICED_SWATCH } from '@/components/administracion/charts/palette'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import {
  ActionTile,
  EmptyTeach,
  Explain,
  Panel,
  PanelError,
  PanelLink,
} from '@/components/administracion/kit'
import { getSalesSummary } from '@/lib/accounting/queries/books'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { exportHref, SALES_INVOICE_KINDS } from '@/lib/accounting/queries/labels'
import { listSalesPoints } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { getArcaEmissionSetup } from '@/lib/arca/emit-queries'
import { channelSales, invoicedTitle, monthTicket } from '../_lib/invoiced-view'
import { ChannelTable } from './channel-table'
import { SalesInvoicesList } from './documents-list'
import { MonthTicket } from './month-ticket'
import { FOLD_SUMMARY, FoldChevron } from './projection-panel'
import { Pager, periodWords, rangeOrError } from './ventas-views'

/**
 * «Facturas»: cuánto de lo vendido fue con factura y cuánto sin, con el
 * ticket del mes al lado (el mismo sello que el de cada noche), cómo se
 * factura en este bar y las facturas que se hicieron aparte.
 *
 * Con factura o sin factura no se elige acá: se declara en el paso 3 del
 * cierre del día. Las dos partes quedan registradas en los libros, y la
 * pantalla lo dice con las mismas palabras y los mismos colores que el cierre
 * y el Resumen.
 *
 * «Hacer una factura con ARCA» aparece solo con la emisión prendida: los
 * socios pidieron sacar la factura suelta (12/10), porque los eventos se
 * facturan con el cierre.
 */
export async function InvoicesView({
  tenantId,
  tenantSlug,
  base,
  today,
  sp,
  canWrite,
}: {
  tenantId: string
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  today: string
  sp: PageSearchParams
  canWrite: boolean
}) {
  const { range } = rangeOrError(sp, today)
  if (!range.ok) return <PeriodError message={range.message} />
  const after = firstParam(sp.despues)
  const [summary, page, points, arca] = await Promise.all([
    settleQuery(getSalesSummary(tenantId, { from: range.from, to: range.to })),
    settleQuery(
      listDocuments(tenantId, {
        from: range.from,
        to: range.to,
        kinds: SALES_INVOICE_KINDS,
        status: 'all',
        after,
      }),
    ),
    settleQuery(listSalesPoints(tenantId)),
    // Solo quien carga puede emitir: a quien mira no se le pregunta por ARCA.
    canWrite ? settleQuery(getArcaEmissionSetup(tenantId, { vatRegistered: true })) : null,
  ])
  const words = periodWords(range)
  const ticket = summary.ok ? monthTicket(summary.data) : null
  const noSalesPoints = points.ok && points.data.length === 0
  const arcaOn = arca?.ok === true && arca.data.state === 'on'
  const periodSlug = range.month ?? `${range.from}-${range.to}`

  const accountant = (
    <details open={!canWrite} className="group/fold border-t border-border/60 pt-1 text-sm">
      <summary className={`${FOLD_SUMMARY} text-muted-foreground`}>
        Para la contadora
        <FoldChevron />
      </summary>
      <div className="flex flex-wrap gap-2 pb-1">
        <ExportButton
          href={exportHref(tenantSlug, 'subdiario-ventas', { desde: range.from, hasta: range.to })}
          fileName={`administracion-${tenantSlug}-subdiario-ventas-${periodSlug}.csv`}
          label="Exportar subdiario de ventas"
          size="sm"
          className="h-11 md:pointer-fine:h-9"
        />
        <ExportButton
          href={exportHref(tenantSlug, 'ventas-sin-factura', {
            desde: range.from,
            hasta: range.to,
          })}
          fileName={`administracion-${tenantSlug}-ventas-sin-factura-${periodSlug}.csv`}
          label="Exportar ventas sin factura"
          size="sm"
          className="h-11 md:pointer-fine:h-9"
        />
      </div>
    </details>
  )

  const how = (
    <section aria-labelledby="como-se-factura" className="space-y-3">
      <h2
        id="como-se-factura"
        className="font-serif text-lg font-semibold leading-snug tracking-tight"
      >
        ¿Cómo se factura acá?
      </h2>
      <div className="grid gap-3">
        {canWrite ? (
          <ActionTile
            icon={CalendarCheck}
            title="Lo de todas las noches"
            hint="En el paso 3 del cierre anotás de qué número a qué número facturaste. Lo demás queda como venta sin factura."
            href={`${base}/ventas/cierre`}
          />
        ) : (
          <p className="rounded-2xl bg-secondary/50 p-4 text-sm leading-relaxed text-pretty">
            Lo de todas las noches se declara en el paso 3 del cierre del día: de qué número a qué
            número se facturó. Lo demás queda como venta sin factura.
          </p>
        )}
        {noSalesPoints ? (
          canWrite ? (
            <ActionTile
              icon={Hash}
              title="Cargá tus puntos de venta"
              hint="Sin eso, todo el día queda como venta sin factura."
              href={`${base}/ajustes?tab=puntos-de-venta`}
            />
          ) : (
            <p className="rounded-2xl bg-secondary/50 p-4 text-sm leading-relaxed text-pretty">
              El bar todavía no tiene puntos de venta cargados: por ahora todo el día queda como
              venta sin factura.
            </p>
          )
        ) : null}
        {canWrite && arcaOn ? (
          <ActionTile
            icon={FilePlus2}
            title="Hacer una factura con ARCA"
            hint="Para un evento, un catering o un sponsoreo que no está en ningún cierre."
            href={`${base}/ventas/nueva-factura`}
          />
        ) : null}
      </div>
      <PanelLink href={`${base}/guias/con-y-sin-factura`}>
        ¿Qué cambia con factura y sin factura?
        <ArrowRight aria-hidden className="size-3.5" />
      </PanelLink>
    </section>
  )

  return (
    <div className="space-y-6">
      {/* En la compu, el papel a la derecha a lo alto de las dos filas; a la izquierda, lo que
          se facturó y, debajo, cómo se factura. En el celular va primero el ticket. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
        {!summary.ok ? (
          <PanelError title="Lo que se facturó" message={summary.message} />
        ) : ticket ? (
          <Panel title="Lo que se facturó" className="min-w-0 lg:col-start-1 lg:row-start-1">
            <ChartFrame
              title={invoicedTitle(ticket.split, words.in)}
              sentence="Lo que anotaste en «¿Qué facturaste?» de cada cierre va con factura; lo demás queda como venta sin factura."
              defaultView={canWrite ? 'chart' : 'table'}
              chart={
                <SplitBar
                  totalLabel="Total vendido"
                  segments={[
                    {
                      key: 'con',
                      label: 'Con factura',
                      cents: ticket.invoicedCents,
                      swatch: INVOICED_SWATCH,
                    },
                    {
                      key: 'sin',
                      label: 'Sin factura',
                      cents: ticket.uninvoicedCents,
                      swatch: NOT_INVOICED_SWATCH,
                    },
                  ]}
                />
              }
              table={
                <ChannelTable
                  channels={channelSales(summary.data)}
                  caption={`Vendido, facturado y sin factura por canal, ${range.label}`}
                />
              }
            />
            <div className="mt-4 space-y-3">
              <Explain label="¿Qué quiere decir cada una?">
                <p className="text-sm leading-relaxed text-pretty">
                  Las dos partes quedan registradas en los libros. Lo facturado entra además al
                  Libro IVA de ventas; cómo se trata lo demás lo define la contadora.
                </p>
              </Explain>
              {accountant}
            </div>
          </Panel>
        ) : (
          <Panel title="Lo que se facturó" className="min-w-0 lg:col-span-2">
            <EmptyTeach
              plain
              illustration={<ChartSilhouette kind="split" />}
              title="Acá vas a ver cuánto de lo vendido fue con factura"
            >
              En el paso 3 del cierre anotás lo que facturaste; lo demás queda como venta sin
              factura. Las dos quedan registradas en los libros.
            </EmptyTeach>
            <div className="mt-4">{accountant}</div>
          </Panel>
        )}
        {ticket ? (
          <MonthTicket
            data={ticket}
            subtitle={range.label}
            className="max-lg:order-first lg:col-start-2 lg:row-span-2 lg:row-start-1"
          />
        ) : null}
        <div className={ticket ? 'min-w-0 lg:col-start-1 lg:row-start-2' : 'min-w-0 lg:col-span-2'}>
          {how}
        </div>
      </div>

      {page.ok ? (
        <Panel title="Facturas aparte" description="Las que se hicieron fuera del cierre del día.">
          {page.data.rows.length === 0 ? (
            <EmptyTeach plain title={`No hay facturas aparte ${words.in}`}>
              Las ventas de todos los días se facturan con el cierre, también las de eventos. Acá
              quedan las que se hicieron aparte.
            </EmptyTeach>
          ) : (
            <div className="space-y-4">
              <div className="max-sm:-mx-4">
                <SalesInvoicesList rows={page.data.rows} base={base} today={today} />
              </div>
              <Pager
                base={base}
                tab="facturas"
                range={range}
                nextCursor={page.data.nextCursor}
                isFirst={after === null}
              />
            </div>
          )}
        </Panel>
      ) : (
        <PanelError title="Facturas aparte" message={page.message} />
      )}
    </div>
  )
}
