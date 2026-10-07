'use client'

import { CalendarDays, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Calendar,
  COARSE_POINTER_QUERY,
  focusCalendarDay,
  useMediaQuery,
} from '@/components/ui/calendar'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useField,
  useFieldErrorReporter,
  useFormReset,
  WithoutFieldName,
} from '@/components/ui/field'
import { Input, InputGroup } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { clampIsoDay } from '@/lib/dates/calendar-grid'
import { isRealIsoDay } from '@/lib/dates/civil'
import {
  checkDateText,
  DATE_FIELD_MESSAGES,
  type DateFieldRules,
  isSelectableDay,
  maskDateTyping,
} from '@/lib/dates/date-field'
import { formatIsoDay } from '@/lib/dates/format'
import { todayInCordoba } from '@/lib/dates/zone'
import { focusIfFirstInvalid, mergeRefs, scrollIntoViewOnTouch } from '@/lib/dom/form-control'
import { cn } from '@/lib/utils'

export type DatePreset = { label: string; value: string }

export type DatePickerProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'min' | 'max' | 'inputMode'
> & {
  /** Va en el `<input type="hidden">` como `"YYYY-MM-DD"`, igual que `<input type="date">`: las acciones no cambian. */
  name?: string
  /** `yyyy-MM-dd` o `null`. Nunca un `Date`. */
  value?: string | null
  defaultValue?: string | null
  /** Con la fecha cada vez que el texto pasa a ser (o deja de ser) una fecha válida. */
  onValueChange?: (iso: string | null) => void
  /** ISO inclusivo. */
  min?: string
  /** ISO inclusivo. */
  max?: string
  isDateDisabled?: (iso: string) => boolean
  /** «Septiembre está cerrado: la corrección va con un asiento de ajuste». */
  disabledReason?: (iso: string) => string | null
  /** Default `todayInCordoba()`. */
  today?: string
  /** Atajos del pie: «Mañana», «Fin de mes». «Hoy» va siempre. */
  presets?: DatePreset[]
  /** Días con algo (eventos): punto debajo del número. */
  markers?: Record<string, 'dot'>
  /** `dropdowns`: mes y año en selects (cumpleaños). */
  captionLayout?: 'label' | 'dropdowns'
  fromYear?: number
  toYear?: number
  /** Botón «Borrar fecha» adentro del campo cuando hay algo escrito. */
  clearable?: boolean
  size?: ControlSize
  invalid?: boolean
  /** Del popover. Default `start`. */
  align?: 'start' | 'end'
  /**
   * Default `true`. `false` saca el botón del calendario: para tipear al lado de
   * un calendario que ya está a la vista (el rango del PeriodPicker).
   */
  calendar?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  /**
   * Para campos compuestos (DateTimeField): recibe el error local EN VEZ del
   * Field, que tiene un solo lugar para el error y dos controles lo pisarían.
   */
  onLocalErrorChange?: (message: string | null) => void
}

/** El texto de arranque: `2026-09-15` → `15/09/2026`. */
function isoToText(iso: string | null | undefined): string {
  return iso && isRealIsoDay(iso) ? formatIsoDay(iso) : ''
}

const ICON_BUTTON_CLASS = cn(
  'relative hit-area -me-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground',
  'outline-offset-2 outline-(--ring) hover:bg-hover hover:text-foreground focus-visible:outline-2',
  'disabled:pointer-events-none disabled:opacity-50',
)

/**
 * Una fecha civil (kit §3.2). Reemplaza los `type="date"` del panel. El valor
 * es un string ISO, nunca un `Date`.
 *
 * **Tipeo.** Las barras se insertan solas; `15/9` completa el año de hoy en
 * Córdoba y `15/9/26` da 2026; se aceptan `15-09-2026`, `15.09.2026` y
 * `2026-09-15` pegados. El hidden se actualiza apenas el texto es una fecha
 * válida, y con el calendario cerrado **Enter envía el formulario** (no se
 * intercepta). Los errores aparecen al salir del campo.
 *
 * **Calendario.** Desde el botón de adentro del campo o con Alt + ↓: un
 * `role="dialog"` modal («Elegir fecha») donde Tab no se escapa y Esc vuelve al
 * campo. El foco entra en el día elegido (o en hoy). En pantallas táctiles es
 * un diálogo centrado con celdas de 44 px.
 *
 * Las props sueltas (`data-tour`, `aria-*`, manejadores) van al `<input>`
 * visible; `className`, a la caja.
 */
