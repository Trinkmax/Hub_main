'use client'

import {
  Banknote,
  CalendarCheck,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Download,
  TrendingUp,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import { StatCard } from '@/components/ui/stat-card'
import { formatARS } from '@/lib/commissions/calculate'
import { formatDayLabel } from '@/lib/salon/date-presets'
import type { DepositsReport } from '@/lib/salon/deposits'
import { cn } from '@/lib/utils'
import { DepositsBarChart } from './deposits-bar-chart'

/** `2026-09` + 1 → `2026-10`. Aritmética en UTC: en local, un runtime en
 *  UTC-3 se corre de mes en el borde. */
function shiftYM(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** `2026-09-01` → `01/09/2026`, para el rótulo del histórico. */
function formatFullDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function DepositsDashboard({
  tenantSlug,
  report,
  currentYM,
  period,
}: {
  tenantSlug: string
  report: DepositsReport
  currentYM: string
  period: 'mes' | 'todo'
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const { totals, basis } = report
  const porCarga = basis === 'created'

  // El link del CSV se arma con el MISMO rango y criterio que está en pantalla:
  // si saliera de los searchParams crudos, un default implícito haría que la
  // planilla trajera otros números que los de arriba.
  const exportHref =
    `/api/senas/export?slug=${encodeURIComponent(tenantSlug)}` +
    `&from=${report.from}&to=${report.to}&fecha=${porCarga ? 'carga' : 'reserva'}`

  function push(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) params.set(key, value)
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  const periodLabel = period === 'todo' ? 'Total histórico' : 'Total del mes'
  const withMoneyDays = report.days.filter((d) => d.total_cents > 0)

  return (
    <div className={cn('space-y-6', pending && 'opacity-60 transition-opacity')}>
      {/* Barra de control: qué período y con qué criterio se lee el día. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {period === 'todo' ? (
            <>
              <h2 className="font-serif text-lg font-semibold">Todo el histórico</h2>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatFullDay(report.from)} → {formatFullDay(report.to)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => push({ periodo: 'mes' })}>
                Ver por mes
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                aria-label="Mes anterior"
                onClick={() => push({ month: shiftYM(currentYM, -1) })}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <h2 className="min-w-44 text-center font-serif text-lg font-semibold capitalize">
                {formatYM(currentYM)}
              </h2>
              <Button
                variant="outline"
                size="sm"
                aria-label="Mes siguiente"
                onClick={() => push({ month: shiftYM(currentYM, 1) })}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => push({ periodo: 'todo' })}
              >
                <CalendarRange className="size-3.5" />
                Todo el histórico
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <SlidingTabs
            size="sm"
            value={porCarga ? 'carga' : 'reserva'}
            onChange={(value) => push({ fecha: value })}
            tabs={[
              { value: 'reserva', label: 'Día de la reserva' },
              { value: 'carga', label: 'Día de carga' },
            ]}
          />
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a href={exportHref} download title="Descargar planilla (Excel / Sheets)">
              <Download className="size-4" />
              <span className="sr-only sm:not-sr-only">Exportar</span>
            </a>
          </Button>
        </div>
      </div>

      <p className="-mt-3 text-xs text-muted-foreground">
        {porCarga
          ? 'Cada seña cuenta el día en que se cargó la reserva en el sistema: es la plata que entró ese día.'
          : 'Cada seña cuenta el día en que la gente viene: es la plata que respalda cada fecha de servicio.'}
      </p>

      {porCarga ? (
        <p className="text-xs text-warning-text">
          Ojo: no se guarda la fecha en que se cobró la seña. Si una reserva se cargó tarde o se
          migró de otro sistema, cae el día de la carga, no el del cobro.
        </p>
      ) : null}

      {report.truncated ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-text">
          Hay más reservas de las que entran en una sola lectura: el total puede estar incompleto.
          Elegí un período más corto.
        </p>
      ) : null}

      {totals.reservations === 0 ? (
        <EmptyState
          icon={Banknote}
          title="Sin reservas en este período"
          description="Cuando cargues reservas con seña, vas a ver acá cuánta plata entró día por día."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={periodLabel}
              value={formatARS(totals.total_cents)}
              className="border-primary/60 bg-primary/5"
              hint={`${totals.with_deposit} de ${totals.reservations} reservas dejaron seña`}
            />
            <StatCard
              icon={CalendarCheck}
              iconClassName="text-success"
              label="Seña vigente"
              value={formatARS(totals.active_cents)}
              hint="Reservas en pie"
            />
            <StatCard
              icon={CircleSlash}
              iconClassName="text-destructive"
              label="Canceladas / No vino"
              value={formatARS(totals.fallen_cents)}
              hint={
                totals.fallen_cents > 0
                  ? `Canceladas ${formatARS(totals.cancelled_cents)} · No vino ${formatARS(totals.no_show_cents)}`
                  : 'No se cayó ninguna'
              }
            />
            <StatCard
              icon={TrendingUp}
              iconClassName="text-primary"
              label="Día más alto"
              value={totals.top_day ? formatARS(totals.top_day.total_cents) : '—'}
              hint={totals.top_day ? formatDayLabel(totals.top_day.day) : 'Sin señas todavía'}
            />
          </div>

          <div className="card-hairline rounded-xl border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <h2 className="font-serif text-lg font-semibold tracking-tight">Señas por día</h2>
              <ul className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <li className="inline-flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full bg-primary" />
                  Vigente
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full bg-destructive/55" />
                  Canceladas / No vino
                </li>
              </ul>
            </header>
            <div className="px-5 pb-5 pt-3">
              <DepositsBarChart
                days={report.days}
                median={totals.median_day_cents}
                avg={totals.avg_day_cents}
                daysWithDeposit={totals.days_with_deposit}
              />
            </div>
          </div>

          <div className="card-hairline rounded-xl border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div>
                <h2 className="font-serif text-lg font-semibold tracking-tight">Detalle por día</h2>
                <p className="text-xs text-muted-foreground">
                  Solo los días que dejaron plata. Los días sin seña están en el gráfico y en la
                  planilla.
                </p>
              </div>
            </header>
            {withMoneyDays.length === 0 ? (
              <EmptyState
                title="Ninguna reserva dejó seña"
                description={`Hubo ${totals.reservations} ${totals.reservations === 1 ? 'reserva' : 'reservas'} en el período, pero ninguna con seña cargada.`}
                className="m-3 border-0 bg-transparent"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-border/60 bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Día</th>
                      <th className="px-4 py-2 text-right font-medium">Reservas</th>
                      <th className="px-4 py-2 text-right font-medium">Con seña</th>
                      <th className="px-4 py-2 text-right font-medium">Vigente</th>
                      <th className="px-4 py-2 text-right font-medium">Canceladas / No vino</th>
                      <th className="px-4 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {withMoneyDays.map((d) => (
                      <tr key={d.day} className="hover:bg-secondary/30">
                        <td className="px-4 py-2 font-medium">{formatDayLabel(d.day)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {d.reservations}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {d.with_deposit}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatARS(d.active_cents)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {d.fallen_cents > 0 ? (
                            <span className="text-destructive">{formatARS(d.fallen_cents)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                          {formatARS(d.total_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-secondary/30">
                    <tr>
                      <td className="px-4 py-2 font-medium">{periodLabel}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {totals.reservations}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {totals.with_deposit}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {formatARS(totals.active_cents)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {formatARS(totals.fallen_cents)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                        {formatARS(totals.total_cents)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
