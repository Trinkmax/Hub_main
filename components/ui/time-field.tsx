'use client'

import { Clock } from 'lucide-react'
import * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import { DatePicker } from '@/components/ui/date-picker'
import {
  formResetTarget,
  useField,
  useFieldErrorReporter,
  useFieldLabelId,
  useFormReset,
  WithoutFieldName,
} from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { parseTimeInput } from '@/lib/dates/parse'
import {
  checkTimeText,
  maskTimeTyping,
  nearestSuggestionIndex,
  stepTimeValue,
  TIME_FIELD_MESSAGES,
  type TimeFieldRules,
  timeOrder,
  timeSuggestions,
} from '@/lib/dates/time-field'
import { focusIfFirstInvalid, mergeRefs, scrollIntoViewOnTouch } from '@/lib/dom/form-control'
import { cn } from '@/lib/utils'

/** `'21:30'` o `'21:30:00'` (Postgres) → `'21:30'`; cualquier otra cosa, vacío. */
function normalizeTime(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = parseTimeInput(value)
  return parsed.ok ? parsed.time : ''
}

export type TimeFieldProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'min' | 'max' | 'step' | 'inputMode'
> & {
  /** Va en el `<input type="hidden">` como `"HH:mm"`, igual que el nativo: las acciones no cambian. */
  name?: string
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (hhmm: string | null) => void
  /** `"HH:mm"` inclusivo. */
  min?: string
  /** `"HH:mm"` inclusivo. */
  max?: string
  /** Minutos. Default 15 (el `step={900}` de antes). */
  step?: number
  /** Lista de horarios: `true` = de min a max cada `step`, o la lista exacta. */
  suggestions?: boolean | string[]
  /** Servicio de noche: 00:30 va después de 23:45. */
  crossesMidnight?: boolean
  size?: ControlSize
  invalid?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  /** Para campos compuestos (DateTimeField): recibe el error local en vez del Field. */
  onLocalErrorChange?: (message: string | null) => void
}

/**
 * La hora (kit §3.2), propia y no el `<input type="time">`: el nativo muestra
 * AM/PM según el idioma del sistema y se ve distinto en cada navegador. Este es
 * 24 h siempre, tipeable y con flechas.
 *
 * - `2130` → 21:30 · `930` → 09:30 · `9` → 09:00 · `21.30` y `21h30` → 21:30.
 * - ↑ ↓ suman o restan `step` (Mayús: 60 minutos), dentro de `min` y `max`.
 * - Con `suggestions` es un combobox: la lista se abre al tomar foco o con
 *   Alt + ↓, las flechas recorren los horarios y un click elige.
 * - El hidden se actualiza apenas se lee una hora; **Enter no se intercepta**.
 *
 * **Formularios y React 19** (ver `useFormReset` en `field.tsx`): después de
 * un `<form action>`, React resetea el formulario. Sin `value`, vuelve a su
 * `defaultValue` (y, mientras nadie lo toque, sigue al `defaultValue` que
 * cambie, como un `<input>` nativo). Controlado sin `defaultValue`, el reset no
 * lo toca.
 */
