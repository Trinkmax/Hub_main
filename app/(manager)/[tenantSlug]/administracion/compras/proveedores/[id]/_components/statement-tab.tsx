import { ChevronRight, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
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
import {
  Planilla,
  PlanillaBar,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
} from '@/components/administracion/planilla'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import { exportHref, getPartyStatement, settleQuery } from '@/lib/accounting/queries'
import { formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ExportButton } from '../../../_components/export-button'
import { PeriodChips } from '../../../_components/period-chips'
import { ROW_LINK, SheetEmpty, SheetError } from '../../../_components/planilla-bits'
import { BarSkeleton, SheetSkeleton } from '../../../_components/planilla-skeleton'
import { periodLead } from '../../../_lib/libreta'
import { firstParam, newPurchaseHref } from '../../../_lib/links'
import { periodPhrase, resolveListPeriod } from '../../../_lib/period'
import { toStatementView } from '../../../_lib/statement'
import {
  ledgerTrendTitle,
  statementBalancePoints,
  supplierLedger,
  trimFlatStart,
} from '../../../_lib/supplier-ledger'

/** Movimientos por página (la base corta en 500; 200 se leen cómodos). */
const STATEMENT_PAGE = 200

/** Con menos movimientos que estos, la escalera no dice nada que la tabla no diga. */
const MIN_STEPS = 3

const BUTTON = 'h-10 gap-1.5 md:pointer-fine:h-8'

/** Mientras llega la cuenta: el período y unas filas. */
export function StatementSkeleton() {
  return (
    <>
      <BarSkeleton widths={['w-96']} />
      <SheetSkeleton rows={6} columns={3} />
    </>
  )
}

/** Cuántas fechas se rotulan en el eje de la escalera (entran en un celular de 360 px). */
const MAX_DAY_LABELS = 6

/**
 * La escalera de «Le debés»: sube cuando te deja algo y baja cuando le pagás. Va plegada debajo de la
 * tabla, que tiene los mismos números.
 *
 * Está armada acá, con las piezas de la familia de gráficos (`Plot`, `XTicks`,
 * `ChartMark`, `ChartTip` y la geometría de `scale`), porque esta cuenta
 * necesita dos cosas que `BalanceArea` no hace: un eje con el MES en cada marca
 * («16/07», no «16»: 90 días cruzan cuatro meses) y no rotular el punto más
 * bajo, que acá casi siempre es «$ 0» y no dice nada. Mismo dibujo: escalonada,
 * lavado al 10 %, 2 px, una sola etiqueta (hoy).
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
 * La cuenta corriente: Fecha · Comprobante · Vence · Debe · Haber · Saldo, con el saldo corrido que
 * calcula la base y la doble raya en el total. En un proveedor, Haber es lo que te dejó (aumenta la
 * deuda) y Debe lo que le pagaste. Toda la fila lleva al comprobante. El saldo a favor se dice con
 * palabras, nunca con un menos pelado.
 *
 * Período por URL (`?periodo=`, 90 días por defecto), paginado (`?despues=`) y exporte CSV del
 * período: como siempre. Debajo, plegada, la escalera de la deuda.
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
  /** Su cuenta corriente (`/compras/proveedores/[id]`). */
  baseHref: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
  canWrite: boolean
  /** Lo que hoy tiene a favor sin usar: el saldo de la tabla ya lo restó y se aclara. */
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

  const bar = (
    <>
      <PlanillaBar>
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
          size="sm"
          className="ml-auto h-10 text-muted-foreground hover:text-foreground md:pointer-fine:h-8"
        />
      </PlanillaBar>
      {period.error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-warning-text">
            {period.error} Te mostramos {periodPhrase(period)}.
          </p>
        </div>
      ) : null}
    </>
  )

  if (!outcome.ok) {
    return (
      <>
        {bar}
        <Planilla>
          <SheetError message={outcome.message} />
        </Planilla>
      </>
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

  // Sin movimientos: una oración, adentro de la hoja. En el período de entrada (casi todos los
  // proveedores el primer día) «probá con otro» no lleva a nada: se dice qué va a aparecer.
  if (lineCount === 0 && !after) {
    const firstDay = period.param === null
    return (
      <>
        {bar}
        <Planilla>
          <SheetEmpty
            action={
              firstDay && canWrite ? (
                <Button asChild variant="outline" size="sm" className={BUTTON}>
                  <Link
                    href={newPurchaseHref(tenantSlug, { proveedor: partyId, volver: baseHref })}
                  >
                    Cargar una compra
                  </Link>
                </Button>
              ) : undefined
            }
          >
            No hubo movimientos {periodLead(period, { lower: true })}.{' '}
            {firstDay
              ? 'Cuando le cargues una compra o un pago, queda acá.'
              : 'Probá con otro período.'}
          </SheetEmpty>
        </Planilla>
      </>
    )
  }

  // La escalera solo vale con el período entero a la vista.
  const whole = !after && !hasMore
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
  const trend = ledgerTrendTitle({
    lead: periodLead(period),
    openingCents: page.openingCents ?? 0,
    closingCents: ledger.closing?.balanceCents ?? null,
    movements: lineCount,
  })
  // dd/MM si todo el período es del mismo año.
  const dateOf = period.from.slice(0, 4) === period.to.slice(0, 4) ? formatDayMonth : formatIsoDay

  return (
    <>
      {bar}
      <Planilla>
        <PTable label={`Cuenta corriente de ${partyName}, ${period.label}`} minWidth={680}>
          <thead>
            <tr>
              <PTh>Fecha</PTh>
              <PTh>Comprobante</PTh>
              <PTh>Vence</PTh>
              <PTh align="right">Debe</PTh>
              <PTh align="right">Haber</PTh>
              <PTh align="right">Saldo</PTh>
            </tr>
          </thead>
          <tbody>
            {view.opening ? (
              <PRow className="text-muted-foreground">
                <PTd colSpan={5}>{view.opening.label}</PTd>
                <PTd align="right">
                  <Amount cents={view.opening.balanceCents} balance="payable" words="contrary" />
                </PTd>
              </PRow>
            ) : null}
            {view.rows.map((row) => {
              const due = row.dueDate ?? null
              const late = due !== null && !row.settled && due < today
              return (
                <PRow key={row.id} className={cn(row.href && 'relative')}>
                  <PTd className="whitespace-nowrap text-muted-foreground">{dateOf(row.date)}</PTd>
                  <PTd>
                    {row.href ? (
                      <Link href={row.href} className={ROW_LINK}>
                        <VoucherText text={row.voucher} />
                      </Link>
                    ) : (
                      <VoucherText text={row.voucher} />
                    )}
                    {row.detail ? (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">{row.detail}</span>
                    ) : null}
                  </PTd>
                  <PTd
                    className={cn(
                      'whitespace-nowrap',
                      late ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {due ? dateOf(due) : null}
                  </PTd>
                  <PTd align="right">{row.debitCents ? formatCents(row.debitCents) : null}</PTd>
                  <PTd align="right">{row.creditCents ? formatCents(row.creditCents) : null}</PTd>
                  <PTd align="right">
                    <Amount cents={row.balanceCents} balance="payable" words="contrary" />
                  </PTd>
                </PRow>
              )
            })}
          </tbody>
          {view.totals && view.closing ? (
            <tfoot>
              <PTotalRow>
                <PTd colSpan={3}>
                  Saldo
                  {unusedCreditCents > 0 ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ya restado {formatCentsShort(unusedCreditCents)} a favor
                    </span>
                  ) : null}
                </PTd>
                <PTd align="right">{formatCents(view.totals.debitCents)}</PTd>
                <PTd align="right">{formatCents(view.totals.creditCents)}</PTd>
                <PTd align="right">
                  <Amount cents={view.closing.balanceCents} balance="payable" words="contrary" />
                </PTd>
              </PTotalRow>
            </tfoot>
          ) : null}
        </PTable>

        {hasMore || after ? (
          <PlanillaFoot className="text-xs text-muted-foreground">
            <p>
              {hasMore
                ? `Ves ${lineCount} de ${page.totalRows} movimientos. El saldo de cada fila ya cuenta los anteriores.`
                : 'Estás viendo los últimos movimientos del período.'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {after ? (
                <Button asChild variant="outline" size="sm" className={BUTTON}>
                  <Link href={linkWith({})} scroll={false}>
                    Volver al principio
                  </Link>
                </Button>
              ) : null}
              {hasMore && page.nextCursor ? (
                <Button asChild variant="outline" size="sm" className={BUTTON}>
                  <Link href={linkWith({ despues: page.nextCursor })} scroll={false}>
                    Ver los siguientes
                    <ChevronRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </PlanillaFoot>
        ) : null}

        {drawable ? (
          <details className="group border-t border-border/70">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:pointer-fine:min-h-0 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              />
              Ver cómo fue la deuda
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {trend ? <p className="text-sm font-medium text-pretty">{trend}</p> : null}
              <DebtStairs
                points={points}
                todayIndex={todayIndex}
                ariaLabel={`Lo que le debés a ${partyName}, día por día`}
              />
            </div>
          </details>
        ) : null}
      </Planilla>
    </>
  )
}
