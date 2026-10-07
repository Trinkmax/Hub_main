'use client'

import { LineChart as LineChartIcon } from 'lucide-react'
import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EmptyState } from '@/components/ui/empty-state'

type DailyPoint = { day: string; visits: number; revenue_cents: number }

export function RevenueChart({
  data,
  metric,
  compact = false,
}: {
  data: DailyPoint[]
  metric: 'visits' | 'revenue_cents'
  compact?: boolean
}) {
  const gradientId = useId()

  if (data.length === 0) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Sin datos en el rango"
        description="Cuando empieces a cerrar mesas, vas a ver acá la evolución día a día."
        className="h-full border-0 bg-transparent py-8"
      />
    )
  }

  const labelY = metric === 'visits' ? 'Visitas' : 'Revenue'
  const fmtY =
    metric === 'revenue_cents'
      ? (v: number) => `$${(v / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
      : (v: number) => v.toLocaleString('es-AR')

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: compact ? -16 : 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {!compact && (
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        )}
        <XAxis
          dataKey="day"
          tickFormatter={(v) => {
            const d = new Date(`${v}T00:00:00`)
            return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
          }}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          hide={compact}
        />
        <YAxis
          tickFormatter={fmtY}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          width={compact ? 0 : 56}
          hide={compact}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 32px -12px rgb(0 0 0 / 0.5)',
            color: 'var(--popover-foreground)',
            fontSize: 12,
            padding: '8px 10px',
          }}
          labelStyle={{
            color: 'var(--muted-foreground)',
            fontSize: 11,
            marginBottom: 4,
          }}
          formatter={(value) => [fmtY(Number(value)), labelY]}
          labelFormatter={(v) =>
            new Date(`${String(v)}T00:00:00`).toLocaleDateString('es-AR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })
          }
        />
        <Area
          type="monotone"
          dataKey={metric}
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{
            r: 4,
            stroke: 'var(--background)',
            strokeWidth: 2,
            fill: 'var(--chart-1)',
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
