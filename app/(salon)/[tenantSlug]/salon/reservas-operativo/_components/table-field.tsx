'use client'

import { Armchair, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { TABLE_LABEL_MAX } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * El campo de mesa del panel de mozos.
 *
 * Texto libre corto a propósito: en el HUB se juntan mesas para los grupos
 * grandes ("12+13") y hay lugares que no son número ("Barra"). Por eso NO va
 * `type="number"` ni `inputMode="numeric"`: en iOS ese teclado es solo dígitos
 * y el mozo no podría escribir ninguna de esas dos cosas. Sí `autoCapitalize`,
 * que es lo único que ayuda cuando la mesa es una palabra.
 *
 * Mismo criterio que el editor del tablero del manager (`TableEditor`), pero
 * sin atajos ni avisos de mesa ocupada: el mozo carga la mesa a la que él mismo
 * acaba de llevar a la gente, con el celular en una mano.
 */
export function TableField({
  id,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  onSubmit,
  label,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  autoFocus?: boolean
  onSubmit?: () => void
  /** Solo donde no hay un `<label>` visible al lado (el sheet de cambiar mesa). */
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  // El Sheet anima al abrir: enfocar en el mismo tick pierde el foco (y en iOS
  // no levanta el teclado). Mismo delay que usa el editor del manager.
  useEffect(() => {
    if (!autoFocus) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [autoFocus])

  return (
    <div className="relative">
      <Armchair
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        enterKeyHint="done"
        maxLength={TABLE_LABEL_MAX}
        value={value}
        disabled={disabled}
        aria-label={label}
        placeholder="12, 12+13, Barra"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          onSubmit?.()
        }}
        className={cn(
          'h-14 w-full rounded-2xl border border-border bg-card pl-12 pr-12 text-center text-xl font-semibold tabular-nums outline-none transition-colors',
          'placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground/60',
          'focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:opacity-60',
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Quitar mesa"
          disabled={disabled}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/**
 * Deja la etiqueta como la va a guardar la DB (trim + espacios colapsados), para
 * poder comparar contra la mesa actual y no mandar una escritura que no cambia
 * nada. Espeja `tableLabelField` (zod) y la RPC `set_reservation_table_label`.
 */
export function cleanTableLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
