import { ChevronRight, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import {
  ChartMark,
  dayTitle,
  Plot,
  type XTick,
  XTicks,
} from '@/components/administracion/charts/chart-parts'
import { ChartTip } from '@/components/administracion/charts/chart-tip'
import {
  compactCents,
  labelIndexes,
  niceDomain,
  round2,
  slotX,
  stepAreaPath,
  stepLinePath,
  valueY,
} from '@/components/administracion/charts/scale'
import { Panel, PanelError } from '@/components/administracion/kit'
import { StatementTable } from '@/components/administracion/statement-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { exportHref, getPartyStatement, settleQuery } from '@/lib/accounting/queries'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
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
  trimFlatStart,
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
          {/* Los cuatro chips de período: la clave es el período, no el ancho (dos miden lo mismo). */}
          {[
            { key: 'ultimos-90', width: 'w-36' },
            { key: 'este-mes', width: 'w-24' },
            { key: 'mes-pasado', width: 'w-28' },
            { key: 'este-anio', width: 'w-24' },
          ].map((chip) => (
            <Skeleton key={chip.key} className={`h-11 rounded-full md:h-9 ${chip.width}`} />
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

/** Cuántas fechas se rotulan en el eje de la escalera (entran en un celular de 360 px). */
const MAX_DAY_LABELS = 6

/**
 * La escalera de «Le debés»: sube cuando te deja algo y baja cuando le pagás.
 *
 * Está armada acá, con las piezas de la familia de gráficos (`Plot`, `XTicks`,
 * `ChartMark`, `ChartTip` y la geometría de `scale`), porque esta libreta
 * necesita dos cosas que `BalanceArea` no hace: un eje con el MES en cada marca
 * («16/07», no «16»: 90 días cruzan cuatro meses) y no rotular el punto más
 * bajo, que acá casi siempre es «$ 0» y no dice nada. Mismo dibujo: escalonada,
 * lavado al 10 %, 2 px, una sola etiqueta (hoy). Los mismos números están en los
 * renglones de abajo y en «Ver como tabla».
 */
function DebtStairs({
  points,
  todayIndex,
  ariaLabel,
}: {
  points: ReadonlyArray<{ date: string; cents: number }>
  /** El índice de hoy en `points`; `-1` si el período no llega a hoy. */
  todayIndex: number
  ariaLabel: string
}) {
  const n = points.length
  const values = points.map((p) => (Number.isFinite(p.cents) ? p.cents : 0))
  const domain = niceDomain(0, Math.max(...values), 3)
  const ys = values.map((v) => valueY(v, domain.min, domain.max))
  const zeroY = valueY(0, domain.min, domain.max)
  const focus = todayIndex >= 0 && todayIndex < n ? todayIndex : n - 1
  const isToday = focus === todayIndex
  const focusX = slotX(focus, n)
  const focusY = ys[focus] ?? zeroY
  const focusValue = values[focus] ?? 0
  const area = stepAreaPath(ys, zeroY)
  const line = stepLinePath(ys)

  // La etiqueta va arriba del punto, salvo que por ese lado la deuda venga de más alto
  // (la línea pasaría por encima del texto): ahí baja al lavado.
  const reach = Math.max(1, Math.ceil(n * 0.25))
  const highestNear = Math.min(...ys.slice(Math.max(0, focus - reach), focus + 1))
  const labelBelow = focusY - highestNear > 8 && focusY < 84

  const shown = new Set(labelIndexes(n, MAX_DAY_LABELS, [focus]))
  const xTicks: XTick[] = points.map((p, i) =>
    shown.has(i)
      ? { key: p.date, bottom: formatDayMonth(p.date), strong: i === focus }
      : { key: p.date },
  )

  return (
    <ChartTip>
      <Plot
        ticks={domain.ticks.map((t) => ({
          pos: valueY(t, domain.min, domain.max),
          label: compactCents(t),
          strong: t === 0,
        }))}
        xAxis={<XTicks items={xTicks} />}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {area ? <path d={area} fill="var(--adm-s1)" fillOpacity={0.1} /> : null}
          {line ? (
            <path
              d={line}
              fill="none"
              stroke="var(--adm-s1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {isToday ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-foreground/25"
            style={{ left: `${focusX}%` }}
          />
        ) : null}

        <div className="absolute inset-0 flex">
          {points.map((p, i) => {
            const value = values[i] ?? 0
            const title = `${dayTitle(p.date)}${i === todayIndex ? ' (hoy)' : ''}`
            const owed = value > 0 ? formatCentsShort(value) : 'nada'
            return (
              <ChartMark
                key={p.date}
                label={`${title}: le debías ${owed}`}
                tipTitle={title}
                tipValue={value > 0 ? formatCentsShort(value) : 'Nada'}
                tipSub="Le debés"
                className="h-full min-w-0 flex-1 rounded-[3px]"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/25 opacity-0 group-data-[tip-active]/mark:opacity-100"
                />
                <span
                  data-tip-anchor
                  aria-hidden
                  className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-adm-s1 opacity-0 ring-2 ring-card group-data-[tip-active]/mark:opacity-100"
                  style={{ top: `${ys[i] ?? zeroY}%` }}
                />
              </ChartMark>
            )
          })}
        </div>

        <span
          aria-hidden
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-adm-s1 ring-2 ring-card"
          style={{ left: `${focusX}%`, top: `${focusY}%` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute z-[2] rounded-sm bg-card/85 px-1 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-foreground tabular-nums"
          style={{
            right: `${round2(100 - focusX)}%`,
            ...(labelBelow
              ? { top: `calc(${focusY}% + 9px)` }
              : { bottom: `calc(${round2(100 - focusY)}% + 9px)` }),
          }}
        >
          {isToday ? 'Hoy' : formatDayMonth(points[focus]?.date ?? '')} · {compactCents(focusValue)}
        </span>
      </Plot>
    </ChartTip>
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
  // Sin la raya plana del principio: el eje arranca unos días antes del primer movimiento.
  const points =
    whole && lineCount >= MIN_STEPS
      ? trimFlatStart(
          statementBalancePoints({
            lines: ledger.lines,
            from: page.from,
            to: page.to,
            openingCents: page.openingCents ?? 0,
          }),
        )
      : []
  const drawable = points.length > 1 && points.some((p) => p.cents > 0)
  const todayIndex = points.findIndex((p) => p.date === today)
  const footnote = hasMore
    ? `Ves ${lineCount} de ${page.totalRows} movimientos. El saldo de cada renglón ya cuenta los anteriores.`
    : after
      ? 'Estás viendo los últimos movimientos del período.'
      : null

  // Sin movimientos: una sola frase. Ni el título que la repite ni «Ver como tabla»
  // para una tabla vacía (es el estado de casi todos los proveedores el primer día).
  if (lineCount === 0 && !after) {
    return (
      <Panel title={TITLE} description="Lo que te dejó, lo que le pagaste y lo que le debés.">
        <div className="space-y-5">
          {toolbar}
          <p className="rounded-xl bg-secondary/50 px-4 py-5 text-sm text-muted-foreground text-pretty">
            No hubo movimientos {periodLead(period, { lower: true })}.{' '}
            {/* En el período de entrada (casi todos los proveedores el primer día) «probá con
                otro» no lleva a nada: se dice qué va a aparecer. */}
            {period.param === null
              ? 'Cuando le cargues una compra o un pago, queda anotado acá.'
              : 'Probá con otro período.'}
          </p>
        </div>
      </Panel>
    )
  }

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
              <p className="rounded-xl bg-secondary/50 px-4 py-5 text-sm text-muted-foreground text-pretty">
                No hay más movimientos {periodLead(period, { lower: true })}.
              </p>
            ) : (
              <div className="space-y-4">
                {drawable ? (
                  <DebtStairs
                    points={points}
                    todayIndex={todayIndex}
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
