import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import { firstParam, type PageSearchParams } from '@/components/administracion/cajas-ventas/periods'
import { PanelError, PanelLink } from '@/components/administracion/kit'
import {
  Planilla,
  PlanillaBar,
  PlanillaFoot,
  PlanillaTitle,
} from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { getSalesSummary } from '@/lib/accounting/queries/books'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { exportHref, SALES_INVOICE_KINDS } from '@/lib/accounting/queries/labels'
import { listSalesPoints } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { getArcaEmissionSetup } from '@/lib/arca/emit-queries'
import { invoicedSummary } from '../_lib/invoiced-view'
import { periodWords, rangeOrError } from '../_lib/ventas-view'
import { ChannelTable } from './channel-table'
import { SalesInvoicesList } from './documents-list'
import { PlanillaFold } from './fold'
import { Pager } from './pager'

const TEXT_LINK =
  'font-medium text-foreground underline-offset-4 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * «Facturas» (`?tab=facturas`, se llega desde el «⋯» de la planilla): cuánto de lo vendido fue con
 * factura y cuánto sin, por canal, y las facturas que se hicieron aparte.
 *
 * Con factura o sin factura no se elige acá: se declara en el cierre del día. Las dos partes quedan
 * registradas en los libros, y la pantalla lo dice con las mismas palabras que el cierre.
 *
 * «Hacer una factura con ARCA» aparece solo con la emisión prendida: los socios pidieron sacar la
 * factura suelta (12/10), porque los eventos se facturan con el cierre.
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
  const { range, picker } = rangeOrError(sp, today)
  if (!range.ok) {
    return (
      <>
        <PlanillaBar>
          <RangeFilter range={picker} today={today} />
        </PlanillaBar>
        <PeriodError message={range.message} />
      </>
    )
  }
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
  const totals = summary.ok ? invoicedSummary(summary.data) : null
  const noSalesPoints = points.ok && points.data.length === 0
  const arcaOn = arca?.ok === true && arca.data.state === 'on'
  const periodSlug = range.month ?? `${range.from}-${range.to}`

  return (
    <>
      <PlanillaBar>
        <RangeFilter range={picker} today={today} />
        <ReadOnlyBadge />
        {canWrite && arcaOn ? (
          <Button asChild size="sm" className="ml-auto pointer-coarse:h-10">
            <Link href={`${base}/ventas/nueva-factura`}>Hacer una factura con ARCA</Link>
          </Button>
        ) : null}
      </PlanillaBar>

      {!summary.ok ? (
        <PanelError title="Lo que se facturó" message={summary.message} />
      ) : (
        <>
          {/* Sin ventas no hay reparto: lo que no pasó va con «—», nunca con un «$ 0». */}
          <Totalizer
            items={[
              { label: 'Total vendido', cents: totals ? totals.soldCents : null },
              { label: 'Con factura', cents: totals ? totals.invoicedCents : null },
              { label: 'Sin factura', cents: totals ? totals.uninvoicedCents : null },
            ]}
          />
          <Planilla>
            <PlanillaTitle title="Por canal" />
            {totals ? (
              <ChannelTable
                channels={totals.channels}
                caption={`Vendido, facturado y sin factura por canal, ${range.label}`}
              />
            ) : (
              <p className="px-3 py-3 text-sm text-pretty">
                <span className="font-medium">Todavía no hay ventas {words}.</span> En el cierre de
                cada día se anota lo que se facturó; lo demás queda como venta sin factura.
              </p>
            )}
            <PlanillaFoot>
              <span />
              <div className="flex flex-wrap items-center gap-2">
                <ExportButton
                  href={exportHref(tenantSlug, 'subdiario-ventas', {
                    desde: range.from,
                    hasta: range.to,
                  })}
                  fileName={`administracion-${tenantSlug}-subdiario-ventas-${periodSlug}.csv`}
                  label="Exportar subdiario de ventas"
                  size="sm"
                  className="pointer-coarse:h-10"
                />
                <ExportButton
                  href={exportHref(tenantSlug, 'ventas-sin-factura', {
                    desde: range.from,
                    hasta: range.to,
                  })}
                  fileName={`administracion-${tenantSlug}-ventas-sin-factura-${periodSlug}.csv`}
                  label="Exportar ventas sin factura"
                  size="sm"
                  className="pointer-coarse:h-10"
                />
              </div>
            </PlanillaFoot>
          </Planilla>
        </>
      )}

      {!page.ok ? (
        <PanelError title="Facturas aparte" message={page.message} />
      ) : (
        <Planilla>
          <PlanillaTitle title="Facturas aparte" />
          {page.data.rows.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground text-pretty">
              No hay facturas aparte {words}. Las ventas de todos los días se facturan con el
              cierre, también las de eventos.
            </p>
          ) : (
            <>
              <SalesInvoicesList rows={page.data.rows} base={base} today={today} />
              {page.data.nextCursor || after !== null ? (
                <PlanillaFoot>
                  <span />
                  <div className="flex flex-wrap items-center gap-2">
                    <Pager
                      base={base}
                      tab="facturas"
                      range={range}
                      nextCursor={page.data.nextCursor}
                      isFirst={after === null}
                    />
                  </div>
                </PlanillaFoot>
              ) : null}
            </>
          )}
        </Planilla>
      )}

      <PlanillaFold title="¿Cómo se factura acá?" open={noSalesPoints}>
        <div className="space-y-2 text-sm leading-relaxed text-pretty">
          {noSalesPoints ? (
            <p>
              <span className="font-medium">
                {canWrite
                  ? 'Primero, cargá tus puntos de venta.'
                  : 'El bar todavía no tiene puntos de venta cargados.'}
              </span>{' '}
              Sin eso, todo lo de cada noche queda como venta sin factura (se registra igual).{' '}
              {canWrite ? (
                <Link href={`${base}/ajustes?tab=puntos-de-venta`} className={TEXT_LINK}>
                  Cargar mis puntos de venta
                </Link>
              ) : null}
            </p>
          ) : null}
          <p>
            Lo de todas las noches se anota en el{' '}
            {canWrite ? (
              <Link href={`${base}/ventas/cierre`} className={TEXT_LINK}>
                cierre del día
              </Link>
            ) : (
              'cierre del día'
            )}
            : de qué número a qué número se facturó. Lo demás queda como venta sin factura.
          </p>
          <p>
            Las dos partes quedan registradas en los libros. Lo facturado entra además al Libro IVA
            de ventas; cómo se trata lo demás lo define la contadora.
          </p>
          <PanelLink href={`${base}/guias/con-y-sin-factura`}>
            ¿Qué cambia con factura y sin factura?
            <ArrowRight aria-hidden className="size-3.5" />
          </PanelLink>
        </div>
      </PlanillaFold>
    </>
  )
}
