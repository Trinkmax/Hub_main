'use client'

import { LoaderCircle, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** Cuánto se espera después del último toque antes de guardar: varios toques, un solo guardado. */
const SETTLE_MS = 650

const ROUND_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-35 sm:size-9 motion-reduce:transition-none motion-reduce:active:scale-100'

/**
 * Minutos, con menos y más. Se toca varias veces seguidas y se guarda UNA vez, cuando la
 * persona para (o cuando sale del control). También se puede escribir el número.
 *
 * - Flecha arriba y abajo suman y restan un paso; AvPág y RePág, cinco.
 * - El número se queda siempre dentro de `min` y `max`, y en múltiplos de `step`.
 */
export function MinuteStepper({
  caption,
  label,
  value,
  min,
  max,
  step = 1,
  saving = false,
  onCommit,
  testId,
}: {
  /** Lo que se lee al lado: «Avisa a los», «Roja a los». */
  caption: string
  /** Para lectores, con la situación entera: «Sin pedido: avisa a los». */
  label: string
  value: number
  min: number
  max: number
  step?: number
  saving?: boolean
  onCommit: (minutes: number) => void
  testId?: string
}) {
  // `null` = se muestra lo guardado; con número = lo que la persona va eligiendo.
  const [draft, setDraft] = useState<number | null>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const pending = useRef<number | null>(null)
  const latest = useRef({ value, onCommit })
  useEffect(() => {
    latest.current = { value, onCommit }
  })

  const shown = draft ?? value

  const snap = (minutes: number) => {
    const stepped = Math.round(minutes / step) * step
    const low = Math.ceil(min / step) * step
    const high = Math.floor(max / step) * step
    return Math.min(high, Math.max(low, stepped))
  }

  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    setDraft(null)
    if (next !== null && next !== latest.current.value) latest.current.onCommit(next)
  }

  const choose = (minutes: number, wait: boolean) => {
    const next = snap(minutes)
    pending.current = next
    setDraft(next)
    if (timer.current !== null) window.clearTimeout(timer.current)
    if (wait) timer.current = window.setTimeout(flush, SETTLE_MS)
    else flush()
  }

  // Si la pantalla se va con un cambio sin guardar (cambió de pestaña a los apurones), se guarda.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      const next = pending.current
      pending.current = null
      if (next !== null && next !== latest.current.value) latest.current.onCommit(next)
    },
    [],
  )

  const commitTyped = () => {
    if (typed === null) return
    const digits = typed.replace(/\D/g, '')
    setTyped(null)
    // Vacío no es cero: un campo borrado vuelve a lo que había.
    if (digits !== '') choose(Number(digits), false)
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-sm text-muted-foreground">{caption}</span>
      <div
        className={cn(
          'inline-flex items-center rounded-full border border-border/70 bg-card shadow-2xs',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30',
        )}
      >
        <button
          type="button"
          aria-label={`${label}: un paso menos`}
          disabled={shown <= snap(min)}
          onClick={() => choose(shown - step, true)}
          className={ROUND_BUTTON}
        >
          <Minus aria-hidden className="size-4" />
        </button>
        <span className="relative flex items-baseline justify-center gap-1 px-0.5">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            role="spinbutton"
            data-testid={testId}
            aria-label={label}
            aria-valuenow={shown}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={`${shown} minutos`}
            aria-busy={saving ? true : undefined}
            value={typed ?? String(shown)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTyped(event.target.value.replace(/\D/g, '').slice(0, 3))}
            onBlur={() => {
              commitTyped()
              // Salir del control guarda ya lo que quedó elegido con los botones.
              if (pending.current !== null) flush()
            }}
            onKeyDown={(event) => {
              const jump =
                event.key === 'ArrowUp'
                  ? step
                  : event.key === 'ArrowDown'
                    ? -step
                    : event.key === 'PageUp'
                      ? step * 5
                      : event.key === 'PageDown'
                        ? -step * 5
                        : 0
              if (jump !== 0) {
                event.preventDefault()
                setTyped(null)
                choose(shown + jump, true)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                commitTyped()
                if (pending.current !== null) flush()
              } else if (event.key === 'Escape' && (typed !== null || draft !== null)) {
                event.preventDefault()
                event.stopPropagation()
                if (timer.current !== null) window.clearTimeout(timer.current)
                timer.current = null
                pending.current = null
                setTyped(null)
                setDraft(null)
              }
            }}
            className="w-[3.25ch] bg-transparent text-center text-base font-semibold tabular-nums outline-none"
          />
          <span aria-hidden className="text-sm text-muted-foreground">
            min
          </span>
          {saving ? (
            <LoaderCircle
              aria-hidden
              className="absolute -top-2 right-0 size-3 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
          ) : null}
        </span>
        <button
          type="button"
          aria-label={`${label}: un paso más`}
          disabled={shown >= snap(max)}
          onClick={() => choose(shown + step, true)}
          className={ROUND_BUTTON}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  )
}