function DatePicker({
  name,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  isDateDisabled,
  disabledReason,
  today: todayProp,
  presets,
  markers,
  captionLayout,
  fromYear,
  toYear,
  clearable = false,
  size,
  invalid,
  align = 'start',
  calendar = true,
  inputRef,
  onLocalErrorChange,
  ref,
  className,
  placeholder = 'dd/mm/aaaa',
  onKeyDown,
  onBlur,
  onFocus,
  onInvalid,
  form,
  ...props
}: DatePickerProps) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const resolvedSize = useControlSize(size)
  const coarse = useMediaQuery(COARSE_POINTER_QUERY)
  const localRef = React.useRef<HTMLInputElement>(null)
  const mergedRef = React.useMemo(() => mergeRefs(localRef, ref, inputRef), [ref, inputRef])
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const contentId = React.useId()
  const hiddenName = name ?? field?.name
  const disabled = props.disabled ?? field?.disabled ?? false
  const readOnly = props.readOnly ?? field?.readOnly ?? false

  const [fallbackToday] = React.useState(() => todayInCordoba())
  const today = todayProp ?? fallbackToday
  const rules: DateFieldRules = { today, min, max, isDateDisabled, disabledReason }

  const [text, setText] = React.useState(() => isoToText(value ?? defaultValue))
  const [open, setOpen] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)
  const check = checkDateText(text, rules)
  const iso = check.status === 'valid' ? check.iso : null

  // Controlado: un cambio de afuera (que no es el eco de lo tipeado) reescribe el texto.
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== undefined && value !== iso) setText(isoToText(value))
  }

  function setError(message: string | null) {
    setLocalError(message)
    if (onLocalErrorChange) onLocalErrorChange(message)
    else reportError(message)
  }

  const validity = check.error ?? ''
  React.useEffect(() => {
    localRef.current?.setCustomValidity(validity)
  }, [validity])

  useFormReset(localRef, () => {
    setError(null)
    const resetIso = defaultValue && isRealIsoDay(defaultValue) ? defaultValue : null
    setText(isoToText(resetIso))
    if (resetIso !== iso) onValueChange?.(resetIso)
  })

  /** Una fecha elegida en el calendario o con un atajo. */
  function choose(next: string) {
    setText(formatIsoDay(next))
    setError(null)
    localRef.current?.setCustomValidity('')
    if (next !== iso) onValueChange?.(next)
    setOpen(false)
  }

  function clear() {
    setText('')
    setError(null)
    localRef.current?.setCustomValidity('')
    if (iso !== null) onValueChange?.(null)
    localRef.current?.focus()
  }

  const canOpen = calendar && !disabled && !readOnly
  const calendarAnchor = check.iso ?? clampIsoDay(today, min, max)
  const todaySelectable = isSelectableDay(today, rules)
  const presetsHaveToday = presets?.some((preset) => preset.value === today) ?? false

  const calendarBody = (
    <div data-slot="date-picker-calendar" className="grid gap-3">
      <Calendar
        selected={iso}
        onSelect={choose}
        defaultMonth={calendarAnchor.slice(0, 7)}
        today={today}
        min={min}
        max={max}
        isDateDisabled={isDateDisabled}
        disabledReason={disabledReason}
        markers={markers}
        captionLayout={captionLayout}
        fromYear={fromYear}
        toYear={toYear}
        className="mx-auto"
      />
      <div
        data-slot="date-picker-footer"
        className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
      >
        {presets?.map((preset) => (
          <Button
            key={`${preset.label}-${preset.value}`}
            type="button"
            variant="secondary"
            size="sm"
            disabled={!isSelectableDay(preset.value, rules)}
            onClick={() => choose(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
        {presetsHaveToday ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!todaySelectable}
            onClick={() => choose(today)}
          >
            Hoy
          </Button>
        )}
      </div>
    </div>
  )

  function focusAfterClose(event: Event) {
    event.preventDefault()
    // Con el dedo, el foco no vuelve al campo: abriría el teclado.
    if (coarse) buttonRef.current?.focus({ preventScroll: true })
    else localRef.current?.focus()
  }

  return (
    <>
      <Popover open={open && !coarse} onOpenChange={setOpen} modal>
        <PopoverAnchor asChild>
          <InputGroup
            size={resolvedSize}
            data-slot="date-picker"
            className={cn(calendar || clearable ? 'pe-2' : undefined, className)}
          >
            <WithoutFieldName>
              <Input
                ref={mergedRef}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={placeholder}
                form={form}
                {...props}
                invalid={invalid || localError !== null}
                value={text}
                onChange={(event) => {
                  const input = event.currentTarget
                  const raw = input.value
                  // La máscara solo con el cursor al final: editar en el medio no se reescribe.
                  const atEnd =
                    input.selectionStart === raw.length && input.selectionEnd === raw.length
                  const next = atEnd ? maskDateTyping(raw, text) : raw
                  setText(next)
                  const nextCheck = checkDateText(next, rules)
                  input.setCustomValidity(nextCheck.error ?? '')
                  if (localError !== null && nextCheck.error === null) setError(null)
                  const nextIso = nextCheck.status === 'valid' ? nextCheck.iso : null
                  if (nextIso !== iso) onValueChange?.(nextIso)
                }}
                onKeyDown={(event) => {
                  onKeyDown?.(event)
                  if (event.defaultPrevented) return
                  if (event.altKey && event.key === 'ArrowDown' && canOpen) {
                    event.preventDefault()
                    setOpen(true)
                  }
                }}
                onFocus={(event) => {
                  scrollIntoViewOnTouch(event)
                  onFocus?.(event)
                }}
                onBlur={(event) => {
                  const target = event.relatedTarget
                  // Ir al propio calendario no es «salir del campo».
                  const toCalendar =
                    target instanceof Node &&
                    (buttonRef.current?.contains(target) || contentRef.current?.contains(target))
                  if (!toCalendar) {
                    if (check.iso) {
                      const tidy = formatIsoDay(check.iso)
                      if (tidy !== text) setText(tidy)
                    }
                    setError(check.error)
                  }
                  onBlur?.(event)
                }}
                onInvalid={(event) => {
                  onInvalid?.(event)
                  event.preventDefault()
                  const input = event.currentTarget
                  setError(
                    check.error ??
                      (input.validity.valueMissing ? DATE_FIELD_MESSAGES.required : null),
                  )
                  focusIfFirstInvalid(input)
                }}
                className="type-amount"
              />
            </WithoutFieldName>
            {clearable && text !== '' && !disabled && !readOnly ? (
              <button
                type="button"
                aria-label="Borrar fecha"
                onClick={clear}
                data-slot="date-picker-clear"
                className={ICON_BUTTON_CLASS}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
            {calendar ? (
              <button
                ref={buttonRef}
                type="button"
                aria-label="Elegir fecha"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? contentId : undefined}
                disabled={!canOpen}
                onClick={() => setOpen((was) => !was)}
                data-slot="date-picker-trigger"
                className={ICON_BUTTON_CLASS}
              >
                <CalendarDays className="size-4" aria-hidden />
              </button>
            ) : null}
          </InputGroup>
        </PopoverAnchor>
        <PopoverContent
          ref={contentRef}
          id={contentId}
          aria-modal="true"
          aria-label="Elegir fecha"
          align={align}
          size="auto"
          className="p-3"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            focusCalendarDay(contentRef.current)
          }}
          onCloseAutoFocus={focusAfterClose}
        >
          {calendarBody}
        </PopoverContent>
      </Popover>
      {coarse ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            ref={contentRef}
            id={contentId}
            size="sm"
            aria-describedby={undefined}
            // 7 celdas de 44 px = 308: en un teléfono de 360 px solo entran con 8 px de costado.
            className="w-fit gap-3 px-2 pt-5 pb-3 sm:p-4"
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              focusCalendarDay(contentRef.current)
            }}
            onCloseAutoFocus={focusAfterClose}
          >
            <DialogHeader>
              <DialogTitle>Elegir fecha</DialogTitle>
            </DialogHeader>
            {calendarBody}
          </DialogContent>
        </Dialog>
      ) : null}
      {hiddenName ? (
        <input type="hidden" name={hiddenName} value={iso ?? ''} disabled={disabled} form={form} />
      ) : null}
    </>
  )
}

export { DatePicker }
