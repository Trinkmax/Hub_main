'use client'

import { Armchair, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { normalizeText, splitTableLabel, toggleTableInLabel } from '@/lib/salon/operativo'
import { TABLE_LABEL_MAX } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/** Mesas que el bar usa seguido: se ofrecen como atajo aunque hoy nadie las tenga. */
const QUICK_TABLES = ['Barra']

/**
 * El campo de mesa: un input grande y libre ("12", "12+13", "Barra") con
 * atajos de las mesas que ya se usaron esta noche. Tocar un atajo suma o saca
 * esa mesa de la etiqueta (las mesas se juntan para los grupos grandes).
 *
 * Si otra reserva ya está sentada en esa mesa, avisa — pero NO bloquea: a
 * veces se comparte, a veces se juntaron y no se anotó.
 */
export function TableEditor({
  value,
  onChange,
  occupied,
  currentId,
  usedToday,
  autoFocus = false,
  onSubmit,
  compact = false,
}: {
  value: string
  onChange: (next: string) => void
  /** mesa normalizada → apellido de quien la tiene ahora. */
  occupied: Map<string, string>
  currentId: string
  /** Etiquetas de mesa cargadas hoy (para los atajos). */
  usedToday: string[]
  autoFocus?: boolean
  onSubmit?: () => void
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [autoFocus])

  const parts = splitTableLabel(value)
  const conflicts = parts
    .map((p) => (occupied.has(p) ? { table: p, by: occupied.get(p) ?? '' } : null))
    .filter((c): c is { table: string; by: string } => c !== null)

  const chips = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const label of [...usedToday, ...QUICK_TABLES]) {
      for (const part of label.split('+').map((p) => p.trim())) {
        const key = normalizeText(part)
        if (!part || seen.has(key)) continue
        seen.add(key)
        out.push(part)
      }
    }
    return out
      .sort((a, b) => {
        const na = Number(a)
        const nb = Number(b)
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        if (Number.isFinite(na)) return -1
        if (Number.isFinite(nb)) return 1
        return a.localeCompare(b, 'es-AR')
      })
      .slice(0, 14)
  }, [usedToday])

  return (
    <div>
      <div className="relative">
        <Armchair
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={`table-${currentId}`}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={TABLE_LABEL_MAX}
          value={value}
          placeholder="Mesa"
          aria-label="Mesa asignada"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit?.()
            }
          }}
          className={cn(
            'w-full rounded-2xl border border-border/70 bg-card pl-12 pr-11 text-center font-serif font-semibold tracking-tight shadow-xs outline-none transition-[box-shadow,border-color] duration-(--duration-fast) placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground/60 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40',
            compact ? 'h-12 text-xl' : 'h-14 text-2xl',
          )}
        />
        {value ? (
          <button
            type="button"
            aria-label="Quitar mesa"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {conflicts.length > 0 ? (
        <p className="mt-1.5 text-xs text-warning-text" role="status">
          {conflicts.length === 1
            ? `La ${conflicts[0]?.table} la tiene ${conflicts[0]?.by}.`
            : `Ocupadas: ${conflicts.map((c) => `${c.table} (${c.by})`).join(', ')}.`}{' '}
          Se guarda igual.
        </p>
      ) : null}

      {chips.length > 0 ? (
        <ul aria-label="Mesas de esta noche" className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => {
            const key = normalizeText(chip)
            const active = parts.includes(key)
            const busy = occupied.has(key)
            return (
              <li key={chip}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange(toggleTableInLabel(value || null, chip))}
                  className={cn(
                    'inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-3 font-mono text-sm tabular-nums transition-[background-color,color,border-color] duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : busy
                        ? 'border-border/60 bg-secondary/60 text-muted-foreground'
                        : 'border-border/70 bg-card hover:bg-(--cream-tint)',
                  )}
                  title={busy ? `La tiene ${occupied.get(key)}` : undefined}
                >
                  {chip}
                  {busy && !active ? (
                    <span className="max-w-[5rem] truncate font-sans text-[10px]">
                      {occupied.get(key)?.split(' ')[0]}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
