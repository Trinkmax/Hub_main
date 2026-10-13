'use client'

import { ChartLine, Table2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useMemo, useOptimistic, useState, useTransition } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CASH_CHART_ACCOUNT_PARAM,
  CASH_CHART_ALL,
  CASH_CHART_DEFAULT_RANGE,
  CASH_CHART_RANGE_PARAM,
  CASH_DAILY_LABELS,
  type CashChartRangeKey,
  type CashChartRangeOption,
  type CashDailyLabels,
  type CashDailyMode,
  type CashDailyPoint,
  type CashDailySeries,
  type CashDailyView,
  cashDailyBalanceText,
  formatAxisCents,
} from '@/lib/accounting/cash-daily'
import { formatDayLabel, formatDayMonth } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Los colores salen de los tokens del tema (claro y oscuro). Lo que entra a
 * una caja va en verde y lo que sale en rojo, como en «Movimientos de una
 * caja»; en la tarjeta de la empresa, los pagos en verde y los consumos en
 * rojo. Además de por color se distinguen por el sentido de la barra.
 */
const BALANCE_COLOR = 'var(--chart-1)'
const FLOW_COLORS: Readonly<Record<CashDailyMode, { up: string; down: string }>> = {
  money: { up: 'var(--success)', down: 'var(--destructive)' },
  card: { up: 'var(--destructive)', down: 'var(--success)' },
}
const FLOW_OPACITY = 0.6

type ChartRow = { day: string; up: number; down: number; balance: number }

/**
 * `?grafico=` en la URL sin pedir la página de nuevo: todas las cajas ya están
 * acá. Next sincroniza `replaceState` con `useSearchParams` (docs «Native
 * History API») solo si el estado NO es el suyo: por eso va `null` y no
 * `window.history.state`.
 */
