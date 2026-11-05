'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addMonthsToYearMonth, formatMonthLabel, monthOf } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { SEG_ITEM, SEG_OFF, SEG_ON, SEG_ROOT } from './seg'

/**
 * El período de los libros en la URL (H.12): `?mes=` o `?desde=&hasta=`. Es un segmento chico, como
 * en un sistema contable: Mes · Ejercicio · Rango. Cambiar de período conserva los demás filtros
 * (cuenta, partícipe, nivel) y vuelve a la primera página; mientras carga, todo queda «pendiente».
 *
 * Mismos parámetros y mismo teclado de siempre: con el mes elegido van sus flechas y tocar el nombre
 * vuelve al mes de hoy.
 */

const PERIOD_KEYS = ['mes', 'desde', 'hasta', 'despues'] as const

/** Las flechas: angostas, pero con el alto del segmento. */
const STEP = 'px-2 md:pointer-fine:px-1.5'

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

function MonthPiece({
  month,
  active,
  today,
  minMonth,
  pending,
  go,
}: {
  /** `yyyy-MM`. */
  month: string
  /** Es el período elegido (si no, el botón lleva a este mes). */
  active: boolean
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
    <>
      {active ? (
        <button
          type="button"
          className={cn(SEG_ITEM, SEG_OFF, STEP)}
          aria-label={`Mes anterior: ${formatMonthLabel(prev)}`}
          disabled={!canPrev || pending}
          onClick={() => go({ mes: prev })}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        // El mes de hoy elegido no lleva a ningún lado, pero es lo que se está viendo: no se apaga.
        className={cn(
          SEG_ITEM,
          active ? SEG_ON : SEG_OFF,
          'min-w-28',
          active && 'disabled:opacity-100',
        )}
        aria-pressed={active}
        aria-label={
          active && month !== current
            ? `${formatMonthLabel(month)}. Volver a este mes`
            : formatMonthLabel(month)
        }
        disabled={pending || (active && month === current)}
        onClick={() => go({ mes: current })}
      >
        {formatMonthLabel(month)}
      </button>
      {active ? (
        <button
          type="button"
          className={cn(SEG_ITEM, SEG_OFF, STEP)}
          aria-label={`Mes siguiente: ${formatMonthLabel(next)}`}
          disabled={!canNext || pending}
          onClick={() => go({ mes: next })}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      ) : null}
    </>
  )
}

/** Libros mensuales (IVA compras y ventas, posición): ‹ Octubre 2026 ›. */
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
  return (
    <fieldset aria-busy={pending} className={cn(SEG_ROOT, className)}>
      <legend className="sr-only">Mes</legend>
      <MonthPiece
        month={month}
        active
        today={today}
        minMonth={minMonth}
        pending={pending}
        go={go}
      />
    </fieldset>
  )
}

/** Libros de rango (diario, mayor, sumas y saldos, subdiarios, historia): Mes · Ejercicio · Rango. */
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
  const isMonth = range.kind === 'month' && range.month !== null
  const fyActive =
    Boolean(fiscalYear) &&
    range.kind === 'range' &&
    range.from === fiscalYear?.from &&
    range.to === fiscalYear?.to

  return (
    <fieldset aria-busy={pending} className={cn(SEG_ROOT, className)}>
      <legend className="sr-only">Período</legend>
      <MonthPiece
        month={range.month ?? monthOf(today)}
        active={isMonth}
        today={today}
        minMonth={minMonth}
        pending={pending}
        go={go}
      />
      {fiscalYear ? (
        <button
          type="button"
          className={cn(SEG_ITEM, fyActive ? SEG_ON : SEG_OFF)}
          aria-pressed={fyActive}
          disabled={pending}
          onClick={() => go({ desde: fiscalYear.from, hasta: fiscalYear.to })}
        >
          Ejercicio
        </button>
      ) : null}
      <RangePopover
        active={!isMonth && !fyActive}
        label={!isMonth && !fyActive ? range.label : undefined}
        from={range.from}
        to={range.to}
        disabled={pending}
        onApply={(from, to) => go({ desde: from, hasta: to })}
      />
    </fieldset>
  )
}

function RangePopover({
  active,
  label,
  from,
  to,
  disabled,
  onApply,
}: {
  active: boolean
  /** Con un rango elegido: sus fechas, que van escritas en el botón. */
  label?: string
  from: string
  to: string
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
          className={cn(SEG_ITEM, active ? SEG_ON : SEG_OFF)}
        >
          {label ? (
            <>
              <span className="sr-only">Rango elegido: </span>
              {label}
            </>
          ) : (
            'Rango'
          )}
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
