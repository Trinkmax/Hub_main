'use client'

import { ChevronRight as ArrowRight, ChevronLeft, ChevronRight, Coins } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { formatARS } from '@/lib/commissions/calculate'
import type { CommissionSummaryRow } from '@/lib/salon/queries'

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

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

export function CommissionsDashboard({
  tenantSlug,
  currentYM,
  from,
  to,
  summary,
}: {
  tenantSlug: string
  currentYM: string
  from: string
  to: string
  summary: CommissionSummaryRow[]
}) {
  const router = useRouter()
  const totals = useMemo(
    () =>
      summary.reduce(
        (acc, s) => {
          acc.payable += s.payable_cents
          acc.paid += s.paid_cents
          acc.pending += s.pending_cents
          acc.guests += s.guests_total
          acc.reservations += s.reservations_count
          return acc
        },
        { payable: 0, paid: 0, pending: 0, guests: 0, reservations: 0 },
      ),
    [summary],
  )

  const chartData = summary
    .filter((s) => s.payable_cents > 0)
    .map((s, i) => ({
      name: s.manager.display_name,
      value: s.payable_cents,
      color: COLORS[i % COLORS.length],
    }))

  function gotoMonth(next: string) {
    router.push(`/${tenantSlug}/estadisticas/comisiones?month=${next}`)
  }

  return (
    <div className="space-y-6">
      {/* Selector de mes */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => gotoMonth(shiftYM(currentYM, -1))}>
          <ChevronLeft className="size-4" /> Mes anterior
        </Button>
        <h2 className="font-serif text-lg font-semibold capitalize">{formatYM(currentYM)}</h2>
        <Button variant="outline" size="sm" onClick={() => gotoMonth(shiftYM(currentYM, 1))}>
          Mes siguiente <ChevronRight className="size-4" />
        </Button>
      </div>

      {summary.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Sin comisiones en este período"
          description="Las comisiones se generan cuando las reservas se cierran con cantidad real cargada."
        />
      ) : (
        <>
          {/* Totales del período */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Total a liquidar"
              value={formatARS(totals.payable)}
              className="border-primary/60 bg-primary/5"
            />
            <StatCard label="Ya cobrado" value={formatARS(totals.paid)} />
            <StatCard
              label="Pendiente"
              value={formatARS(totals.pending)}
              hint={totals.pending > 0 ? 'Falta cobrar' : undefined}
            />
          </div>

          {/* Chart + tabla */}
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <div className="card-hairline rounded-xl border bg-card p-4">
              <h3 className="mb-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
                Distribución
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {chartData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatARS(Number(value ?? 0))}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-1 pt-2 text-xs">
                {chartData.map((d) => (
                  <li key={d.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="truncate">{d.name}</span>
                    </span>
                    <span className="font-mono tabular-nums">{formatARS(d.value)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-hairline overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border/60 bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Gestor</th>
                    <th className="px-3 py-2 text-right">Reservas</th>
                    <th className="px-3 py-2 text-right">Personas</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">Bonus</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Cobrado</th>
                    <th className="px-3 py-2 text-right">Pendiente</th>
                    <th className="px-3 py-2 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {summary.map((s) => (
                    <tr key={s.manager.id} className="hover:bg-secondary/30">
                      <td className="px-3 py-2 font-medium">{s.manager.display_name}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {s.reservations_count}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {s.guests_total}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatARS(s.base_cents)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {s.bonus_cents > 0 ? (
                          <span className="text-warning">{formatARS(s.bonus_cents)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        {formatARS(s.payable_cents)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                        {formatARS(s.paid_cents)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {s.pending_cents > 0 ? (
                          <span className="text-warning">{formatARS(s.pending_cents)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button asChild variant="ghost" size="sm" className="gap-1">
                          <Link
                            href={`/${tenantSlug}/estadisticas/comisiones/${s.manager.id}?from=${from}&to=${to}`}
                          >
                            Detalle
                            <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
