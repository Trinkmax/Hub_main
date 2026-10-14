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
import type { RangeValue } from './periods'

/**
 * El período de una lista en la URL (`?mes=` o `?desde=&hasta=`): un mes con
 * flechas y, al lado, «Este mes» y «Rango». Cambiar de período conserva los
 * demás parámetros (pestaña, búsqueda) y vuelve a la primera página; mientras
 * carga, todo queda «pendiente» (`aria-busy`).
 *
 * Se ve como la navegación de día del cierre: una píldora de papel (`bg-card`,
 * con su sombra) con una flecha en cada punta, y al lado las píldoras del kit,
 * con la elegida RELLENA en tinta (el verde queda para la barra de la sección).
 * Donde se toca con el dedo (celular, tablet) todo mide 44 px; en una compu
 * con mouse, 36, la medida de las píldoras de vista que suelen ir al lado.
 *
 * Con un rango elegido, las fechas SON el control: una sola píldora rellena
 * («01/08 – 13/10/2026») que abre el selector para cambiarlas. No hay una
 * etiqueta quieta al lado de otro botón.
 *
 * Cuándo NO: para moverse por los meses de un ejercicio viendo su estado (eso
 * es `MonthStrip`), para el día de un cierre (tiene su propia navegación), ni
 * para elegir entre vistas (`ViewPills`).
 */

const PERIOD_KEYS = ['mes', 'desde', 'hasta', 'despues', 'page'] as const

/** La píldora de papel: la misma superficie que la navegación de día del cierre. */
const PAPER_PILL = 'card-hairline rounded-full border bg-card shadow-xs'
/**
 * Las flechas: redondas, para calzar en las puntas de la píldora. Llevan el
 * mismo anillo de foco que las píldoras de al lado (el del botón de fábrica,
 * más ancho y al 50 %, casi no se veía sobre el papel).
 */
const STEP_BUTTON =
  'size-11 rounded-full focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:size-[2.125rem]'
/**
 * «Este mes» y «Rango»: 44 px donde se toca con el dedo y, en una compu con mouse, la medida de
 * las píldoras de vista (`ViewPills`). El corte es por tipo de puntero, no por ancho: en una
 * tablet siguen midiendo 44.
 */
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
        // El rango elegido: las fechas son el botón que las cambia.
        <RangePopover
          active
          label={range.label}
          from={range.from}
          to={range.to}
          max={today}
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
      {isMonth ? (
        <RangePopover
          active={false}
          from={range.from}
          to={range.to}
          max={today}
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
  max,
  disabled,
  onApply,
}: {
  active: boolean
  /** Con un rango elegido: sus fechas, que van escritas en el botón. */
  label?: string
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
    <Pill size="touch" active={active} disabled={disabled} onClick={onClick} className={CHIP_SIZE}>
      {label}
    </Pill>
  )
}
