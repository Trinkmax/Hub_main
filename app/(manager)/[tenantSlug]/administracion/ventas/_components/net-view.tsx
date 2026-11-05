import Link from 'next/link'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import {
  type PageSearchParams,
  periodParams,
} from '@/components/administracion/cajas-ventas/periods'
import { PanelError } from '@/components/administracion/kit'
import { Planilla, PlanillaBar, PlanillaFoot } from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { getNetByMethod } from '@/lib/accounting/queries/books'
import { exportHref } from '@/lib/accounting/queries/labels'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { netTotals, netVisibleRows } from '../_lib/net-view'
import { periodWords, rangeOrError, tabHref } from '../_lib/ventas-view'
import { NetByMethod } from './net-by-method'

/**
 * «Lo que llegó»: lo que ya te depositaron y cuánto se quedó cada medio en el camino, un renglón por
 * medio de cobro. La lista de cobros de donde sale está en «Cobros» (`?tab=cobros`), a un toque desde
 * el pie.
 */
export async function NetView({
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

  const net = await settleQuery(getNetByMethod(tenantId, { from: range.from, to: range.to }))
  if (!net.ok) {
    return (
      <>
        {bar}
        <PanelError title="Lo que llegó" message={net.message} />
      </>
    )
  }

  const rows = netVisibleRows(net.data)
  const words = periodWords(range)
  const totals = netTotals(net.data)
  const positive = (cents: number) => (cents > 0 ? cents : null)

  if (rows.length === 0) {
    return (
      <>
        {bar}
        {/* Vacío: una oración y un botón, adentro de la misma planilla. */}
        <Planilla>
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
            <p className="min-w-0 text-sm text-pretty">
              <span className="font-medium">Todavía no hay ventas ni cobros {words}.</span> Cuando{' '}
              {canWrite ? 'cargues' : 'se carguen'} cierres y {canWrite ? 'anotes' : 'se anote'} lo
              que te depositan, acá vas a ver cuánto se queda cada medio.
            </p>
            {canWrite ? (
              <ActionButton action="cobrar" size="sm" className="pointer-coarse:h-10">
                Me entró plata
              </ActionButton>
            ) : null}
          </div>
        </Planilla>
      </>
    )
  }

  return (
    <>
      {bar}
      {/* Cada cifra por separado: no se afirma que sumen (una liquidación puede ser de ventas de
          otro período). Lo que no pasó va con «—»: un «$ 0» grande no dice nada. */}
      <Totalizer
        items={[
          { label: 'Te llegó', cents: positive(totals.creditedCents), tone: 'ok' },
          { label: 'Te descontaron', cents: positive(totals.deductedCents) },
          { label: 'Sigue en camino', cents: positive(totals.pendingCents) },
        ]}
      />
      <Planilla>
        <NetByMethod rows={rows} label={range.label} />
        <PlanillaFoot>
          <Button asChild variant="outline" size="sm" className="pointer-coarse:h-10">
            <Link href={tabHref(base, 'cobros', periodParams(range))}>Ver los cobros</Link>
          </Button>
          <ExportButton
            href={exportHref(tenantSlug, 'neto-por-medio', { desde: range.from, hasta: range.to })}
            fileName={`administracion-${tenantSlug}-neto-por-medio-${range.from}-${range.to}.csv`}
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
          />
        </PlanillaFoot>
      </Planilla>
    </>
  )
}
