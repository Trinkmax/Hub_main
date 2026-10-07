'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  calendarKeyTarget,
  calendarWeeks,
  clampIsoDay,
  isOutsideRange,
  monthHasDaysInRange,
  nextRangeDraft,
  type RangeDayState,
  type RangeDraft,
  rangeDayState,
  sameDayInMonth,
  visibleMonths,
  type WeekStart,
  weekdayHeaders,
} from '@/lib/dates/calendar-grid'
import { addMonthsToYearMonth, endOfMonth, startOfMonth, toYearMonth } from '@/lib/dates/civil'
import { capitalizeFirst, formatLongDate, formatMonthYear, MONTH_NAMES } from '@/lib/dates/format'
import { todayInCordoba } from '@/lib/dates/zone'
import { mergeRefs } from '@/lib/dom/form-control'
import { cn } from '@/lib/utils'

/**
 * El calendario del kit HUB (§3.2): la grilla que abren DatePicker y
 * PeriodPicker. Propio, sobre la aritmética civil de `lib/dates` (sin
 * react-day-picker y sin `Date`): las fechas son strings `yyyy-MM-dd`.
 *
 * - `role="grid"`, semana desde el **lunes**, encabezados `lu ma mi ju vi sá
 *   do` con el nombre completo en `abbr`.
 * - Celdas de 36 px (44 con el dedo, por `--control-md`) con `aria-label`
 *   «martes 15 de septiembre de 2026», `aria-current="date"` en hoy y
 *   `aria-disabled` en lo que no se puede elegir (sigue enfocable: con las
 *   flechas se pasa por encima).
 * - Foco móvil (roving tabindex): una sola parada de Tab en la grilla.
 *   ← → ±1 día · ↑ ↓ ±7 · Inicio y Fin de la semana · RePág y AvPág ±1 mes ·
 *   con Mayús ±1 año · Enter y Espacio eligen.
 * - El cambio de mes es instantáneo (se hace con el teclado) y el resaltado no
 *   se anima.
 */

/** ¿Coincide la media query? En el server, `serverValue`. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}

/** Pantalla táctil (teléfono o tablet): ahí el calendario va en un diálogo, no en un popover. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)'

/**
 * Enfoca el día con la parada de Tab de la grilla (el elegido, o hoy). Para el
 * `onOpenAutoFocus` del popover o del diálogo que contiene un calendario.
 */
export function focusCalendarDay(container: HTMLElement | null): boolean {
  const day = container?.querySelector<HTMLElement>('[data-slot="calendar-day"][tabindex="0"]')
  if (!day) return false
  day.focus({ preventScroll: true })
  return true
}

export type CalendarProps = Omit<
  React.ComponentProps<'div'>,
  'onSelect' | 'defaultValue' | 'onChange'
> & {
  /** `single` (default): un día · `range`: desde y hasta, con dos toques. */
  mode?: 'single' | 'range'
  /** Un día: el elegido (`yyyy-MM-dd`). */
  selected?: string | null
  /** Un día: se llama al elegir (click, Enter o Espacio). */
  onSelect?: (iso: string) => void
  /** Rango: el elegido o el que está a medio elegir. */
  range?: RangeDraft
  onRangeChange?: (range: RangeDraft) => void
  /** El mes que se ve (`yyyy-MM`), controlado. */
  month?: string
  /** El mes que se ve al montar. Default: el del día elegido, o el de hoy. */
  defaultMonth?: string
  onMonthChange?: (month: string) => void
  /** Default 1. El rango de PeriodPicker usa 2 desde `lg`. */
  numberOfMonths?: 1 | 2
  /** Default `todayInCordoba()`. */
  today?: string
  /** ISO inclusivo. */
  min?: string | null
  /** ISO inclusivo. */
  max?: string | null
  isDateDisabled?: (iso: string) => boolean
  /**
   * Por qué un día deshabilitado no se puede elegir («Septiembre está
   * cerrado…»): se suma a su nombre para el lector y va de `title` para el mouse.
   */
  disabledReason?: (iso: string) => string | null
  /** Días con algo (eventos): punto de 4 px debajo del número. */
  markers?: Record<string, 'dot'>
  /** `dropdowns`: mes y año en selects (cumpleaños). */
  captionLayout?: 'label' | 'dropdowns'
  fromYear?: number
  toYear?: number
  /** Enfoca el día con la parada de Tab al montar. */
  autoFocus?: boolean
  /**
   * Modo link: cada día que se puede elegir es un `<Link>` a esta URL (sin
   * scroll). `onSelect` se llama igual, para cerrar el popover.
   */
  dayHref?: (iso: string) => string | undefined
  /** Default 1 (lunes). */
  weekStartsOn?: WeekStart
}

