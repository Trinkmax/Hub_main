import Link from 'next/link'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
} from '@/components/ui/data-table'
import {
  type CashDailyLabels,
  type CashDailySeries,
  cashDailyBalanceText,
} from '@/lib/accounting/cash-daily'
import { formatDayLabel } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

const DAY_LINK =
  'rounded-sm text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Los mismos datos de «Cómo se movió la plata» como un resumen de cuenta: lo
 * que había antes y los días con movimiento (en los demás siguió igual). Es lo
 * que se ve con «Ver como tabla». Tabla en la compu, lista en el celular.
 *
 * Con `dayHref` (cuando se mira UNA caja) la fecha de cada fila lleva a lo que
 * pasó ese día en esa caja.
 */
export function CashDailyTable({
  series,
  labels,
  caption,
  dayHref,
}: {
  series: CashDailySeries
  labels: CashDailyLabels
  caption: string
  dayHref?: (day: string) => string
}) {
  const moved = series.points.filter((p) => p.moved)
  const skipped = series.points.length - moved.length
  const opening = `${labels.balance} anterior`
  const alarm = (cents: number) => series.mode === 'money' && cents < 0
  const flows = (up: number, down: number) =>
    `${labels.up} ${formatCents(up)} · ${labels.down} ${formatCents(down)}`
  const day = (iso: string) =>
    dayHref ? (
      <Link href={dayHref(iso)} className={DAY_LINK}>
        {formatDayLabel(iso)}
      </Link>
    ) : (
      formatDayLabel(iso)
    )
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
                    className="transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-cream-tint"
                  >
                    <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {day(p.day)}
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
                <span className="block text-sm">{day(p.day)}</span>
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
