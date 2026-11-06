'use client'

import { Check, X } from 'lucide-react'
import { memo, useEffect, useId, useState } from 'react'
import type { EventNeed } from '@/lib/purchasing/events'
import type { CountState, PurItem } from '@/lib/purchasing/types'
import { formatQty, parseQty, roundQty, unitShort } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'

export type LocalLine = { state: CountState; quantity: number | null }

/** Las tres teclas de la cocina, con su color: verde alcanza, ámbar poco, naranja no hay. */
const tone = {
  enough: 'border-primary/25 bg-accent text-primary',
  low: 'border-warning/40 bg-warning/15 text-warning-text',
  none: 'border-destructive/30 bg-destructive/10 text-destructive',
} as const

function StateButton({
  kind,
  selected,
  onClick,
  children,
}: {
  kind: keyof typeof tone
  selected?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      onClick={onClick}
      className={cn(
        'flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-[0.95rem] font-semibold transition-colors active:scale-[0.98]',
        selected
          ? tone[kind]
          : cn(
              'border-border bg-card active:bg-muted',
              kind === 'enough' && 'text-primary',
              kind === 'low' && 'text-warning-text',
              kind === 'none' && 'text-destructive',
            ),
      )}
    >
      {children}
    </button>
  )
}

/** Un número escrito con el teclado del celular: se toma al salir del campo o con «listo». */
function QtyField({
  value,
  unit,
  label,
  placeholder,
  onCommit,
  className,
}: {
  value: number | null
  unit: string
  label: string
  placeholder: string
  onCommit: (n: number | null) => void
  className?: string
}) {
  const id = useId()
  const [text, setText] = useState(value == null ? '' : formatQty(value))
  useEffect(() => {
    setText(value == null ? '' : formatQty(value))
  }, [value])
  const commit = (raw: string) => {
    if (!raw.trim()) {
      if (value != null) onCommit(null)
      return
    }
    const n = parseQty(raw)
    if (n == null) {
      setText(value == null ? '' : formatQty(value))
      return
    }
    if (n !== value) onCommit(n)
  }
  return (
    <span
      className={cn(
        'flex h-12 items-center rounded-xl border border-input bg-background pr-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/40',
        className,
      )}
    >
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
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="h-full w-full min-w-0 rounded-xl bg-transparent pl-3 text-right text-lg font-semibold tabular-nums outline-none placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground"
      />
      <span className="pl-1.5 text-base text-muted-foreground">{unitShort(unit)}</span>
    </span>
  )
}

function ChangeLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 px-1 text-sm font-medium text-muted-foreground underline underline-offset-4"
    >
      cambiar
    </button>
  )
}

/**
 * Un producto del conteo. Lo de todos los días: Alcanza / Poco / No hay (un toque). Lo que pide un evento:
 * el número exacto o No hay.
 */
export const CountRow = memo(function CountRow({
  item,
  line,
  need,
  lowFraction,
  onMark,
}: {
  item: PurItem
  line: LocalLine | undefined
  need: EventNeed | undefined
  lowFraction: number
  onMark: (itemId: string, next: LocalLine | null) => void
}) {
  const unit = unitShort(item.unit)
  const target = item.targetQty
  const forEvent = Boolean(need)
  const set = (next: LocalLine | null) => onMark(item.id, next)

  return (
    <div className={cn('py-4', !line && 'pending')} data-item={item.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[1.05rem] font-semibold leading-snug">
            {item.name}
            {item.brand ? (
              <span className="font-normal text-muted-foreground"> · {item.brand}</span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {unit}
            {target != null ? ` · objetivo ${formatQty(target)}` : ''}
          </p>
        </div>
      </div>
      {need ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {need.events.map((label) => (
            <span
              key={label}
              className="rounded-lg bg-pur-event-soft px-2 py-0.5 text-[0.8rem] font-semibold text-pur-event"
            >
              Para {label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5">
        {forEvent ? (
          line?.state === 'none' ? (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex h-12 items-center gap-1.5 rounded-xl border px-4 font-semibold',
                  tone.none,
                )}
              >
                <X className="size-4" aria-hidden /> No hay
              </span>
              <ChangeLink onClick={() => set(null)} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <QtyField
                className="w-36"
                value={line?.quantity ?? null}
                unit={item.unit}
                label={`Cuánto hay de ${item.name}`}
                placeholder="¿cuánto?"
                onCommit={(n) =>
                  set(
                    n == null
                      ? null
                      : n === 0
                        ? { state: 'none', quantity: null }
                        : { state: 'exact', quantity: n },
                  )
                }
              />
              <StateButton kind="none" onClick={() => set({ state: 'none', quantity: null })}>
                <X className="size-4" aria-hidden /> No hay
              </StateButton>
            </div>
          )
        ) : !line ? (
          <div className="grid grid-cols-3 gap-2">
            <StateButton kind="enough" onClick={() => set({ state: 'enough', quantity: null })}>
              <Check className="size-4" aria-hidden /> Alcanza
            </StateButton>
            <StateButton kind="low" onClick={() => set({ state: 'low', quantity: null })}>
              <span aria-hidden>≈</span> Poco
            </StateButton>
            <StateButton kind="none" onClick={() => set({ state: 'none', quantity: null })}>
              <X className="size-4" aria-hidden /> No hay
            </StateButton>
          </div>
        ) : line.state === 'low' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex h-12 items-center gap-1.5 rounded-xl border px-4 font-semibold',
                tone.low,
              )}
            >
              <span aria-hidden>≈</span> Poco
            </span>
            <QtyField
              className="w-32"
              value={line.quantity}
              unit={item.unit}
              label={`Cuánto queda de ${item.name} (opcional)`}
              placeholder={
                target != null ? `≈ ${formatQty(roundQty(target * lowFraction))}` : '¿cuánto?'
              }
              onCommit={(n) =>
                set(n === 0 ? { state: 'none', quantity: null } : { state: 'low', quantity: n })
              }
            />
            <ChangeLink onClick={() => set(null)} />
          </div>
        ) : line.state === 'exact' ? (
          <div className="flex items-center gap-2">
            <QtyField
              className="w-36"
              value={line.quantity}
              unit={item.unit}
              label={`Cuánto hay de ${item.name}`}
              placeholder="¿cuánto?"
              onCommit={(n) =>
                set(
                  n == null
                    ? null
                    : n === 0
                      ? { state: 'none', quantity: null }
                      : { state: 'exact', quantity: n },
                )
              }
            />
            <ChangeLink onClick={() => set(null)} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex h-12 items-center gap-1.5 rounded-xl border px-4 font-semibold',
                line.state === 'enough' ? tone.enough : tone.none,
              )}
            >
              {line.state === 'enough' ? (
                <>
                  <Check className="size-4" aria-hidden /> Alcanza
                </>
              ) : (
                <>
                  <X className="size-4" aria-hidden /> No hay
                </>
              )}
            </span>
            <ChangeLink onClick={() => set(null)} />
          </div>
        )}
      </div>
    </div>
  )
})