function syncAccountParam(value: string) {
  const url = new URL(window.location.href)
  if (value === CASH_CHART_ALL) url.searchParams.delete(CASH_CHART_ACCOUNT_PARAM)
  else url.searchParams.set(CASH_CHART_ACCOUNT_PARAM, value)
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

/**
 * «Cómo se movió la plata»: el saldo al final de cada día (línea) y lo que
 * entró y salió ese día (barras, detrás). Elige la caja (`?grafico=`, sin ir
 * al servidor) y el período (`?periodo=`), dice el gráfico en palabras arriba
 * y lo muestra como tabla con «Ver como tabla».
 */
export function CashDailyChart({
  views,
  ranges,
  rangeKey,
  rangeLabel,
}: {
  /** «Todas las cajas» primero y después cada caja. */
  views: readonly CashDailyView[]
  ranges: readonly CashChartRangeOption[]
  rangeKey: CashChartRangeKey
  /** «13/09 – 12/10/2026». */
  rangeLabel: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  // El chip cambia al tocarlo; el gráfico, cuando llega el período nuevo.
  const [shownRange, setShownRange] = useOptimistic(rangeKey)
  const [asTable, setAsTable] = useState(false)
  const id = useId()

  // La URL manda: «atrás» y un link compartido muestran la misma caja.
  const requested = searchParams.get(CASH_CHART_ACCOUNT_PARAM) ?? CASH_CHART_ALL
  const view = views.find((v) => v.value === requested) ?? views[0]

  function goToRange(next: CashChartRangeKey) {
    if (next === shownRange) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === CASH_CHART_DEFAULT_RANGE) params.delete(CASH_CHART_RANGE_PARAM)
    else params.set(CASH_CHART_RANGE_PARAM, next)
    const qs = params.toString()
    startTransition(() => {
      setShownRange(next)
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  if (!view) return null
  const { series } = view
  const labels = CASH_DAILY_LABELS[series.mode]

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="grid w-full gap-1.5 sm:w-64">
          <Label htmlFor={`${id}-caja`}>Caja o cuenta</Label>
          <Select value={view.value} onValueChange={syncAccountParam}>
            <SelectTrigger
              id={`${id}-caja`}
              className="w-full data-[size=default]:h-11 md:data-[size=default]:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {views.map((v) => (
                <SelectItem key={v.value} value={v.value} className="min-h-11 md:min-h-9">
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ChoiceChips
          label="Período del gráfico"
          options={ranges.map((r) => ({ value: r.key, label: r.label }))}
          value={shownRange}
          onChange={goToRange}
        />
      </div>

      {/* Mientras llega otro período se queda lo anterior, atenuado: sin saltos. */}
      <div
        aria-busy={pending}
        className={cn(
          'space-y-4 transition-opacity duration-[var(--duration-fast)]',
          pending && 'opacity-60',
        )}
      >
        {series.hasMovements ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-xs tabular-nums text-muted-foreground">
                  {view.label} · {rangeLabel}
                </p>
                <p className="max-w-2xl text-sm text-pretty">{view.summary}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 gap-2 md:h-8"
                onClick={() => setAsTable((v) => !v)}
              >
                {asTable ? (
                  <ChartLine className="size-3.5" aria-hidden />
                ) : (
                  <Table2 className="size-3.5" aria-hidden />
                )}
                {asTable ? 'Ver como gráfico' : 'Ver como tabla'}
              </Button>
            </div>

            {asTable ? (
              <DailyTable
                series={series}
                labels={labels}
                caption={`${view.label}, ${rangeLabel}`}
              />
            ) : (
              <>
                <Legend mode={series.mode} labels={labels} />
                <div className="h-64 sm:h-72">
                  <DailyChart series={series} labels={labels} title={view.summary} />
                </div>
              </>
            )}
            {view.note ? <p className="text-xs text-muted-foreground">{view.note}</p> : null}
          </>
        ) : (
          <EmptyState
            icon={ChartLine}
            title="No hubo movimientos en este período"
            description={`${view.label} · ${rangeLabel}. ${view.summary}`}
            className="border-0 bg-transparent py-8"
          />
        )}
      </div>
    </div>
  )
}

/** Qué es cada cosa, con palabras: la línea, y las barras hacia arriba y hacia abajo. */
function Legend({ mode, labels }: { mode: CashDailyMode; labels: CashDailyLabels }) {
  const colors = FLOW_COLORS[mode]
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-0.5 w-4 rounded-full"
          style={{ background: BALANCE_COLOR }}
        />
        {labels.balance} al final de cada día
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-[3px]"
          style={{ background: colors.up, opacity: FLOW_OPACITY }}
        />
        {labels.up} (barra hacia arriba)
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-[3px]"
          style={{ background: colors.down, opacity: FLOW_OPACITY }}
        />
        {labels.down} (barra hacia abajo)
      </li>
    </ul>
  )
}

function DailyChart({
  series,
  labels,
  title,
}: {
  series: CashDailySeries
  labels: CashDailyLabels
  title: string
}) {
  const colors = FLOW_COLORS[series.mode]
  const rows = useMemo<ChartRow[]>(
    () =>
      series.points.map((p) => ({
        day: p.day,
        up: p.upCents,
        // Hacia abajo del cero: así entrada y salida no se distinguen solo por el color.
        down: -p.downCents,
        balance: p.balanceCents,
      })),
    [series.points],
  )
  const byDay = useMemo(() => new Map(series.points.map((p) => [p.day, p])), [series.points])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        stackOffset="sign"
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        title={`${labels.balance} por día`}
        desc={title}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        <XAxis
          dataKey="day"
          tickFormatter={(v) => formatDayMonth(String(v))}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatAxisCents(Number(v))}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          width={68}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          content={({ active, label }) => {
            const point = active ? byDay.get(String(label)) : undefined
            return point ? <DayTooltip point={point} mode={series.mode} labels={labels} /> : null
          }}
        />
        {/* Las barras primero: quedan detrás de la línea del saldo. */}
        <Bar
          dataKey="up"
          name={labels.up}
          stackId="flow"
          fill={colors.up}
          fillOpacity={FLOW_OPACITY}
          radius={[3, 3, 0, 0]}
          maxBarSize={20}
          animationDuration={300}
        />
        <Bar
          dataKey="down"
          name={labels.down}
          stackId="flow"
          fill={colors.down}
          fillOpacity={FLOW_OPACITY}
          radius={[3, 3, 0, 0]}
          maxBarSize={20}
          animationDuration={300}
        />
        <Line
          type="linear"
          dataKey="balance"
          name={labels.balance}
          stroke={BALANCE_COLOR}
          strokeWidth={2}
          // Con un solo día no hay línea que trazar: se ve el punto.
          dot={rows.length === 1 ? { r: 4, fill: BALANCE_COLOR, strokeWidth: 0 } : false}
          activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2, fill: BALANCE_COLOR }}
          animationDuration={300}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function DayTooltip({
  point,
  mode,
  labels,
}: {
  point: CashDailyPoint
  mode: CashDailyMode
  labels: CashDailyLabels
}) {
  const colors = FLOW_COLORS[mode]
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-[0_8px_32px_-12px_rgb(0_0_0/0.5)]">
      <p className="mb-1 text-[11px] text-muted-foreground">{formatDayLabel(point.day)}</p>
      <dl className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-0.5 tabular-nums">
        <dt className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0.5 w-3 rounded-full"
            style={{ background: BALANCE_COLOR }}
          />
          {labels.balance}
        </dt>
        <dd className="text-right font-medium">{cashDailyBalanceText(mode, point.balanceCents)}</dd>
        {point.moved ? (
          <>
            <dt className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-[2px]"
                style={{ background: colors.up, opacity: FLOW_OPACITY }}
              />
              {labels.up}
            </dt>
            <dd className="text-right">{formatCents(point.upCents)}</dd>
            <dt className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-[2px]"
                style={{ background: colors.down, opacity: FLOW_OPACITY }}
              />
              {labels.down}
            </dt>
            <dd className="text-right">{formatCents(point.downCents)}</dd>
          </>
        ) : null}
      </dl>
      {point.moved ? null : <p className="mt-1 text-muted-foreground">Sin movimientos</p>}
    </div>
  )
}

