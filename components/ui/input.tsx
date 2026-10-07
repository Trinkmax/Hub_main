'use client'

import { Search, X } from 'lucide-react'
import * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import { useFieldControl, useFormReset } from '@/components/ui/field'
import { cn } from '@/lib/utils'

export type InputProps = Omit<React.ComponentProps<'input'>, 'size'> & {
  /** Default `md` (o el del `ControlSizeProvider`): 36 px con mouse, 44 con el dedo. Antes medía 40. */
  size?: ControlSize
  /** Atajo de `aria-invalid`. */
  invalid?: boolean
}

const HEIGHT: Record<ControlSize, string> = {
  sm: 'h-(--control-sm)',
  md: 'h-(--control-md)',
  lg: 'h-(--control-lg)',
}

/**
 * El aspecto de un campo, compartido por Input, Textarea, el disparador del
 * Select y los compuestos (CodeField, MoneyField…): cartulina, borde de campo
 * de 3:1, letra de 14 px (16 con el dedo: iOS no hace zoom) y foco «sobre el
 * borde», que cubre el borde de 1 px sin mover nada y se ve en alto contraste.
 */
const fieldSurface = [
  'w-full min-w-0 rounded-md border border-input bg-card text-foreground',
  'text-(length:--control-font)',
  'outline-(--ring) -outline-offset-1 focus-visible:outline-2',
  'aria-invalid:border-destructive aria-invalid:outline-(--destructive)',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50',
].join(' ')

/** Solo lectura: seleccionable y enfocable, con fondo apagado y el pelo común. */
const fieldReadOnly = '[&[readonly]]:border-border [&[readonly]]:bg-muted'

const inputClasses = [
  fieldSurface,
  fieldReadOnly,
  'px-3 py-1 placeholder:text-subtle-foreground',
  'selection:bg-primary selection:text-primary-foreground',
  // El autocompletar de Chrome pinta su fondo con una sombra interior; sin el
  // color de texto, en oscuro dejaba texto negro sobre fondo oscuro. El foco es
  // outline, así que este truco no lo tapa.
  'autofill:shadow-[inset_0_0_0_100px_var(--card)] autofill:[-webkit-text-fill-color:var(--foreground)]',
  'file:me-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
].join(' ')

/**
 * Campo de texto (§3.2). Misma API que siempre (226 usos) + `size` e `invalid`.
 * Adentro de un `Field` toma de ahí id, name, aria-describedby, aria-invalid,
 * required, disabled y readOnly; lo propio gana.
 *
 * Para números va `NumberField` y para plata `MoneyField`: `type="number"`
 * sigue andando, pero está desaconsejado.
 */
function Input({ className, type, size, invalid, ...props }: InputProps) {
  const resolvedSize = useControlSize(size)
  const control = useFieldControl({
    ...props,
    'aria-invalid': invalid ? true : props['aria-invalid'],
  })
  return (
    <input
      data-slot="input"
      data-size={resolvedSize}
      type={type}
      {...control}
      className={cn(inputClasses, HEIGHT[resolvedSize], className)}
    />
  )
}

export type InputGroupProps = React.ComponentProps<'div'> & {
  size?: ControlSize
}

/**
 * Prefijos y sufijos sin posicionar spans a mano:
 *
 * ```tsx
 * <InputGroup>
 *   <InputAddon>$</InputAddon>
 *   <Input />
 *   <InputAddon side="end">días</InputAddon>
 * </InputGroup>
 * ```
 *
 * El grupo es la caja (borde, fondo, foco); el Input de adentro pierde los
 * suyos y ocupa el resto. El foco se ve en el grupo cuando el Input lo tiene.
 */
