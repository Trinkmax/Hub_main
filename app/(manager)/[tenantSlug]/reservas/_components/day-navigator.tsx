'use client'

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DayCovers } from '@/lib/salon/covers'
import { cn } from '@/lib/utils'

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}

function formatDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(dt)
}

export function DayNavigator({
  tenantSlug,
  day,
  today,
  capacity,
}: {
  tenantSlug: string
  day: string
  today: string
  capacity: DayCovers | null
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function goTo(nextDay: string) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    next.set('day', nextDay)
    next.delete('from')
    next.delete('to')
    next.delete('page')
    startTransition(() => router.push(`/${tenantSlug}/reservas?${next.toString()}`))
  }

  const isToday = day === today
  const isOver = capacity ? capacity.used > capacity.total : false
  const isFull = capacity ? !isOver && capacity.used >= capacity.total * 0.9 : false

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 p-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día anterior"
          disabled={pending}
          onClick={() => goTo(shiftDay(day, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2 px-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="min-w-[150px] text-center text-sm font-medium capitalize tabular-nums">
            {formatDayLong(day)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día siguiente"
          disabled={pending}
          onClick={() => goTo(shiftDay(day, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <Input
        type="date"
        value={day}
        aria-label="Elegir fecha"
        onChange={(e) => {
          if (e.target.value) goTo(e.target.value)
        }}
        className="h-9 w-[150px]"
      />

      {!isToday ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => goTo(today)}>
          Hoy
        </Button>
      ) : null}

      {capacity ? (
        <div
          className={cn(
            'flex w-full items-baseline justify-between gap-x-3 rounded-lg border px-3 py-1.5',
            // `ml-auto` solo cuando la barra NO envolvió: si envuelve, el chip
            // queda huérfano flotando a la derecha en vez de ser una fila más.
            'sm:ml-auto sm:w-auto sm:flex-col sm:items-end sm:justify-start sm:gap-0 sm:leading-tight',
            // Mismos tokens de estado que el panel del salón (capacity-header),
            // no rose/amber crudos: es el mismo dato en dos pantallas.
            isOver
              ? 'border-destructive/50 bg-destructive/10'
              : isFull
                ? 'border-warning/50 bg-warning/10'
                : 'border-border/70 bg-card/60',
          )}
          title={
            capacity.eventos > 0
              ? `Cubiertos reservados / tope del salón (Planta Alta + Planta Baja). Incluye ${capacity.eventos} de reservas atadas a un evento: esa gente también ocupa mesa.`
              : 'Cubiertos reservados / tope del salón (Planta Alta + Planta Baja)'
          }
        >
          <span
            className={cn(
              'font-mono text-sm font-semibold tabular-nums',
              isOver ? 'text-destructive' : 'text-foreground',
            )}
          >
            Cubiertos {capacity.used}
            <span className="font-normal text-muted-foreground">/{capacity.total}</span>
          </span>
          {/* El desglose solo cuando hay algo que desglosar: "30 salón · 0 eventos"
              sería ruido los ~25 días del mes en que no cambia nada. */}
          {capacity.eventos > 0 ? (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {capacity.salon} salón · {capacity.eventos} eventos
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
