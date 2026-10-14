import { ChevronRight, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { BalanceArea } from '@/components/administracion/charts/balance-area'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { Panel, PanelError } from '@/components/administracion/kit'
import { StatementTable } from '@/components/administracion/statement-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { exportHref, getPartyStatement, settleQuery } from '@/lib/accounting/queries'
import { ExportButton } from '../../../_components/export-button'
import { PeriodChips } from '../../../_components/period-chips'
import { periodLead } from '../../../_lib/libreta'
import { firstParam } from '../../../_lib/links'
import { periodPhrase, resolveListPeriod } from '../../../_lib/period'
import { toStatementView } from '../../../_lib/statement'
import {
  ledgerTrendTitle,
  statementBalancePoints,
  supplierLedger,
} from '../../../_lib/supplier-ledger'
import { LedgerLines } from './ledger-lines'

/** Movimientos por página (la base corta en 500; 200 se leen cómodos). */
const STATEMENT_PAGE = 200

/** Con menos movimientos que estos, la escalera no dice nada que la lista no diga. */
const MIN_STEPS = 3

const TITLE = 'Su libreta'

/** Mientras llega la libreta: los chips de período y unos renglones. */
export function StatementSkeleton() {
  return (
    <Panel title={TITLE}>
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">Cargando su libreta…</span>
        <div className="flex flex-wrap gap-1.5">
          {['w-36', 'w-24', 'w-28', 'w-24'].map((w) => (
            <Skeleton key={w} className={`h-11 rounded-full md:h-9 ${w}`} />
          ))}
        </div>
        <Skeleton className="h-6 w-80 max-w-full" />
        {['a', 'b', 'c', 'd'].map((k) => (
          <div key={k} className="flex items-center gap-4">
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    </Panel>
  )
}

/**
 * «Su libreta»: lo que te dejó, lo que le pagaste y lo que le debés, movimiento
 * por movimiento, con el saldo corrido que calcula la base.
 *
 * El dueño la ve como libreta: un título que afirma («En los últimos 90 días le
 * bajaste la deuda en $ X»), la escalera de la deuda (sube cuando te deja, baja
 * cuando le pagás) y los renglones con sus tres columnas. La contadora arranca
 * en la tabla de siempre (`StatementTable`: Fecha · Comprobante · Vence · Pagos
 * · Facturas · Saldo); cualquiera de los dos cambia con «Ver como tabla».
 *
 * Período por URL (`?periodo=`, 90 días por defecto), paginado (`?despues=`) y
 * exporte CSV del período: como siempre.
 */
export async function StatementTab({
  tenantId,
  tenantSlug,
  partyId,
  partyName,
  baseHref,
  sp,
  today,
  canWrite,
  unusedCreditCents,
}: {
  tenantId: string
  tenantSlug: string
  partyId: string
  partyName: string
  /** La hoja (`/compras/proveedores/[id]`). */
  baseHref: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
  canWrite: boolean
  /** Lo que hoy tiene a favor sin usar (de la tapa): la libreta ya lo restó y lo aclara. */
  unusedCreditCents: number
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
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
          label="Exportar este período"
          variant="ghost"
          className="h-11 self-start text-muted-foreground hover:text-foreground md:h-9 xl:self-auto"
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
    return <PanelError title={TITLE} message={outcome.message} />
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
  const ledger = supplierLedger({
    rows: page.rows,
    from: page.from,
    to: page.to,
    openingCents: page.openingCents,
    hasMore,
    today,
    unusedCreditCents,
  })
  const lineCount = ledger.lines.length
  const lead = periodLead(period)
  // La escalera y el título que afirma solo valen con el período entero a la vista.
  const whole = !after && !hasMore
  const title = whole
    ? (ledgerTrendTitle({
        lead,
        openingCents: page.openingCents ?? 0,
        closingCents: ledger.closing?.balanceCents ?? null,
        movements: lineCount,
      }) ?? `Sus movimientos, ${periodPhrase(period)}`)
    : `Sus movimientos, ${periodPhrase(period)}`
  const points =
    whole && lineCount >= MIN_STEPS
      ? statementBalancePoints({
          lines: ledger.lines,
          from: page.from,
          to: page.to,
          openingCents: page.openingCents ?? 0,
        })
      : []
  const todayIndex = points.findIndex((p) => p.date === today)
  const footnote = hasMore
    ? `Ves ${lineCount} de ${page.totalRows} movimientos. El saldo de cada renglón ya cuenta los anteriores.`
    : after
      ? 'Estás viendo los últimos movimientos del período.'
      : null

  return (
    <Panel title={TITLE} description="Lo que te dejó, lo que le pagaste y lo que le debés.">
      <div className="space-y-5">
        {toolbar}
        <ChartFrame
          title={title}
          // La contadora arranca en la tabla densa: para ella es el producto.
          defaultView={canWrite ? 'chart' : 'table'}
          chart={
            lineCount === 0 ? (
              <p className="rounded-xl bg-secondary/50 px-4 py-6 text-center text-sm text-muted-foreground text-pretty">
                No hubo movimientos {periodLead(period, { lower: true })}. Probá con otro período.
              </p>
            ) : (
              <div className="space-y-4">
                {points.length > 0 ? (
                  <BalanceArea
                    points={points}
                    todayIndex={todayIndex >= 0 ? todayIndex : null}
                    label="Le debés"
                    showLegend={false}
                    ariaLabel={`Lo que le debés a ${partyName}, día por día`}
                  />
                ) : null}
                <LedgerLines tenantSlug={tenantSlug} ledger={ledger} />
              </div>
            )
          }
          table={
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
            />
          }
          footer={footnote}
        />
        {hasMore || after ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {after ? (
              <Button asChild variant="outline" className="h-11 rounded-full px-5 md:h-9">
                <Link href={linkWith({})} scroll={false}>
                  Volver al principio
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {hasMore && page.nextCursor ? (
              <Button asChild variant="outline" className="h-11 gap-1.5 rounded-full px-5 md:h-9">
                <Link href={linkWith({ despues: page.nextCursor })} scroll={false}>
                  Ver los movimientos siguientes
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