const NAV_BUTTON_CLASS = 'shrink-0 text-muted-foreground'

/**
 * Las clases del día. Sin transiciones: el resaltado se mueve con el teclado y
 * una transición de color deja una estela.
 */
function dayClasses(opts: {
  inMonth: boolean
  isToday: boolean
  selected: boolean
  blocked: boolean
  rangeState: RangeDayState
}): string {
  const { inMonth, isToday, selected, blocked, rangeState } = opts
  const filled =
    selected || rangeState === 'start' || rangeState === 'end' || rangeState === 'single'
  return cn(
    'relative flex size-(--control-md) items-center justify-center rounded-md type-body type-amount select-none',
    // Foco «adentro»: la celda está pegada a sus vecinas.
    'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
    !inMonth && 'text-subtle-foreground',
    isToday && 'font-semibold text-primary',
    !blocked && !filled && 'hover:bg-hover',
    rangeState === 'inside' && 'rounded-none bg-selected text-foreground hover:bg-selected',
    filled && 'bg-primary font-medium text-primary-foreground hover:bg-primary-hover',
    rangeState === 'start' && 'rounded-e-none',
    rangeState === 'end' && 'rounded-s-none',
    // Deshabilitado: 50 % (como todo lo deshabilitado) y tachado fino, así no
    // se confunde con «de otro mes».
    blocked && 'cursor-not-allowed line-through decoration-1 opacity-50',
  )
}

