'use client'

import { Check, ChevronDown, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Calendar, focusCalendarDay, useMediaQuery } from '@/components/ui/calendar'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import { DatePicker } from '@/components/ui/date-picker'
import { FilterChip } from '@/components/ui/filter-chip'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { monthGridKeyTarget, monthsOfYear, type RangeDraft } from '@/lib/dates/calendar-grid'
import { capitalizeFirst, MONTH_NAMES, MONTH_NAMES_SHORT } from '@/lib/dates/format'
import {
  fiscalYearLabel,
  fiscalYearOf,
  PERIOD_KINDS,
  type Period,
  type PeriodKind,
  periodLabel,
  periodPresets,
  periodRange,
  serializePeriod,
  shiftPeriod,
} from '@/lib/dates/period'
import {
  anchorMonthOf,
  canShiftPeriod,
  fiscalYearChoices,
  isClosedMonth,
  isMonthInBounds,
  periodHref,
  periodStepLabel,
  periodTouchesBounds,
} from '@/lib/dates/period-picker'
import { todayInCordoba } from '@/lib/dates/zone'
import { cn } from '@/lib/utils'

export type { Period, PeriodKind }

/** Un atajo: «Este mes», «Ejercicio anterior». Los de `periodPresets()` entran tal cual. */
export type PeriodPickerPreset = { label: string; period: Period }

export type PeriodPickerProps = Omit<
  React.ComponentProps<'div'>,
  'onChange' | 'defaultValue' | 'children'
> & {
  value: Period
  /** Default los cuatro: día, mes, ejercicio y rango. */
  kinds?: PeriodKind[]
  /** Default: los atajos de `periodPresets` de las clases elegidas. */
  presets?: PeriodPickerPreset[]
  /** 1–12 (pregunta 7 a la contadora). Default 1. */
  fiscalYearStartMonth?: number
  /** ISO inclusivo (p. ej. el inicio de los libros). */
  min?: string
  /** ISO inclusivo (p. ej. hoy). */
  max?: string
  /** Default `todayInCordoba()`. */
  today?: string
  /**
   * Modo link (el preferido en reportes): cada opción es un `<Link>` a la URL
   * actual con `?<param>=<período>`, conservando el resto. El server lo lee con
   * `parsePeriod`. Recibe el nombre del parámetro y no una función: una función
   * no cruza de un Server Component a uno cliente.
   */
  param?: string
  /** Modo controlado. */
  onValueChange?: (p: Period) => void
  /** `yyyy-MM` cerrados: candado en la grilla de meses y en el disparador. */
  closedMonths?: string[]
  /** `<input type="hidden">` con el período serializado (filtros por GET). */
  name?: string
  /** ‹ › período anterior y siguiente. Default `true`. */
  stepper?: boolean
  size?: ControlSize
  /** Del popover. Default `start`. */
  align?: 'start' | 'end'
}

const KIND_LABEL: Readonly<Record<PeriodKind, string>> = {
  day: 'Día',
  month: 'Mes',
  'fiscal-year': 'Ejercicio',
  range: 'Rango',
}

const ICON_SIZE: Readonly<Record<ControlSize, 'icon-sm' | 'icon' | 'icon-lg'>> = {
  sm: 'icon-sm',
  md: 'icon',
  lg: 'icon-lg',
}

/** Desde `sm` es un popover; debajo, una hoja inferior. */
const POPOVER_QUERY = '(min-width: 40rem)'
/** El rango muestra dos meses desde `lg`. */
const WIDE_QUERY = '(min-width: 64rem)'

type ChooseHandler = (period: Period) => void
type HrefFor = ((period: Period) => string) | undefined