function TimeField({
  name,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 15,
  suggestions = false,
  crossesMidnight = false,
  size,
  invalid,
  inputRef,
  onLocalErrorChange,
  ref,
  className,
  placeholder = 'hh:mm',
  onKeyDown,
  onBlur,
  onFocus,
  onInvalid,
  form,
  ...props
}: TimeFieldProps) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const resolvedSize = useControlSize(size)
  const localRef = React.useRef<HTMLInputElement>(null)
  const mergedRef = React.useMemo(() => mergeRefs(localRef, ref, inputRef), [ref, inputRef])
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const hiddenName = name ?? field?.name
  const disabled = props.disabled ?? field?.disabled ?? false
  const readOnly = props.readOnly ?? field?.readOnly ?? false
  const rules: TimeFieldRules & { step: number } = { min, max, crossesMidnight, step }

  const [text, setText] = React.useState(() => normalizeTime(value ?? defaultValue))
  const [open, setOpen] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)
  const check = checkTimeText(text, rules)
  const time = check.status === 'valid' ? check.time : null

  const options = React.useMemo(() => {
    if (Array.isArray(suggestions)) return suggestions.map(normalizeTime).filter(Boolean)
    if (!suggestions) return []
    return timeSuggestions({ min, max, step, crossesMidnight })
  }, [suggestions, min, max, step, crossesMidnight])
  const hasList = options.length > 0
  const canList = hasList && !disabled && !readOnly

  // Tocado desde que montó (o desde el último reset), como el «dirty» de un <input>.
  const [edited, setEdited] = React.useState(false)

  // Controlado: un cambio de afuera (que no es el eco de lo tipeado) reescribe el texto.
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    const normalized = normalizeTime(value)
    if (value !== undefined && (normalized || null) !== time) setText(normalized)
  }

  // No controlado y sin tocar: sigue al `defaultValue` que cambie, como un <input> nativo.
  const [lastDefault, setLastDefault] = React.useState(defaultValue)
  if (defaultValue !== lastDefault) {
    setLastDefault(defaultValue)
    if (value === undefined && !edited) setText(normalizeTime(defaultValue))
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
    setEdited(false)
    // Controlado sin `defaultValue`: el reset (también el de React 19 después
    // de un `<form action>`) no borra lo que el `value` dice.
    const target = formResetTarget(value, defaultValue)
    if (target.keep) {
      setText(normalizeTime(value))
      return
    }
    const resetTime = normalizeTime(target.to)
    setText(resetTime)
    if ((resetTime || null) !== time) onValueChange?.(resetTime || null)
  })

  /** Pone una hora (flechas o lista): el texto ya sale como `HH:mm`. */
  function commit(next: string) {
    setText(next)
    setEdited(true)
    if (localError !== null) setError(null)
    localRef.current?.setCustomValidity(checkTimeText(next, rules).error ?? '')
    if (next !== time) onValueChange?.(next)
  }

  /** ↑ ↓: con lista, el horario siguiente o anterior de la lista; sin lista, de a `step`. */
  function stepBy(direction: 1 | -1, big: boolean) {
    const base = time ?? check.time
    if (hasList && !big) {
      const order = base ? timeOrder(base, rules) : null
      const sorted = options
      let index: number
      if (order === null) index = direction > 0 ? 0 : sorted.length - 1
      else if (direction > 0) {
        index = sorted.findIndex((option) => (timeOrder(option, rules) ?? -1) > order)
        if (index === -1) index = sorted.length - 1
      } else {
        index = -1
        sorted.forEach((option, i) => {
          if ((timeOrder(option, rules) ?? Number.POSITIVE_INFINITY) < order) index = i
        })
        if (index === -1) index = 0
      }
      const next = sorted[index]
      if (next) commit(next)
      return
    }
    commit(stepTimeValue(base, direction, { ...rules, delta: big ? 60 : step }))
  }

  const activeIndex = hasList && time ? options.indexOf(time) : -1
  const activeId = open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined

  // Al abrir (o al cambiar la hora con la lista abierta), el horario actual o
  // el más cercano queda a la vista.
  React.useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const index =
      activeIndex >= 0 ? activeIndex : nearestSuggestionIndex(options, check.time, rules)
    list.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  return (
    <>
      <Popover open={open && canList} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <InputGroup size={resolvedSize} data-slot="time-field" className={className}>
            <WithoutFieldName>
              <Input
                ref={mergedRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={placeholder}
                role={hasList ? 'combobox' : undefined}
                aria-expanded={hasList ? open && canList : undefined}
                aria-controls={hasList ? listId : undefined}
                aria-autocomplete={hasList ? 'none' : undefined}
                aria-activedescendant={activeId}
                form={form}
                {...props}
                invalid={invalid || localError !== null}
                value={text}
                onChange={(event) => {
                  const input = event.currentTarget
                  const raw = input.value
                  const atEnd =
                    input.selectionStart === raw.length && input.selectionEnd === raw.length
                  const next = atEnd ? maskTimeTyping(raw, text) : raw
                  setText(next)
                  setEdited(true)
                  const nextCheck = checkTimeText(next, rules)
                  input.setCustomValidity(nextCheck.error ?? '')
                  if (localError !== null && nextCheck.error === null) setError(null)
                  const nextTime = nextCheck.status === 'valid' ? nextCheck.time : null
                  if (nextTime !== time) onValueChange?.(nextTime)
                }}
                onKeyDown={(event) => {
                  onKeyDown?.(event)
                  if (event.defaultPrevented || readOnly || disabled) return
                  if (event.key === 'ArrowDown' && event.altKey) {
                    if (canList) {
                      event.preventDefault()
                      setOpen(true)
                    }
                    return
                  }
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    // Con la lista a la vista, ↓ baja por la lista (más tarde),
                    // como en cualquier lista. Cerrada, ↑ suma como un spinbutton.
                    const later =
                      open && canList ? event.key === 'ArrowDown' : event.key === 'ArrowUp'
                    stepBy(later ? 1 : -1, event.shiftKey)
                    return
                  }
                  if (event.key === 'Escape' && open) {
                    // Cierra la lista sin cerrar el diálogo que contenga el campo.
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(false)
                  }
                }}
                onFocus={(event) => {
                  scrollIntoViewOnTouch(event)
                  if (canList) setOpen(true)
                  onFocus?.(event)
                }}
                onClick={() => {
                  if (canList) setOpen(true)
                }}
                onBlur={(event) => {
                  setOpen(false)
                  // Prolijo si se lee, aunque quede afuera del rango (el error lo explica).
                  if (check.time && check.time !== text) setText(check.time)
                  setError(check.error)
                  onBlur?.(event)
                }}
                onInvalid={(event) => {
                  onInvalid?.(event)
                  event.preventDefault()
                  const input = event.currentTarget
                  setError(
                    check.error ??
                      (input.validity.valueMissing ? TIME_FIELD_MESSAGES.required : null),
                  )
                  focusIfFirstInvalid(input)
                }}
                className="type-amount"
              />
            </WithoutFieldName>
            <InputAddon side="end" aria-hidden className="text-subtle-foreground">
              <Clock />
            </InputAddon>
          </InputGroup>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          size="auto"
          className="min-w-(--radix-popover-trigger-width) p-1"
          // El foco se queda en el campo: la lista se maneja con las flechas.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target
            if (target instanceof Node && localRef.current?.contains(target)) event.preventDefault()
          }}
        >
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Horarios"
            data-slot="time-field-list"
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {options.map((option, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: el teclado lo maneja el campo (flechas, aria-activedescendant); el click es para el mouse
              <div
                key={option}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={option === time}
                data-index={index}
                data-active={index === activeIndex ? '' : undefined}
                // Elegir con el mouse no le saca el foco al campo.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  commit(option)
                  setOpen(false)
                }}
                className={cn(
                  'flex min-h-8 cursor-default items-center rounded-md px-3 type-body type-amount select-none pointer-coarse:min-h-11',
                  'hover:bg-accent data-active:bg-accent data-active:font-medium',
                )}
              >
                {option}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {hiddenName ? (
        <input type="hidden" name={hiddenName} value={time ?? ''} disabled={disabled} form={form} />
      ) : null}
    </>
  )
}

