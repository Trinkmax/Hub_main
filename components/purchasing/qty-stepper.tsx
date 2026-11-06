'use client'

import { Minus, Plus } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { formatQty, parseQty, roundQty } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'

/**
 * − [ 66 ] +: el número que se corrige con el pulgar. Acepta coma («2,5»), nunca baja de cero y deja
 * escribir libre: el valor se toma al salir del campo o con Enter.
 */
export function QtyStepper({
  value,
  onChange,
  step = 1,
  label,
  suffix,
  placeholder,
  size = 'md',
  className,
}: {
  value: number | null
  onChange: (next: number | null) => void
  step?: number
  /** Para lectores de pantalla: «Cuánto pedir de Kanikama». */
  label: string
  suffix?: string
  placeholder?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const id = useId()
  const [text, setText] = useState(value == null ? '' : formatQty(value))
  useEffect(() => {
    setText(value == null ? '' : formatQty(value))
  }, [value])

  const commit = (raw: string) => {
    if (!raw.trim()) {
      onChange(null)
      return
    }
    const n = parseQty(raw)
    if (n == null) {
      setText(value == null ? '' : formatQty(value))
      return
    }
    onChange(n)
  }
  const bump = (delta: number) => onChange(Math.max(0, roundQty((value ?? 0) + delta)))
  const h = size === 'sm' ? 'h-10' : 'h-12'

  return (
    <div
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-xl border border-input bg-background',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => bump(-step)}
        disabled={(value ?? 0) <= 0}
        aria-label={`Restar ${formatQty(step)}`}
        className={cn(
          h,
          'grid w-11 place-items-center text-foreground transition-colors active:bg-muted disabled:opacity-35',
        )}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={cn(
          h,
          'w-16 min-w-0 border-x border-input bg-transparent text-center text-base font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:bg-accent/40',
        )}
      />
      {suffix ? (
        <span
          className={cn(
            h,
            'grid place-items-center border-r border-input px-2 text-sm text-muted-foreground',
          )}
        >
          {suffix}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => bump(step)}
        aria-label={`Sumar ${formatQty(step)}`}
        className={cn(
          h,
          'grid w-11 place-items-center text-foreground transition-colors active:bg-muted',
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}