function InputGroup({ className, size, ...props }: InputGroupProps) {
  const resolvedSize = useControlSize(size)
  return (
    <div
      data-slot="input-group"
      data-size={resolvedSize}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-foreground',
        'text-(length:--control-font)',
        HEIGHT[resolvedSize],
        'outline-(--ring) -outline-offset-1 has-[[data-slot=input]:focus-visible]:outline-2',
        'has-[[data-slot=input][aria-invalid=true]]:border-destructive has-[[data-slot=input][aria-invalid=true]]:outline-(--destructive)',
        'has-[[data-slot=input]:disabled]:cursor-not-allowed has-[[data-slot=input]:disabled]:bg-muted has-[[data-slot=input]:disabled]:opacity-50',
        'has-[[data-slot=input][readonly]]:border-border has-[[data-slot=input][readonly]]:bg-muted',
        // El Input de adentro: sin caja propia, ocupa el alto y el resto del ancho.
        '[&>[data-slot=input]]:h-full [&>[data-slot=input]]:flex-1 [&>[data-slot=input]]:rounded-none',
        '[&>[data-slot=input]]:border-0 [&>[data-slot=input]]:bg-transparent [&>[data-slot=input]]:px-0',
        '[&>[data-slot=input]]:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export type InputAddonProps = React.ComponentProps<'span'> & {
  side?: 'start' | 'end'
}

/** «$», «días», un ícono: texto 2, sin cortar, del lado que toque. */
function InputAddon({ side = 'start', className, ...props }: InputAddonProps) {
  return (
    <span
      data-slot="input-addon"
      data-side={side}
      className={cn(
        "flex shrink-0 items-center text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-4",
        side === 'end' && 'order-last',
        className,
      )}
      {...props}
    />
  )
}

export type SearchFieldProps = Omit<InputProps, 'type'> & {
  /** Se llama al tocar «Limpiar» o con Esc. */
  onClear?: () => void
  /** Default 200 ms, solo en modo cliente (con `onDebouncedChange`). */
  debounceMs?: number
  onDebouncedChange?: (q: string) => void
}

/**
 * Buscador (§3.2): lupa, botón «Limpiar» y Esc limpia. `name="q"` por defecto,
 * así sirve tal cual en filtros por GET; con `onDebouncedChange` filtra en el
 * cliente (200 ms por defecto).
 */
function SearchField({
  className,
  size,
  value,
  defaultValue,
  onChange,
  onKeyDown,
  onClear,
  debounceMs = 200,
  onDebouncedChange,
  name = 'q',
  placeholder = 'Buscar…',
  ...props
}: SearchFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isControlled = value !== undefined
  const [inner, setInner] = React.useState(() => String(defaultValue ?? ''))
  const current = isControlled ? String(value ?? '') : inner
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  useFormReset(inputRef, () => {
    if (!isControlled) setInner(String(defaultValue ?? ''))
  })

  function schedule(q: string) {
    if (!onDebouncedChange) return
    if (timer.current) clearTimeout(timer.current)
    // El callback de esta tecla: el del último render, que es el que importa.
    timer.current = setTimeout(() => onDebouncedChange(q), debounceMs)
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current)
    if (!isControlled) setInner('')
    onClear?.()
    onDebouncedChange?.('')
    inputRef.current?.focus()
  }

  return (
    <InputGroup size={size} data-slot="search-field" className={className}>
      <InputAddon>
        <Search aria-hidden />
      </InputAddon>
      <Input
        ref={inputRef}
        type="search"
        name={name}
        placeholder={placeholder}
        autoComplete="off"
        {...props}
        value={current}
        onChange={(event) => {
          if (!isControlled) setInner(event.target.value)
          onChange?.(event)
          schedule(event.target.value)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          // Esc limpia si hay texto; si no, sigue de largo (cierra el diálogo
          // que lo contenga, por ejemplo).
          if (!event.defaultPrevented && event.key === 'Escape' && current !== '') {
            event.preventDefault()
            event.stopPropagation()
            clear()
          }
        }}
        // La «x» nativa de type=search se esconde: está el botón propio.
        className="[&::-webkit-search-cancel-button]:appearance-none"
      />
      {current !== '' ? (
        <InputAddon side="end">
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={clear}
            className="relative hit-area -me-1 flex size-6 items-center justify-center rounded-sm text-subtle-foreground outline-offset-2 outline-(--ring) hover:bg-hover hover:text-foreground focus-visible:outline-2"
          >
            <X className="size-4" aria-hidden />
          </button>
        </InputAddon>
      ) : null}
    </InputGroup>
  )
}

export { fieldReadOnly, fieldSurface, Input, InputAddon, InputGroup, SearchField }
