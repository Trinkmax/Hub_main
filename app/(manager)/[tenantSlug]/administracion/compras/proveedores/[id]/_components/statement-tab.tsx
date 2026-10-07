import { ChevronRight, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { StatementTable } from '@/components/administracion/statement-table'
import { Button } from '@/components/ui/button'
import { exportHref, getPartyStatement, settleQuery } from '@/lib/accounting/queries'
import { BlockError } from '../../../_components/block-error'
import { ExportButton } from '../../../_components/export-button'
import { PeriodChips } from '../../../_components/period-chips'
import { firstParam } from '../../../_lib/links'
import { periodPhrase, resolveListPeriod } from '../../../_lib/period'
import { toStatementView } from '../../../_lib/statement'

/** Movimientos por página (la base corta en 500; 200 se leen cómodos). */
const STATEMENT_PAGE = 200

/**
 * Estado de cuenta de un proveedor (H.7 · F.7): saldo anterior, facturas y
 * pagos con el saldo corrido que calcula la base, vencimiento de cada factura,
 * totales y saldo final; período por URL y exporte CSV.
 */
export async function StatementTab({
  tenantId,
  tenantSlug,
  partyId,
  partyName,
  baseHref,
  sp,
  today,
}: {
  tenantId: string
  tenantSlug: string
  partyId: string
  partyName: string
  /** La ficha (`/compras/proveedores/[id]`). */
  baseHref: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
}) {
  const period = resolveListPeriod(sp, {
    today,
    chips: ['ultimos-90', 'este-mes', 'mes-pasado', 'este-anio'],
    fallback: 'ultimos-90',
  })
  const after = firstParam(sp.despues) || null
  const outcome = await settleQuery(
    getPartyStatement(tenantId, {
      partyId,
      from: period.from,
      to: period.to,
      after,
      limit: STATEMENT_PAGE,
    }),
  )

  const linkWith = (extra: Readonly<Record<string, string | null>>) => {
    const search = new URLSearchParams()
    if (period.param) search.set('periodo', period.param)
    for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value)
    const query = search.toString()
    return `${baseHref}${query ? `?${query}` : ''}`
  }

  const toolbar = (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PeriodChips
          chips={period.chips}
          active={period.active}
          from={period.from}
          to={period.to}
          label={period.label}
          max={today}
        />
        <ExportButton
          href={exportHref(tenantSlug, 'estado-de-cuenta', {
            participe: partyId,
            desde: period.from,
            hasta: period.to,
          })}
          fileName={`estado-de-cuenta-${period.from}-${period.to}.csv`}
          label="Exportar estado de cuenta"
          className="h-11 self-start md:h-9 lg:self-auto"
        />
      </div>
      {period.error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-warning-text">
            {period.error} Te mostramos {periodPhrase(period)}.
          </p>
        </div>
      ) : null}
    </div>
  )

  if (!outcome.ok) {
    return (
      <div className="space-y-4">
        {toolbar}
        <BlockError message={outcome.message} />
      </div>
    )
  }

  const page = outcome.data
  const hasMore = page.nextCursor !== null
  const view = toStatementView({
    slug: tenantSlug,
    rows: page.rows,
    from: page.from,
    to: page.to,
    openingCents: page.openingCents,
    hasMore,
  })
  const lineCount = view.rows.length

  return (
    <div className="space-y-4">
      {toolbar}
      <StatementTable
        rows={view.rows}
        caption={`Estado de cuenta de ${partyName}, ${period.label.toLowerCase()}`}
        balanceMode="payable"
        opening={view.opening}
        columnLabels={{ debit: 'Pagos', credit: 'Facturas' }}
        showDue
        today={today}
        totals={view.totals}
        closing={view.closing}
        emptyText={`No hubo facturas ni pagos en ${periodPhrase(period)}.`}
        footnote={
          hasMore
            ? `Ves ${lineCount} de ${page.totalRows} movimientos. El saldo de cada fila ya cuenta los anteriores.`
            : after
              ? 'Estás viendo los últimos movimientos del período.'
              : null
        }
      />
      {hasMore || after ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {after ? (
            <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
              <Link href={linkWith({})} scroll={false}>
                Volver al principio
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {hasMore && page.nextCursor ? (
            <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
              <Link href={linkWith({ despues: page.nextCursor })} scroll={false}>
                Ver los movimientos siguientes
                <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
