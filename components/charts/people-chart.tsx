'use client'

import { Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState } from '@/components/ui/empty-state'

export type PeoplePoint = { day: string; covers: number; arrived: number }

const dayLabel = (value: string, long = false) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(
    'es-AR',
    long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: '2-digit', month: 'short' },
  )

/**
 * La gente que vino, día por día. En barras y no en línea: cada día es una noche distinta (un
 * martes no «sigue» al lunes) y lo que se busca ver es el ritmo de la semana.
 */
export function PeopleChart({ data }: { data: PeoplePoint[] }) {
  if (data.every((point) => point.covers === 0)) {
    return (
      <EmptyState
        icon={Users}
        title="Todavía no hay gente marcada"
        description="Cuando marques «Llegó» en las reservas, acá vas a ver cuánta gente vino cada día."
        className="h-full border-0 bg-transparent py-8"
      />
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        <XAxis
          dataKey="day"
          tickFormatter={(value) => dayLabel(String(value))}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: 'var(--secondary)', opacity: 0.5 }}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 32px -12px rgb(0 0 0 / 0.5)',
            color: 'var(--popover-foreground)',
            fontSize: 12,
            padding: '8px 10px',
          }}
          labelStyle={{ color: 'var(--muted-foreground)', fontSize: 11, marginBottom: 4 }}
          formatter={(value, _name, item) => {
            const reservations = (item?.payload as PeoplePoint | undefined)?.arrived ?? 0
            return [
              `${Number(value).toLocaleString('es-AR')} personas en ${reservations} ${reservations === 1 ? 'reserva' : 'reservas'}`,
              'Vinieron',
            ]
          }}
          labelFormatter={(value) => dayLabel(String(value), true)}
        />
        <Bar dataKey="covers" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}