/**
 * Los mismos datos del gráfico como un resumen de cuenta: el saldo anterior y
 * los días con movimiento (en los demás el saldo siguió igual). Tabla en la
 * compu, lista en el celular.
 */
function DailyTable({
  series,
  labels,
  caption,
}: {
  series: CashDailySeries
  labels: CashDailyLabels
  caption: string
}) {
  const moved = series.points.filter((p) => p.moved)
  const skipped = series.points.length - moved.length
  const opening = `${labels.balance} anterior`
  const alarm = (cents: number) => series.mode === 'money' && cents < 0
  const flows = (up: number, down: number) =>
    `${labels.up} ${formatCents(up)} · ${labels.down} ${formatCents(down)}`
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border/60">
        <div className="hidden sm:block">
          <DataTableScroll>
            <DataTableRoot>
              <caption className="sr-only">{caption}</caption>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Día</DataTableHeader>
                  <DataTableHeader className="text-right">{labels.up}</DataTableHeader>
                  <DataTableHeader className="text-right">{labels.down}</DataTableHeader>
                  <DataTableHeader className="text-right">{labels.balance}</DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                <tr className="text-muted-foreground">
                  <DataTableCell colSpan={3}>{opening}</DataTableCell>
                  <DataTableCell
                    className={cn(
                      'text-right tabular-nums whitespace-nowrap',
                      alarm(series.openingCents) && 'text-destructive',
                    )}
                  >
                    {cashDailyBalanceText(series.mode, series.openingCents)}
                  </DataTableCell>
                </tr>
                {moved.map((p) => (
                  <tr
                    key={p.day}
                    className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                  >
                    <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDayLabel(p.day)}
                    </DataTableCell>
                    <DataTableCell className="text-right tabular-nums">
                      {p.upCents > 0 ? formatCents(p.upCents) : null}
                    </DataTableCell>
                    <DataTableCell className="text-right tabular-nums">
                      {p.downCents > 0 ? formatCents(p.downCents) : null}
                    </DataTableCell>
                    <DataTableCell
                      className={cn(
                        'text-right font-medium tabular-nums whitespace-nowrap',
                        alarm(p.balanceCents) && 'text-destructive',
                      )}
                    >
                      {cashDailyBalanceText(series.mode, p.balanceCents)}
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
              <tfoot className="bg-secondary/30 font-semibold">
                <tr className="border-t border-border">
                  <DataTableCell className="text-xs">Total del período</DataTableCell>
                  <DataTableCell className="text-right tabular-nums">
                    {formatCents(series.upCents)}
                  </DataTableCell>
                  <DataTableCell className="text-right tabular-nums">
                    {formatCents(series.downCents)}
                  </DataTableCell>
                  <DataTableCell
                    className={cn(
                      'text-right tabular-nums whitespace-nowrap',
                      alarm(series.closingCents) && 'text-destructive',
                    )}
                  >
                    {cashDailyBalanceText(series.mode, series.closingCents)}
                  </DataTableCell>
                </tr>
              </tfoot>
            </DataTableRoot>
          </DataTableScroll>
        </div>

        {/* Celular: cada día con su saldo; lo que entró y salió, debajo (la tabla no entra). */}
        <ul aria-label={caption} className="divide-y divide-border/60 sm:hidden">
          <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
            <span>{opening}</span>
            <span
              className={cn(
                'shrink-0 tabular-nums',
                alarm(series.openingCents) && 'text-destructive',
              )}
            >
              {cashDailyBalanceText(series.mode, series.openingCents)}
            </span>
          </li>
          {moved.map((p) => (
            <li key={p.day} className="flex items-start justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm">{formatDayLabel(p.day)}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {flows(p.upCents, p.downCents)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    'block text-sm font-medium tabular-nums',
                    alarm(p.balanceCents) && 'text-destructive',
                  )}
                >
                  {cashDailyBalanceText(series.mode, p.balanceCents)}
                </span>
                <span className="block text-[11px] text-muted-foreground">{labels.balance}</span>
              </span>
            </li>
          ))}
          <li className="flex items-start justify-between gap-3 bg-secondary/30 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Total del período</span>
              <span className="block text-xs tabular-nums text-muted-foreground">
                {flows(series.upCents, series.downCents)}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span
                className={cn(
                  'block text-sm font-semibold tabular-nums',
                  alarm(series.closingCents) && 'text-destructive',
                )}
              >
                {cashDailyBalanceText(series.mode, series.closingCents)}
              </span>
              <span className="block text-[11px] text-muted-foreground">{labels.balance}</span>
            </span>
          </li>
        </ul>
      </div>
      {skipped > 0 ? (
        <p className="text-xs text-muted-foreground">
          Los días que no aparecen no tuvieron movimientos: el saldo siguió igual.
        </p>
      ) : null}
    </div>
  )
}
