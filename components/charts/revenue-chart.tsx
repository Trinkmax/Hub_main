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
import { capitalizeFirst, formatLongDate, MONTH_NAMES_SHORT } from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'

type DailyPoint = { day: string; visits: number; revenue_cents: number }

/**
 * Tipografía de los ejes y del tooltip: 12 px, el mínimo del kit (§2.11). Los
 * valores salen de los tokens, así el gráfico sigue al tema claro y al oscuro.
 */
const TICK_STYLE = { fontSize: 12, fill: 'var(--muted-foreground)' } as const

/** `'2026-09-15'` → `'15 sep'`, cortando el string: sin `Intl` ni corrimientos de zona. */
function shortDayLabel(iso: string): string {
  const month = MONTH_NAMES_SHORT[Number(iso.slice(5, 7)) - 1]
  return month ? `${iso.slice(8, 10)} ${month}` : iso
}

/**
 * Evolución diaria de visitas o facturación (recharts). La API (`data`,
 * `metric`, `compact`) la comparte el Resumen: no se cambia sin avisarle.
 *
 * - Plata con `formatCents` sin centavos y fechas armadas a mano: lo mismo
 *   que el resto del kit, sin depender del ICU del navegador.
 * - El tooltip flota (`--elevation-1`) con el borde del kit; nada más tiene
 *   sombra. El área no se anima al montar (quieto por defecto, §1.1).
 */
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
        size="sm"
        icon={LineChartIcon}
        title="Sin datos en el rango"
        description="Cuando empieces a cerrar mesas, vas a ver acá la evolución día a día."
        className="h-full"
      />
    )
  }

  const labelY = metric === 'visits' ? 'Visitas' : 'Facturación'
  const fmtY =
    metric === 'revenue_cents'
      ? (v: number) => formatCents(v, { decimals: 0 })
      : (v: number) => formatNumber(v)

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
          tickFormatter={(v) => shortDayLabel(String(v))}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          hide={compact}
        />
        <YAxis
          tickFormatter={fmtY}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          width={compact ? 0 : 72}
          hide={compact}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--elevation-1)',
            color: 'var(--popover-foreground)',
            fontSize: 13,
            padding: '8px 10px',
          }}
          labelStyle={{
            color: 'var(--muted-foreground)',
            fontSize: 12,
            marginBottom: 4,
          }}
          formatter={(value) => [fmtY(Number(value)), labelY]}
          labelFormatter={(v) => capitalizeFirst(formatLongDate(String(v))) || String(v)}
        />
        <Area
          type="monotone"
          dataKey={metric}
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          // Quieto por defecto (§1.1): el área no se dibuja de a poco cada vez
          // que se abre la pantalla, igual que el Sparkline.
          isAnimationActive={false}
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
