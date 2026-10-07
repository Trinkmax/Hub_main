'use client'

import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addMonthsToYearMonth, formatMonthLabel, monthOf } from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * El período de los libros en la URL (H.12): `?mes=` o `?desde=&hasta=`. Las
 * flechas y los chips son los de Reservas (DayNavigator y RangeChips): mismos
 * tamaños, mismo «pendiente» mientras carga. Cambiar de período conserva los
 * demás filtros (cuenta, partícipe, nivel) y vuelve a la primera página.
 */

const PERIOD_KEYS = ['mes', 'desde', 'hasta', 'despues'] as const

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

/**
 * Libros mensuales (IVA compras y ventas, posición, paquete del mes):
 * ‹ Octubre 2026 › y «Este mes» cuando se mira otro.
 */
export function MonthPicker({
  month,
  today,
  minMonth,
  className,
}: {
  /** `yyyy-MM`. */
  month: string
  today: string
  /** Primer mes con libros (`books_start_date`): antes no hay nada. */
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

/**
 * Libros de rango (diario, mayor, sumas y saldos, subdiarios, historia):
 * el mes con flechas, «Este mes», «Ejercicio a la fecha» y un rango a mano.
 */
export function RangePicker({
  range,
  today,
  fiscalYear,
  minMonth,
  className,
}: {
  range: { kind: 'month' | 'range'; month: string | null; from: string; to: string; label: string }
  today: string
  /** El ejercicio en curso hasta hoy; `null` si no hay uno que contenga hoy. */
  fiscalYear?: { from: string; to: string } | null
  minMonth?: string | null
  className?: string
}) {
  const { go, pending } = usePeriodNavigation()
  const current = monthOf(today)
  const isMonth = range.kind === 'month' && range.month !== null
  const fyActive =
    Boolean(fiscalYear) &&
    range.kind === 'range' &&
    range.from === fiscalYear?.from &&
    range.to === fiscalYear?.to

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
      {fiscalYear ? (
        <Chip
          label="Ejercicio a la fecha"
          active={fyActive}
          disabled={pending}
          onClick={() => go({ desde: fiscalYear.from, hasta: fiscalYear.to })}
        />
      ) : null}
      <RangePopover
        active={range.kind === 'range' && !fyActive}
        from={range.from}
        to={range.to}
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
  disabled,
  onApply,
}: {
  active: boolean
  from: string
  to: string
  disabled: boolean
  onApply: (from: string, to: string) => void
}) {
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
            <Label htmlFor="libros-range-from" className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id="libros-range-from"
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-11 text-base md:text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="libros-range-to" className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id="libros-range-to"
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-11 text-base md:text-sm"
            />
          </div>
        </div>
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            El «desde» tiene que ser anterior al «hasta».
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
