import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import { firstParam, type PageSearchParams } from '@/components/administracion/cajas-ventas/periods'
import { PanelError } from '@/components/administracion/kit'
import { Planilla, PlanillaBar, PlanillaFoot } from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { exportHref } from '@/lib/accounting/queries/labels'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { collectionAmounts } from '../_lib/net-view'
import { periodWords, rangeOrError } from '../_lib/ventas-view'
import { CollectionsList } from './collections-list'
import { Pager } from './pager'

/**
 * «Cobros» (`?tab=cobros`, se llega desde el «⋯» de la planilla y desde «Lo que llegó»): lo que ya te
 * depositaron las tarjetas y las apps, y lo que te pagaron los clientes, en el período elegido.
 */
export async function CollectionsView({
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
  const bar = (
    <PlanillaBar>
      <RangeFilter range={picker} today={today} />
      <ReadOnlyBadge />
      {canWrite ? (
        <ActionButton action="cobrar" size="sm" className="ml-auto pointer-coarse:h-10">
          Me entró plata
        </ActionButton>
      ) : null}
    </PlanillaBar>
  )
  if (!range.ok) {
    return (
      <>
        {bar}
        <PeriodError message={range.message} />
      </>
    )
  }

  const after = firstParam(sp.despues)
  const page = await settleQuery(
    listDocuments(tenantId, {
      from: range.from,
      to: range.to,
      kinds: ['collection'],
      status: 'all',
      after,
    }),
  )
  if (!page.ok) {
    return (
      <>
        {bar}
        <PanelError title="Cobros" message={page.message} />
      </>
    )
  }

  const { rows, nextCursor } = page.data
  const exportButton = (
    <ExportButton
      href={exportHref(tenantSlug, 'subdiario-cobranzas', { desde: range.from, hasta: range.to })}
      fileName={`administracion-${tenantSlug}-subdiario-cobranzas-${range.from}-${range.to}.csv`}
      label="Exportar subdiario de cobranzas"
      variant="outline"
      size="sm"
      className="pointer-coarse:h-10"
    />
  )

  if (rows.length === 0) {
    return (
      <>
        {bar}
        {/* Vacío: una oración, adentro de la misma planilla. */}
        <Planilla>
          <p className="px-3 py-3 text-sm text-pretty">
            <span className="font-medium">No hay cobros {periodWords(range)}.</span>{' '}
            {canWrite
              ? 'Cuando te deposita una tarjeta o una app, o te paga un cliente, lo anotás con «Me entró plata». Lo de Mercado Pago entra cuando contás la caja de Mercado Pago.'
              : 'Cuando una tarjeta o una app deposita, o paga un cliente, los dueños lo anotan y aparece acá. Lo de Mercado Pago entra cuando cuentan la caja de Mercado Pago.'}
          </p>
          <PlanillaFoot>
            <span />
            {exportButton}
          </PlanillaFoot>
        </Planilla>
      </>
    )
  }

  // Con más páginas, una suma de lo que se ve no es el total del período: no se muestra.
  const whole = after === null && nextCursor === null
  const active = rows.filter((row) => row.status !== 'voided').map(collectionAmounts)
  const total = whole
    ? {
        receivedCents: active.reduce((sum, row) => sum + row.shown, 0),
        discountCents: active.reduce((sum, row) => sum + row.discount, 0),
      }
    : null

  return (
    <>
      {bar}
      {total ? (
        <Totalizer
          items={[
            { label: 'Entró', cents: total.receivedCents, tone: 'ok' },
            {
              label: 'Te descontaron',
              cents: total.discountCents > 0 ? total.discountCents : null,
            },
          ]}
        />
      ) : null}
      <Planilla>
        <CollectionsList rows={rows} base={base} total={total} />
        <PlanillaFoot>
          <div className="flex flex-wrap items-center gap-2">
            <Pager
              base={base}
              tab="cobros"
              range={range}
              nextCursor={nextCursor}
              isFirst={after === null}
            />
          </div>
          {exportButton}
        </PlanillaFoot>
      </Planilla>
    </>
  )
}