/** `'2026-09-15T21:30'` → `{ date, time }`; lo que no se lee queda en `null`. */
export function splitDateTime(value: string | null | undefined): {
  date: string | null
  time: string | null
} {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value ?? '')
  return { date: m?.[1] ?? null, time: m?.[2] ?? null }
}

/** `{ date, time }` → `'2026-09-15T21:30'` (lo que manda un `datetime-local`), o `null` si falta algo. */
export function joinDateTime(date: string | null, time: string | null): string | null {
  return date && time ? `${date}T${time}` : null
}

export type DateTimeFieldProps = Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  /** Va en el `<input type="hidden">` como `"YYYY-MM-DDTHH:mm"`, igual que `datetime-local`. */
  name?: string
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null) => void
  minDate?: string
  maxDate?: string
  /** Minutos. Default 15. */
  step?: number
  size?: ControlSize
  disabled?: boolean
  required?: boolean
  /** Nombre del campo de hora para el lector. Default «Hora». */
  timeLabel?: string
}

/**
 * Fecha y hora juntas (kit §3.2): un DatePicker y un TimeField, con un solo
 * hidden como el de `datetime-local` (las difusiones programadas no cambian).
 * Los dos errores locales se juntan en el del Field: si cada control lo
 * avisara por su cuenta, el segundo pisaría al primero.
 */
