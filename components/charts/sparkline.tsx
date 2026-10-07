'use client'

import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

/**
 * La línea chiquita debajo de un KPI. Es decorativa (el número del KPI ya dice
 * lo que importa): va oculta para el lector de pantalla y sin la capa de
 * teclado de recharts, que la volvía una parada de Tab sin nada que leer.
 * Quieta: no se anima al montar. API compartida con el Resumen.
 */
export function Sparkline({
  data,
  dataKey = 'value',
  color = 'var(--chart-1)',
  height = 48,
}: {
  data: Array<Record<string, number | string>>
  dataKey?: string
  color?: string
  height?: number
}) {
  const id = useId()

  if (data.length === 0) {
    return <div className="h-full w-full rounded-md bg-secondary" style={{ height }} aria-hidden />
  }

  return (
    <div aria-hidden="true" className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
