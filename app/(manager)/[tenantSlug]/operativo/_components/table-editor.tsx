'use client'

import { Armchair, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useField } from '@/components/ui/field'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { normalizeText, splitTableLabel, toggleTableInLabel } from '@/lib/salon/operativo'
import { TABLE_LABEL_MAX } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/** Mesas que el bar usa seguido: se ofrecen como atajo aunque hoy nadie las tenga. */
const QUICK_TABLES = ['Barra']

/**
 * El campo de mesa: un input libre ("12", "12+13", "Barra") con atajos de las
 * mesas que ya se usaron esta noche. Tocar un atajo suma o saca esa mesa de la
 * etiqueta (las mesas se juntan para los grupos grandes).
 *
 * Si otra reserva ya está sentada en esa mesa, avisa — pero NO bloquea: a
 * veces se comparte, a veces se juntaron y no se anotó.
 *
 * Adentro de un `Field` del kit toma de ahí la etiqueta, la ayuda y el id;
 * suelto se nombra solo («Mesa asignada»).
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
  const field = useField()
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
    <div className="flex flex-col gap-2">
      <InputGroup size={compact ? 'md' : 'lg'}>
        <InputAddon>
          <Armchair aria-hidden="true" />
        </InputAddon>
        <Input
          ref={inputRef}
          id={field ? undefined : `table-${currentId}`}
          aria-label={field ? undefined : 'Mesa asignada'}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={TABLE_LABEL_MAX}
          value={value}
          placeholder="12, 12+13 o Barra"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit?.()
            }
          }}
          className="font-semibold"
        />
        {value ? (
          <InputAddon side="end">
            <button
              type="button"
              aria-label="Quitar mesa"
              onClick={() => {
                onChange('')
                inputRef.current?.focus()
              }}
              className="relative hit-area -me-1 flex size-6 items-center justify-center rounded-sm text-subtle-foreground outline-(--ring) outline-offset-2 hover:bg-hover hover:text-foreground focus-visible:outline-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </InputAddon>
        ) : null}
      </InputGroup>

      {conflicts.length > 0 ? (
        <p className="type-caption text-warning-text" role="status">
          {conflicts.length === 1
            ? `La ${conflicts[0]?.table} la tiene ${conflicts[0]?.by}.`
            : `Ocupadas: ${conflicts.map((c) => `${c.table} (${c.by})`).join(', ')}.`}{' '}
          Se guarda igual.
        </p>
      ) : null}

      {chips.length > 0 ? (
        <ChipGroup aria-label="Mesas de esta noche">
          {chips.map((chip) => {
            const key = normalizeText(chip)
            const active = parts.includes(key)
            const busy = occupied.has(key)
            return (
              <FilterChip
                key={chip}
                size="md"
                pressed={active}
                onPressedChange={() => onChange(toggleTableInLabel(value || null, chip))}
                title={busy ? `La tiene ${occupied.get(key)}` : undefined}
                // Ocupada por otra reserva: relleno visible, sigue tocable (no bloquea).
                className={cn('min-w-11 type-amount', busy && !active && 'bg-secondary')}
              >
                {chip}
                {busy && !active ? (
                  <span className="max-w-[5rem] truncate type-caption">
                    {occupied.get(key)?.split(' ')[0]}
                  </span>
                ) : null}
              </FilterChip>
            )
          })}
        </ChipGroup>
      ) : null}
    </div>
  )
}