function DateTimeField({
  name,
  value,
  defaultValue,
  onValueChange,
  minDate,
  maxDate,
  step,
  size,
  disabled,
  required,
  timeLabel = 'Hora',
  className,
  ...props
}: DateTimeFieldProps) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const fieldLabelId = useFieldLabelId()
  const timeLabelId = React.useId()
  const autoId = React.useId()
  const hiddenName = name ?? field?.name
  const isDisabled = disabled ?? field?.disabled ?? false
  const initial = splitDateTime(value ?? defaultValue)
  const [date, setDate] = React.useState(initial.date)
  const [time, setTime] = React.useState(initial.time)
  const errors = React.useRef<{ date: string | null; time: string | null }>({
    date: null,
    time: null,
  })

  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== undefined && value !== joinDateTime(date, time)) {
      const next = splitDateTime(value)
      setDate(next.date)
      setTime(next.time)
    }
  }

  function report(part: 'date' | 'time', message: string | null) {
    errors.current[part] = message
    reportError(errors.current.date ?? errors.current.time)
  }

  function update(nextDate: string | null, nextTime: string | null) {
    const before = joinDateTime(date, time)
    setDate(nextDate)
    setTime(nextTime)
    const after = joinDateTime(nextDate, nextTime)
    if (after !== before) onValueChange?.(after)
  }

  const timeId = `${field?.id ?? autoId}-time`
  const combined = joinDateTime(date, time)
  // Para `form.reset()` (también el de React 19 después de un `<form action>`):
  // cada control vuelve a su parte del valor de arranque, o se vacía. Los dos
  // van controlados, así que esa parte les llega como su `defaultValue`.
  // Controlado y sin `defaultValue`, el reset no toca nada (`undefined`).
  const resetParts =
    value === undefined || defaultValue !== undefined ? splitDateTime(defaultValue) : undefined

  return (
    <div
      data-slot="date-time-field"
      className={cn('grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)] gap-2', className)}
      {...props}
    >
      <WithoutFieldName>
        <DatePicker
          value={date}
          defaultValue={resetParts?.date}
          onValueChange={(next) => update(next, time)}
          min={minDate}
          max={maxDate}
          size={size}
          disabled={disabled}
          required={required}
          onLocalErrorChange={(message) => report('date', message)}
        />
        <TimeField
          id={timeId}
          value={time}
          defaultValue={resetParts?.time}
          onValueChange={(next) => update(date, next)}
          step={step}
          size={size}
          disabled={disabled}
          required={required}
          aria-label={fieldLabelId ? undefined : timeLabel}
          aria-labelledby={fieldLabelId ? `${fieldLabelId} ${timeLabelId}` : undefined}
          onLocalErrorChange={(message) => report('time', message)}
        />
      </WithoutFieldName>
      <span id={timeLabelId} hidden>
        {timeLabel}
      </span>
      {hiddenName ? (
        <input type="hidden" name={hiddenName} value={combined ?? ''} disabled={isDisabled} />
      ) : null}
    </div>
  )
}

export { DateTimeField, TimeField }