/** Una opción que es link (modo URL) o botón (modo controlado), con el mismo aspecto. */
function PeriodChoice({
  period,
  hrefFor,
  onChoose,
  disabled,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick'> & {
  period: Period
  hrefFor: HrefFor
  onChoose: ChooseHandler
}) {
  if (hrefFor && !disabled) {
    const { type: _type, ...linkProps } = props
    return (
      <Link
        href={hrefFor(period)}
        scroll={false}
        onClick={() => onChoose(period)}
        className={className}
        {...(linkProps as Omit<React.ComponentProps<'a'>, 'href'>)}
      >
        {children}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChoose(period)}
      className={className}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * El período de reportes y libros (kit §3.2): día, mes, ejercicio y rango, con
 * atajos. Así todos los reportes comparten período por URL.
 *
 * - Disparador `[‹] [Septiembre 2026 ▾] [›]`; las flechas dicen a dónde van
 *   («Período anterior: agosto 2026»).
 * - Desde `sm`, un popover (`role="dialog"` modal): atajos a la izquierda y, a
 *   la derecha, Día · Mes · Ejercicio · Rango con su cuerpo. El rango se
 *   confirma con «Aplicar»; lo demás se aplica al tocar. Debajo de `sm`, lo
 *   mismo en una hoja inferior.
 * - Modo link (`param`): atajos, meses y días son `<Link>` armados en el
 *   cliente con la URL actual. Necesita una página dinámica (o un `Suspense`
 *   arriba): usa `useSearchParams`.
 */
function PeriodPicker({ param, ...props }: PeriodPickerProps) {
  if (param) return <LinkedPeriodPicker param={param} {...props} />
  return <PeriodPickerView {...props} hrefFor={undefined} />
}

function LinkedPeriodPicker({ param, ...props }: PeriodPickerProps & { param: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const hrefFor = React.useCallback(
    (period: Period) => periodHref(pathname, search, param, period),
    [pathname, search, param],
  )
  return <PeriodPickerView {...props} hrefFor={hrefFor} />
}

/** Enfoca lo que corresponde al abrir: el día, el mes o el ejercicio elegido; si no, el primer atajo. */
function focusPeriodBody(container: HTMLElement | null) {
  if (!container) return
  if (focusCalendarDay(container)) return
  const target =
    container.querySelector<HTMLElement>('[data-slot="period-month"][tabindex="0"]') ??
    container.querySelector<HTMLElement>('[data-slot="period-fiscal-year"][data-selected]') ??
    container.querySelector<HTMLElement>('[data-slot="period-range-from"] input') ??
    container.querySelector<HTMLElement>('a[href], button:not([disabled])')
  target?.focus({ preventScroll: true })
}

function PeriodPickerView({
  value,
  kinds = [...PERIOD_KINDS],
  presets,
  fiscalYearStartMonth = 1,
  min,
  max,
  today: todayProp,
  hrefFor,
  onValueChange,
  closedMonths,
  name,
  stepper = true,
  size,
  align = 'start',
  className,
  'aria-label': ariaLabel = 'Período',
  ...props
}: Omit<PeriodPickerProps, 'param'> & { hrefFor: HrefFor }) {
  const resolvedSize = useControlSize(size)
  const desktop = useMediaQuery(POPOVER_QUERY, true)
  const wide = useMediaQuery(WIDE_QUERY, true)
  const [fallbackToday] = React.useState(() => todayInCordoba())
  const today = todayProp ?? fallbackToday
  const opts = { fiscalYearStartMonth }
  const bounds = { min, max }
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<PeriodKind>(value.kind)
  // El rango a medio elegir vive acá (y no en su cuerpo) porque «Aplicar» va
  // abajo del cuerpo en el popover y en el pie fijo de la hoja en el celular.
  const [rangeDraft, setRangeDraft] = React.useState<RangeDraft>({ from: null, to: null })
  const contentRef = React.useRef<HTMLDivElement>(null)
  const sheetRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentId = React.useId()

  /** Al cerrar, el foco vuelve al disparador (se abre desde un ancla, no desde un Trigger de Radix). */
  function returnFocus(event: Event) {
    event.preventDefault()
    triggerRef.current?.focus({ preventScroll: true })
  }

  const allowedKinds = kinds.length > 0 ? kinds : [...PERIOD_KINDS]
  const activeKind = allowedKinds.includes(kind) ? kind : (allowedKinds[0] ?? 'month')
  const presetList: PeriodPickerPreset[] = (
    presets ?? periodPresets({ today, fiscalYearStartMonth, kinds: allowedKinds })
  ).filter((preset) => periodTouchesBounds(preset.period, bounds, opts))
  const activePreset = presetList.find(
    (preset) => serializePeriod(preset.period) === serializePeriod(value),
  )
  const label = periodLabel(value, opts)
  const closed = value.kind === 'month' && isClosedMonth(value.month, closedMonths)

  function choose(period: Period) {
    onValueChange?.(period)
    setOpen(false)
  }

  function toggle() {
    if (!open) {
      setKind(allowedKinds.includes(value.kind) ? value.kind : activeKind)
      // El rango arranca con el período de hoy: septiembre → 01/09 a 30/09.
      const range = periodRange(value, opts)
      setRangeDraft({ from: range.from, to: range.to })
    }
    setOpen((was) => !was)
  }

  const prev = shiftPeriod(value, -1, opts)
  const next = shiftPeriod(value, 1, opts)
  const canPrev = canShiftPeriod(value, -1, bounds, opts)
  const canNext = canShiftPeriod(value, 1, bounds, opts)

  function stepButton(target: Period, delta: -1 | 1, enabled: boolean) {
    const stepLabel = periodStepLabel(value, delta, opts)
    const icon = delta < 0 ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />
    if (hrefFor && enabled) {
      return (
        <Button asChild variant="ghost" size={ICON_SIZE[resolvedSize]}>
          <Link
            href={hrefFor(target)}
            scroll={false}
            aria-label={stepLabel}
            onClick={() => onValueChange?.(target)}
          >
            {icon}
          </Link>
        </Button>
      )
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size={ICON_SIZE[resolvedSize]}
        aria-label={stepLabel}
        disabled={!enabled}
        onClick={() => onValueChange?.(target)}
      >
        {icon}
      </Button>
    )
  }

  const segmented =
    allowedKinds.length > 1 ? (
      <SegmentedControl<PeriodKind>
        aria-label="Clase de período"
        size="sm"
        fullWidth={!desktop}
        items={allowedKinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        value={activeKind}
        onValueChange={setKind}
      />
    ) : null

  const body = (
    <PeriodBody
      kind={activeKind}
      value={value}
      today={today}
      min={min}
      max={max}
      fiscalYearStartMonth={fiscalYearStartMonth}
      closedMonths={closedMonths}
      hrefFor={hrefFor}
      onChoose={choose}
      wide={wide}
      rangeDraft={rangeDraft}
      onRangeDraftChange={setRangeDraft}
      inlineApply={desktop}
    />
  )

  return (
    <div
      data-slot="period-picker"
      className={cn('inline-flex max-w-full items-center gap-1', className)}
      {...props}
    >
      {stepper ? stepButton(prev, -1, canPrev) : null}
      <Popover open={open && desktop} onOpenChange={setOpen} modal>
        <PopoverAnchor asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="secondary"
            size={resolvedSize}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? contentId : undefined}
            onClick={toggle}
            data-slot="period-picker-trigger"
            className="min-w-0 justify-between"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {/* El lector oye para qué es y qué tiene: «Período: Septiembre 2026». */}
              <span className="sr-only">{ariaLabel}: </span>
              <span className="truncate">{label}</span>
              {closed ? (
                <>
                  <Lock aria-hidden className="size-3.5 text-muted-foreground" />
                  <span className="sr-only">, cerrado</span>
                </>
              ) : null}
            </span>
            <ChevronDown aria-hidden className="text-subtle-foreground" />
          </Button>
        </PopoverAnchor>
        <PopoverContent
          ref={contentRef}
          id={contentId}
          aria-modal="true"
          aria-label="Elegir período"
          align={align}
          size="auto"
          className="p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            focusPeriodBody(contentRef.current)
          }}
          onCloseAutoFocus={returnFocus}
        >
          {/* Nunca más alto que el lugar que queda (lo mide Radix): si no entra, scrollea adentro. */}
          <div className="flex max-h-[min(var(--radix-popover-content-available-height,80dvh),40rem)]">
            {presetList.length > 0 ? (
              <div
                data-slot="period-presets"
                className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border p-2"
              >
                {presetList.map((preset) => {
                  const active = preset === activePreset
                  return (
                    <PeriodChoice
                      key={`${preset.label}-${serializePeriod(preset.period)}`}
                      period={preset.period}
                      hrefFor={hrefFor}
                      onChoose={choose}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex min-h-8 items-center justify-between gap-2 rounded-md px-2 text-start type-body pointer-coarse:min-h-11',
                        'outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2',
                        active && 'bg-selected font-medium',
                      )}
                    >
                      {preset.label}
                      {active ? <Check aria-hidden className="size-4 text-primary" /> : null}
                    </PeriodChoice>
                  )
                })}
              </div>
            ) : null}
            <div className="grid content-start gap-3 overflow-y-auto p-3">
              {segmented}
              {body}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {stepper ? stepButton(next, 1, canNext) : null}
      <Sheet open={open && !desktop} onOpenChange={setOpen}>
        <SheetContent
          ref={sheetRef}
          side="bottom"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            focusPeriodBody(sheetRef.current)
          }}
          onCloseAutoFocus={returnFocus}
        >
          <SheetHeader>
            <SheetTitle>Elegir período</SheetTitle>
            <SheetDescription className="sr-only">
              Atajos, clase de período y calendario.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-4">
            {presetList.length > 0 ? (
              <div data-slot="period-presets" className="flex flex-wrap gap-2">
                {presetList.map((preset) => {
                  const active = preset === activePreset
                  if (hrefFor) {
                    return (
                      <FilterChip
                        key={`${preset.label}-${serializePeriod(preset.period)}`}
                        asChild
                        pressed={active}
                      >
                        <Link
                          href={hrefFor(preset.period)}
                          scroll={false}
                          onClick={() => choose(preset.period)}
                        >
                          {preset.label}
                        </Link>
                      </FilterChip>
                    )
                  }
                  return (
                    <FilterChip
                      key={`${preset.label}-${serializePeriod(preset.period)}`}
                      pressed={active}
                      onClick={(event) => {
                        event.preventDefault()
                        choose(preset.period)
                      }}
                    >
                      {preset.label}
                    </FilterChip>
                  )
                })}
              </div>
            ) : null}
            {segmented}
            {body}
          </SheetBody>
          <SheetFooter className="flex-row *:flex-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            {activeKind === 'range' ? (
              <RangeApply draft={rangeDraft} hrefFor={hrefFor} onChoose={choose} />
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {name ? <input type="hidden" name={name} value={serializePeriod(value)} /> : null}
    </div>
  )
}

