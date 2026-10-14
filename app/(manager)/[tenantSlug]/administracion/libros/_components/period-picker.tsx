'use client'

import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Pill } from '@/components/administracion/kit/pill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addMonthsToYearMonth, formatMonthLabel, monthOf } from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * El período de los libros en la URL (H.12): `?mes=` o `?desde=&hasta=`.
 * Cambiar de período conserva los demás filtros (cuenta, partícipe, nivel) y
 * vuelve a la primera página; mientras carga, todo queda «pendiente».
 *
 * Se ve igual que el período de Ventas y de Cajas (`MonthStepper` /
 * `RangeFilter` de `cajas-ventas/period-filters.tsx`): el mes es una píldora de
 * papel con una flecha en cada punta y, al lado, las píldoras del kit con la
 * elegida RELLENA en tinta. Con un rango elegido, las fechas SON el control:
 * una sola píldora que abre el selector para cambiarlas. Mismos parámetros de
 * URL y mismo teclado de siempre; los libros suman «Ejercicio a la fecha», que
 * las otras pantallas no tienen. Donde se toca con el dedo todo mide 44 px; con
 * mouse, 36.
 */

const PERIOD_KEYS = ['mes', 'desde', 'hasta', 'despues'] as const

/** La píldora de papel: la misma superficie que la navegación de día del cierre. */
const PAPER_PILL = 'card-hairline rounded-full border bg-card shadow-xs'
/** Las flechas: redondas, para calzar en las puntas de la píldora, con su anillo de foco. */
const STEP_BUTTON =
  'size-11 rounded-full focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:size-[2.125rem]'
/** Las píldoras de al lado: el corte es por tipo de puntero, no por ancho. */
const CHIP_SIZE = 'md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'

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
    // Con mouse mide 36 px, lo mismo que las píldoras de al lado (no quedan escalonadas).
    <div className={cn(PAPER_PILL, 'flex items-center gap-1 md:pointer-fine:h-9')}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={STEP_BUTTON}
        aria-label={`Mes anterior: ${formatMonthLabel(prev)}`}
        disabled={!canPrev || pending}
        onClick={() => go({ mes: prev })}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="flex items-center gap-2 px-1.5">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-[124px] text-center text-sm font-semibold tabular-nums">
          {formatMonthLabel(month)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={STEP_BUTTON}
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
 * Libros mensuales (IVA compras y ventas, posición): ‹ Octubre 2026 › y «Este
 * mes» cuando se mira otro.
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
 * Libros de rango (diario, mayor, sumas y saldos, subdiarios, historia): el
 * mes con flechas, «Este mes», «Ejercicio a la fecha» y un rango a mano.
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
        // El rango elegido: las fechas son el botón que las cambia. Si el rango es justo el
        // ejercicio a la fecha, la rellena es esa píldora (una sola elegida a la vista).
        <RangePopover
          active={!fyActive}
          label={range.label}
          from={range.from}
          to={range.to}
          disabled={pending}
          onApply={(from, to) => go({ desde: from, hasta: to })}
        />
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
      {isMonth ? (
        <RangePopover
          active={false}
          from={range.from}
          to={range.to}
          disabled={pending}
          onApply={(from, to) => go({ desde: from, hasta: to })}
        />
      ) : null}
    </div>
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
        <Pill
          size="touch"
          icon={CalendarRange}
          active={active}
          disabled={disabled}
          className={cn(CHIP_SIZE, label && 'tabular-nums')}
        >
          {label ? (
            <>
              <span className="sr-only">Rango elegido: </span>
              {label}
            </>
          ) : (
            'Rango'
          )}
        </Pill>
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
    <Pill size="touch" active={active} disabled={disabled} onClick={onClick} className={CHIP_SIZE}>
      {label}
    </Pill>
  )
}