function Calendar({
  mode = 'single',
  selected = null,
  onSelect,
  range,
  onRangeChange,
  month: monthProp,
  defaultMonth,
  onMonthChange,
  numberOfMonths = 1,
  today: todayProp,
  min,
  max,
  isDateDisabled,
  disabledReason,
  markers,
  captionLayout = 'label',
  fromYear,
  toYear,
  autoFocus = false,
  dayHref,
  weekStartsOn = 1,
  className,
  ref,
  ...props
}: CalendarProps) {
  const [fallbackToday] = React.useState(() => todayInCordoba())
  const today = todayProp ?? fallbackToday
  const draft: RangeDraft = range ?? { from: null, to: null }
  const anchor = mode === 'range' ? draft.from : selected
  const [innerMonth, setInnerMonth] = React.useState(() =>
    (defaultMonth ?? anchor ?? clampIsoDay(today, min, max)).slice(0, 7),
  )
  const displayMonth = (monthProp ?? innerMonth).slice(0, 7)
  const months = visibleMonths(displayMonth, numberOfMonths)
  const lastMonth = months[months.length - 1] ?? displayMonth
  const firstVisible = startOfMonth(displayMonth)
  const lastVisible = endOfMonth(lastMonth)
  const isVisible = (iso: string): boolean => iso >= firstVisible && iso <= lastVisible

  const [focusIso, setFocusIso] = React.useState<string | null>(null)
  const [hoverIso, setHoverIso] = React.useState<string | null>(null)
  const pendingFocus = React.useRef(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  // La ref del que llama no pisa la propia (la usa el foco móvil).
  const mergedRef = React.useMemo(() => mergeRefs(rootRef, ref), [ref])
  const idBase = React.useId()

  const blocked = (iso: string) => isOutsideRange(iso, min, max) || Boolean(isDateDisabled?.(iso))

  // La parada de Tab: el día enfocado, el elegido o hoy, si se ven; si no, el
  // primer día del mes que se puede elegir.
  let tabbable =
    [focusIso, anchor, today].find((iso): iso is string => iso != null && isVisible(iso)) ?? null
  if (!tabbable) {
    const start = clampIsoDay(firstVisible, min, max)
    tabbable = isVisible(start) ? start : firstVisible
  }

  function changeMonth(next: string) {
    if (monthProp === undefined) setInnerMonth(next)
    onMonthChange?.(next)
  }

  /** Cambia de mes con los botones: el foco queda en el botón, la parada de Tab pasa al mismo día. */
  function shiftMonth(delta: number) {
    const next = addMonthsToYearMonth(displayMonth, delta)
    changeMonth(next)
    setFocusIso(sameDayInMonth(tabbable ?? firstVisible, next, { min, max }))
  }

  /** Mueve el foco con el teclado; si el día cae en otro mes, lo muestra. */
  function moveFocus(target: string) {
    const iso = clampIsoDay(target, min, max)
    setFocusIso(iso)
    pendingFocus.current = true
    if (iso < firstVisible) changeMonth(iso.slice(0, 7))
    else if (iso > lastVisible)
      changeMonth(addMonthsToYearMonth(iso.slice(0, 7), -(months.length - 1)))
  }

  // Después de mover con el teclado, el foco del DOM va al día nuevo (que
  // puede haberse dibujado recién, en otro mes).
  React.useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-slot="calendar-day"][data-day="${focusIso}"]`)
      ?.focus()
  })

  React.useEffect(() => {
    if (autoFocus) focusCalendarDay(rootRef.current)
  }, [autoFocus])

  function activate(iso: string) {
    if (blocked(iso)) return
    setFocusIso(iso)
    if (!isVisible(iso)) changeMonth(iso.slice(0, 7))
    if (mode === 'range') onRangeChange?.(nextRangeDraft(draft, iso))
    else onSelect?.(iso)
  }

  const headers = weekdayHeaders(weekStartsOn)
  const canPrev = monthHasDaysInRange(addMonthsToYearMonth(displayMonth, -1), min, max)
  const canNext = monthHasDaysInRange(addMonthsToYearMonth(lastMonth, 1), min, max)
  const showOutsideDays = months.length === 1
  const preview = mode === 'range' && draft.from && !draft.to ? hoverIso : null

  return (
    <div
      data-slot="calendar"
      data-mode={mode}
      {...props}
      ref={mergedRef}
      className={cn('w-fit text-foreground', className)}
    >
      <div
        className="flex flex-col gap-4 sm:flex-row sm:gap-6"
        onPointerLeave={mode === 'range' ? () => setHoverIso(null) : undefined}
      >
        {months.map((month, index) => {
          const captionId = `${idBase}-caption-${index}`
          const weeks = calendarWeeks(month, { weekStartsOn })
          return (
            <div key={month} data-slot="calendar-month" className="grid content-start gap-2">
              <div data-slot="calendar-caption" className="flex h-8 items-center gap-1">
                {index === 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mes anterior"
                    disabled={!canPrev}
                    onClick={() => shiftMonth(-1)}
                    className={NAV_BUTTON_CLASS}
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                ) : (
                  <span aria-hidden className="size-(--control-sm) shrink-0" />
                )}
                <div className="flex min-w-0 flex-1 items-center justify-center">
                  {captionLayout === 'dropdowns' && months.length === 1 ? (
                    <CaptionDropdowns
                      month={month}
                      today={today}
                      min={min}
                      max={max}
                      fromYear={fromYear}
                      toYear={toYear}
                      onChange={(next) => {
                        changeMonth(next)
                        setFocusIso(sameDayInMonth(tabbable ?? firstVisible, next, { min, max }))
                      }}
                    />
                  ) : null}
                  <div
                    id={captionId}
                    aria-live="polite"
                    className={cn(
                      'type-body font-semibold',
                      captionLayout === 'dropdowns' && months.length === 1 && 'sr-only',
                    )}
                  >
                    {formatMonthYear(month)}
                  </div>
                </div>
                {index === months.length - 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mes siguiente"
                    disabled={!canNext}
                    onClick={() => shiftMonth(1)}
                    className={NAV_BUTTON_CLASS}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                ) : (
                  <span aria-hidden className="size-(--control-sm) shrink-0" />
                )}
              </div>
              <table
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: es el patrón de la APG para el calendario (date picker dialog): una tabla con role="grid" y foco móvil en las celdas
                role="grid"
                aria-labelledby={captionId}
                className="border-separate border-spacing-0"
              >
                <thead>
                  <tr>
                    {headers.map((header) => (
                      <th
                        key={header.long}
                        scope="col"
                        abbr={header.long}
                        className="h-8 w-(--control-md) p-0 text-center type-caption font-normal text-subtle-foreground"
                      >
                        {header.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week[0]?.iso ?? month}>
                      {week.map((day) => {
                        if (!day.inMonth && !showOutsideDays) {
                          // Adentro de una tabla role="grid" la celda ya es gridcell: vacía, sin nada que elegir.
                          return <td key={day.iso} className="p-0" />
                        }
                        const isBlocked = blocked(day.iso)
                        const isSelected = mode === 'single' && day.iso === selected
                        // Lo que se ve (con la vista previa del mouse o del foco) y lo
                        // que está elegido de verdad (lo único que se anuncia).
                        const state =
                          mode === 'range' ? rangeDayState(day.iso, draft, preview) : null
                        const committed = mode === 'range' ? rangeDayState(day.iso, draft) : null
                        const chosen = isSelected || committed !== null
                        const filled =
                          isSelected || state === 'start' || state === 'end' || state === 'single'
                        const href = !isBlocked && dayHref ? dayHref(day.iso) : undefined
                        const reason =
                          isBlocked && isDateDisabled?.(day.iso)
                            ? (disabledReason?.(day.iso) ?? null)
                            : null
                        const dayProps = {
                          'data-slot': 'calendar-day',
                          'data-day': day.iso,
                          'data-outside': day.inMonth ? undefined : '',
                          'data-today': day.iso === today ? '' : undefined,
                          'data-selected': chosen ? '' : undefined,
                          'data-range': state ?? undefined,
                          tabIndex: day.iso === tabbable ? 0 : -1,
                          'aria-label': reason
                            ? `${formatLongDate(day.iso)}. ${reason}`
                            : formatLongDate(day.iso),
                          title: reason ?? undefined,
                          'aria-current': day.iso === today ? ('date' as const) : undefined,
                          'aria-disabled': isBlocked ? true : undefined,
                          'aria-description':
                            committed === 'start'
                              ? 'inicio del rango'
                              : committed === 'end'
                                ? 'fin del rango'
                                : undefined,
                          className: dayClasses({
                            inMonth: day.inMonth,
                            isToday: day.iso === today,
                            selected: isSelected,
                            blocked: isBlocked,
                            rangeState: state,
                          }),
                          onFocus: () => {
                            setFocusIso(day.iso)
                            // Con el rango a medio elegir, el foco también muestra hasta dónde llegaría.
                            if (mode === 'range') setHoverIso(day.iso)
                          },
                          onPointerEnter: mode === 'range' ? () => setHoverIso(day.iso) : undefined,
                          onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                            const target = calendarKeyTarget(day.iso, event.key, {
                              shiftKey: event.shiftKey,
                              weekStartsOn,
                            })
                            if (target) {
                              event.preventDefault()
                              moveFocus(target)
                              return
                            }
                            // Un link no se activa con Espacio: se lo pide la grilla.
                            if (event.key === ' ' && href) {
                              event.preventDefault()
                              event.currentTarget.click()
                            }
                          },
                        }
                        const content = (
                          <>
                            {day.day}
                            {markers?.[day.iso] ? (
                              <span
                                aria-hidden
                                data-slot="calendar-marker"
                                className={cn(
                                  'absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full',
                                  filled ? 'bg-primary-foreground' : 'bg-primary',
                                )}
                              />
                            ) : null}
                          </>
                        )
                        return (
                          // biome-ignore lint/a11y/useFocusableInteractive: lo enfocable es el botón (o link) de adentro, con foco móvil
                          <td
                            key={day.iso}
                            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: celda de la grilla de la APG; el rol explícito lleva el aria-selected
                            role="gridcell"
                            aria-selected={chosen ? true : undefined}
                            className="p-0"
                          >
                            {href ? (
                              <Link
                                href={href}
                                scroll={false}
                                {...dayProps}
                                onClick={() => activate(day.iso)}
                              >
                                {content}
                              </Link>
                            ) : (
                              <button type="button" {...dayProps} onClick={() => activate(day.iso)}>
                                {content}
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const NATIVE_SELECT_CLASS = cn(
  'h-(--control-sm) min-w-0 rounded-md border border-input bg-card px-2 text-foreground',
  'text-(length:--control-font) outline-(--ring) -outline-offset-1 focus-visible:outline-2',
)

/**
 * Mes y año en selects nativos (cumpleaños: sin esto, llegar a 1985 eran 500
 * toques de «Mes anterior»). Nativos a propósito: más de cien años no entran
 * en un Select y en el celular abren la rueda del sistema.
 */
function CaptionDropdowns({
  month,
  today,
  min,
  max,
  fromYear,
  toYear,
  onChange,
}: {
  month: string
  today: string
  min?: string | null
  max?: string | null
  fromYear?: number
  toYear?: number
  onChange: (month: string) => void
}) {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const todayYear = Number(today.slice(0, 4))
  const first = fromYear ?? (min ? Number(min.slice(0, 4)) : todayYear - 100)
  const last = toYear ?? (max ? Number(max.slice(0, 4)) : todayYear + 10)
  const years: number[] = []
  for (let y = Math.max(first, last); y >= Math.min(first, last); y--) years.push(y)
  // El año que se ve siempre está en la lista, aunque quede afuera de los bordes.
  if (!years.includes(year)) {
    years.push(year)
    years.sort((a, b) => b - a)
  }

  return (
    <div data-slot="calendar-dropdowns" className="flex items-center gap-1">
      <select
        aria-label="Mes"
        value={monthNumber}
        onChange={(event) => onChange(toYearMonth(year, Number(event.target.value)))}
        className={NATIVE_SELECT_CLASS}
      >
        {MONTH_NAMES.map((name, index) => (
          <option
            key={name}
            value={index + 1}
            disabled={!monthHasDaysInRange(toYearMonth(year, index + 1), min, max)}
          >
            {capitalizeFirst(name)}
          </option>
        ))}
      </select>
      <select
        aria-label="Año"
        value={year}
        onChange={(event) => onChange(toYearMonth(Number(event.target.value), monthNumber))}
        className={NATIVE_SELECT_CLASS}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}

export type { RangeDraft }
export { Calendar }
