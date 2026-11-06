'use client'

import { AlertTriangle, Minus, Plus } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Alto de los campos: 44 px con el dedo, 40 en la compu. */
export const FIELD_INPUT = 'h-11 md:h-10'
export const FIELD_SELECT = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'

/**
 * Un campo con su etiqueta, la ayuda abajo y el error en lugar de la ayuda. El control va como hijo y
 * tiene que llevar `id={id}` y `aria-describedby={describedBy(id, …)}`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id} className="gap-1.5">
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** El `aria-describedby` que corresponde a lo que muestra `Field` debajo del control. */
export function describedBy(id: string, hint: boolean, error: string | null | undefined) {
  if (error) return `${id}-error`
  return hint ? `${id}-hint` : undefined
}

/** Una píldora que se rellena cuando está elegida (filtros, frecuencia, días). */
export function Pill({
  pressed,
  className,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'type'> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors md:h-9 md:px-3.5',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        pressed
          ? 'border-primary bg-primary text-primary-foreground shadow-xs'
          : 'border-border bg-card/70 text-foreground hover:bg-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/** El contador chico adentro de una píldora. */
export function PillCount({ value, pressed }: { value: number; pressed: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums',
        pressed ? 'bg-primary-foreground/20' : 'bg-secondary text-foreground',
      )}
    >
      {value.toLocaleString('es-AR')}
    </span>
  )
}

/** Un aviso en ámbar, con el ícono: «Sin WhatsApp no se abre el chat con el pedido». */
export function WarningNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-sm leading-snug text-warning-text',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  )
}

/** Un número chico con − y + (días de anticipación). */
export function NumberStepper({
  id,
  value,
  min,
  max,
  onChange,
  format,
  decreaseLabel,
  increaseLabel,
  describedById,
}: {
  id: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Lo que se lee en el medio: «1 día». */
  format: (value: number) => string
  decreaseLabel: string
  increaseLabel: string
  describedById?: string
}) {
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)))
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= min}
        aria-label={decreaseLabel}
        aria-controls={id}
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-2xs transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 md:size-10"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <output
        id={id}
        aria-live="polite"
        aria-describedby={describedById}
        className="min-w-24 text-center font-serif text-2xl font-semibold tabular-nums"
      >
        {format(value)}
      </output>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= max}
        aria-label={increaseLabel}
        aria-controls={id}
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-2xs transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 md:size-10"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/** «Azúcar» y «azucar» son lo mismo para buscar. */
export function searchKey(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** ¿Todas las palabras de la búsqueda aparecen en alguno de los textos? */
export function matchesSearch(query: string, texts: ReadonlyArray<string | null | undefined>) {
  const words = searchKey(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = texts.map(searchKey).join(' ')
  return words.every((word) => haystack.includes(word))
}

/** «falta el proveedor.» → «Falta el proveedor.» */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('es-AR') + text.slice(1)
}

/** Para editar un número guardado: 2.5 → «2,5». */
export function qtyInputText(value: number | null | undefined): string {
  return value == null ? '' : String(value).replace('.', ',')
}