type PeriodBodyProps = {
  rangeDraft: RangeDraft
  onRangeDraftChange: (draft: RangeDraft) => void
  /** En el popover «Aplicar» va abajo del rango; en la hoja, en el pie. */
  inlineApply: boolean
  kind: PeriodKind
  value: Period
  today: string
  min?: string
  max?: string
  fiscalYearStartMonth: number
  closedMonths?: string[]
  hrefFor: HrefFor
  onChoose: ChooseHandler
  wide: boolean
}

/** El cuerpo de cada clase: calendario, grilla de meses, lista de ejercicios o rango. */
function PeriodBody(props: PeriodBodyProps) {
  const { kind, value, today, min, max, fiscalYearStartMonth, hrefFor, onChoose } = props
  const opts = { fiscalYearStartMonth }
  if (kind === 'day') {
    return (
      <Calendar
        selected={value.kind === 'day' ? value.date : null}
        defaultMonth={anchorMonthOf(value, today, opts)}
        today={today}
        min={min}
        max={max}
        onSelect={(iso) => onChoose({ kind: 'day', date: iso })}
        dayHref={hrefFor ? (iso) => hrefFor({ kind: 'day', date: iso }) : undefined}
      />
    )
  }
  if (kind === 'month') return <MonthGrid {...props} />
  if (kind === 'fiscal-year') {
    const current = fiscalYearOf(today, opts)
    const years = fiscalYearChoices({ today, fiscalYearStartMonth, min, max, count: 6 })
    return (
      <div data-slot="period-fiscal-years" className="grid min-w-56 gap-0.5">
        {years.map((year) => {
          const selected = value.kind === 'fiscal-year' && value.year === year
          return (
            <PeriodChoice
              key={year}
              period={{ kind: 'fiscal-year', year }}
              hrefFor={hrefFor}
              onChoose={onChoose}
              aria-current={selected ? 'true' : undefined}
              data-slot="period-fiscal-year"
              data-selected={selected ? '' : undefined}
              className={cn(
                'flex min-h-9 items-center justify-between gap-3 rounded-md px-3 text-start type-body pointer-coarse:min-h-11',
                'outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2',
                selected && 'bg-selected font-medium',
              )}
            >
              <span>
                {fiscalYearLabel(year, opts)}
                {year === current ? (
                  <span className="ms-2 type-caption text-subtle-foreground">en curso</span>
                ) : null}
              </span>
              {selected ? <Check aria-hidden className="size-4 text-primary" /> : null}
            </PeriodChoice>
          )
        })}
      </div>
    )
  }
  return <RangeBody {...props} />
}

