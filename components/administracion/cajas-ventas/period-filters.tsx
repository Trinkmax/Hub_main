'use client'

import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addMonthsToYearMonth, formatMonthLabel, monthOf } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { RangeValue } from './periods'

/**
 * El período de una lista en la URL (`?mes=` o `?desde=&hasta=`), con las
 * flechas y los chips de Reservas y Libros: mismos tamaños (44 px en el
 * celular) y el mismo «pendiente» mientras carga. Cambiar de período conserva
 * los demás parámetros (pestaña, búsqueda) y vuelve a la primera página.
 */

const PERIOD_KEYS = ['mes', 'desde', 'hasta', 'despues', 'page'] as const

function usePeriodNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function go(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    for (const key of PERIOD_KEYS) next.delete(key)
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const qs = next.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  return { go, pending }
}

function Stepper({
  month,
  today,
  minMonth,
  pending,
  go,
}: {
  month: string
  today: string
  minMonth?: string | null
  pending: boolean
  go: (updates: Record<string, string | null>) => void
}) {
  const current = monthOf(today)
  const prev = addMonthsToYearMonth(month, -1)
  const next = addMonthsToYearMonth(month, 1)
  const canPrev = !minMonth || prev >= minMonth
  const canNext = next <= current
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 md:p-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:size-9"
        aria-label={`Mes anterior: ${formatMonthLabel(prev)}`}
        disabled={!canPrev || pending}
        onClick={() => go({ mes: prev })}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="flex items-center gap-2 px-1.5">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-[124px] text-center text-sm font-medium tabular-nums">
          {formatMonthLabel(month)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:size-9"
        aria-label={`Mes siguiente: ${formatMonthLabel(next)}`}
        disabled={!canNext || pending}
        onClick={() => go({ mes: next })}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

/** Un mes con flechas y «Este mes» cuando se mira otro (el calendario de cierres). */
export function MonthStepper({
  month,
  today,
  minMonth,
  className,
}: {
  /** `yyyy-MM`. */
  month: string
  today: string
  /** Primer mes con cuentas (`books_start_date`): antes no hay nada. */
  minMonth?: string | null
  className?: string
}) {
  const { go, pending } = usePeriodNavigation()
  const current = monthOf(today)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-busy={pending}>
      <Stepper month={month} today={today} minMonth={minMonth} pending={pending} go={go} />
      {month !== current ? (
        <Chip
          label="Este mes"
          active={false}
          disabled={pending}
          onClick={() => go({ mes: current })}
        />
      ) : null}
    </div>
  )
}

/** Un mes con flechas, «Este mes» y un rango a mano (listas, estados de cuenta, movimientos). */
export function RangeFilter({
  range,
  today,
  minMonth,
  className,
}: {
  range: RangeValue
  today: string
  minMonth?: string | null
  className?: string
}) {
  const { go, pending } = usePeriodNavigation()
  const current = monthOf(today)
  const isMonth = range.kind === 'month' && range.month !== null
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-busy={pending}>
      {isMonth && range.month ? (
        <Stepper month={range.month} today={today} minMonth={minMonth} pending={pending} go={go} />
      ) : (
        <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3">
          <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium tabular-nums">{range.label}</span>
        </div>
      )}
      <Chip
        label="Este mes"
        active={isMonth && range.month === current}
        disabled={pending}
        onClick={() => go({ mes: current })}
      />
      <RangePopover
        active={range.kind === 'range'}
        from={range.from}
        to={range.to}
        max={today}
        disabled={pending}
        onApply={(from, to) => go({ desde: from, hasta: to })}
      />
    </div>
  )
}

function RangePopover({
  active,
  from,
  to,
  max,
  disabled,
  onApply,
}: {
  active: boolean
  from: string
  to: string
  max: string
  disabled: boolean
  onApply: (from: string, to: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const invalid = Boolean(draftFrom && draftTo && draftFrom > draftTo)

  function apply() {
    if (!draftFrom && !draftTo) return
    // Un solo extremo cargado: un día concreto, no una lista abierta.
    const nextFrom = draftFrom || draftTo
    const nextTo = draftTo || draftFrom
    if (nextFrom > nextTo) return
    setOpen(false)
    onApply(nextFrom, nextTo)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraftFrom(from)
          setDraftTo(to)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={active}
          className={cn(
            'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:opacity-60',
            active
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          <CalendarRange className="size-4" aria-hidden />
          {active ? 'Rango elegido' : 'Rango'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Rango de fechas</p>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={draftFrom}
              max={max}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-11 text-base md:text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={draftTo}
              max={max}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-11 text-base md:text-sm"
            />
          </div>
        </div>
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            El «hasta» no puede ser anterior al «desde».
          </p>
        ) : null}
        <Button
          type="button"
          className="h-11 w-full"
          disabled={invalid || (!draftFrom && !draftTo)}
          onClick={apply}
        >
          Ver ese rango
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function Chip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-60',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
      )}
    >
      {label}
    </button>
  )
}