/** La grilla de meses de 4 × 3, con el año arriba. */
function MonthGrid({
  value,
  today,
  min,
  max,
  fiscalYearStartMonth,
  closedMonths,
  hrefFor,
  onChoose,
}: PeriodBodyProps) {
  const opts = { fiscalYearStartMonth }
  const selectedMonth = value.kind === 'month' ? value.month : null
  const todayMonth = today.slice(0, 7)
  const [year, setYear] = React.useState(() =>
    Number(anchorMonthOf(value, today, opts).slice(0, 4)),
  )
  const [focusMonth, setFocusMonth] = React.useState<string | null>(null)
  const pendingFocus = React.useRef(false)
  const gridRef = React.useRef<HTMLTableElement>(null)
  const yearLabelId = React.useId()
  const months = monthsOfYear(year)
  const inYear = (ym: string | null): ym is string => Boolean(ym?.startsWith(`${year}-`))
  const tabbable = [focusMonth, selectedMonth, todayMonth].find(inYear) ?? months[0] ?? `${year}-01`
  const bounds = { min, max }

  React.useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-slot="period-month"][data-month="${focusMonth}"]`)
      ?.focus()
  })

  function moveFocus(target: string) {
    const targetYear = Number(target.slice(0, 4))
    if (targetYear !== year) setYear(targetYear)
    setFocusMonth(target)
    pendingFocus.current = true
  }

  const minYear = min ? Number(min.slice(0, 4)) : null
  const maxYear = max ? Number(max.slice(0, 4)) : null

  return (
    <div className="grid min-w-64 gap-2">
      <div className="flex h-8 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Año anterior"
          disabled={minYear !== null && year - 1 < minYear}
          onClick={() => setYear((y) => y - 1)}
          className="text-muted-foreground"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div
          id={yearLabelId}
          aria-live="polite"
          className="flex-1 text-center type-body font-semibold type-amount"
        >
          {year}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Año siguiente"
          disabled={maxYear !== null && year + 1 > maxYear}
          onClick={() => setYear((y) => y + 1)}
          className="text-muted-foreground"
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <table
        ref={gridRef}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: grilla de la APG (como el calendario): tabla con role="grid" y foco móvil
        role="grid"
        aria-labelledby={yearLabelId}
        className="w-full border-separate border-spacing-1"
      >
        <tbody>
          {[0, 1, 2].map((row) => (
            <tr key={row}>
              {months.slice(row * 4, row * 4 + 4).map((ym) => {
                const monthIndex = Number(ym.slice(5, 7)) - 1
                const selected = ym === selectedMonth
                const closed = isClosedMonth(ym, closedMonths)
                const outOfBounds = !isMonthInBounds(ym, bounds)
                const fullName = `${MONTH_NAMES[monthIndex] ?? ''} de ${year}${closed ? ', cerrado' : ''}`
                const cellClass = cn(
                  'relative flex h-(--control-md) w-full items-center justify-center gap-1 rounded-md type-body select-none',
                  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
                  ym === todayMonth && 'font-semibold text-primary',
                  !outOfBounds && !selected && 'hover:bg-hover',
                  selected &&
                    'bg-primary font-medium text-primary-foreground hover:bg-primary-hover',
                  outOfBounds && 'cursor-not-allowed line-through decoration-1 opacity-50',
                )
                const period: Period = { kind: 'month', month: ym }
                const shared = {
                  'data-slot': 'period-month',
                  'data-month': ym,
                  tabIndex: ym === tabbable ? 0 : -1,
                  'aria-label': fullName,
                  'aria-current': ym === todayMonth ? ('date' as const) : undefined,
                  className: cellClass,
                  onFocus: () => setFocusMonth(ym),
                  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                    const target = monthGridKeyTarget(ym, event.key)
                    if (target) {
                      event.preventDefault()
                      moveFocus(target)
                    } else if (event.key === ' ' && hrefFor && !outOfBounds) {
                      event.preventDefault()
                      event.currentTarget.click()
                    }
                  },
                }
                const content = (
                  <>
                    {capitalizeFirst(MONTH_NAMES_SHORT[monthIndex] ?? '')}
                    {closed ? <Lock aria-hidden className="size-3 opacity-70" /> : null}
                  </>
                )
                return (
                  // biome-ignore lint/a11y/useFocusableInteractive: lo enfocable es el botón (o link) de adentro, con foco móvil
                  <td
                    key={ym}
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: celda de la grilla de la APG; el rol explícito lleva el aria-selected
                    role="gridcell"
                    aria-selected={selected ? true : undefined}
                    className="p-0"
                  >
                    {hrefFor && !outOfBounds ? (
                      <Link
                        href={hrefFor(period)}
                        scroll={false}
                        {...shared}
                        onClick={() => onChoose(period)}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        {...shared}
                        aria-disabled={outOfBounds ? true : undefined}
                        onClick={() => {
                          if (!outOfBounds) onChoose(period)
                        }}
                      >
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
}

/** Un rango completo y al derecho, o `null`. */
function rangePeriodOf(draft: RangeDraft): Period | null {
  return draft.from && draft.to && draft.from <= draft.to
    ? { kind: 'range', from: draft.from, to: draft.to }
    : null
}

/** «Aplicar» del rango: link en modo URL, botón en modo controlado; apagado hasta tener los dos bordes. */
function RangeApply({
  draft,
  hrefFor,
  onChoose,
  size,
}: {
  draft: RangeDraft
  hrefFor: HrefFor
  onChoose: ChooseHandler
  size?: 'sm' | 'md'
}) {
  const period = rangePeriodOf(draft)
  if (period && hrefFor) {
    return (
      <Button asChild size={size}>
        <Link href={hrefFor(period)} scroll={false} onClick={() => onChoose(period)}>
          Aplicar
        </Link>
      </Button>
    )
  }
  return (
    <Button
      type="button"
      size={size}
      disabled={!period}
      onClick={() => {
        if (period) onChoose(period)
      }}
    >
      Aplicar
    </Button>
  )
}

/** El rango: calendario (dos meses desde `lg`) + desde y hasta tipeables + «Aplicar». */
function RangeBody({
  today,
  min,
  max,
  hrefFor,
  onChoose,
  wide,
  rangeDraft: draft,
  onRangeDraftChange,
  inlineApply,
}: PeriodBodyProps) {
  const [month, setMonth] = React.useState(() => (draft.from ?? today).slice(0, 7))
  const fromId = React.useId()
  const toId = React.useId()

  return (
    <div className="grid gap-3">
      <Calendar
        mode="range"
        range={draft}
        onRangeChange={onRangeDraftChange}
        month={month}
        onMonthChange={setMonth}
        numberOfMonths={wide ? 2 : 1}
        today={today}
        min={min}
        max={max}
      />
      <div className="grid grid-cols-2 gap-2">
        <div data-slot="period-range-from" className="grid gap-1">
          <label htmlFor={fromId} className="type-caption text-subtle-foreground">
            Desde
          </label>
          <DatePicker
            id={fromId}
            calendar={false}
            size="sm"
            value={draft.from}
            min={min}
            max={max}
            today={today}
            onValueChange={(iso) => {
              onRangeDraftChange({
                from: iso,
                to: iso && draft.to && draft.to < iso ? null : draft.to,
              })
              if (iso) setMonth(iso.slice(0, 7))
            }}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={toId} className="type-caption text-subtle-foreground">
            Hasta
          </label>
          <DatePicker
            id={toId}
            calendar={false}
            size="sm"
            value={draft.to}
            min={draft.from ?? min}
            max={max}
            today={today}
            onValueChange={(iso) => onRangeDraftChange({ from: draft.from, to: iso })}
          />
        </div>
      </div>
      {inlineApply ? (
        <div className="flex justify-end">
          <RangeApply draft={draft} hrefFor={hrefFor} onChoose={onChoose} size="sm" />
        </div>
      ) : null}
    </div>
  )
}

export { PeriodPicker }
