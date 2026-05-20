'use client'

import { Check } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const ORDER: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

export function MealTypeFilter({
  selected,
  counts,
  onChange,
}: {
  selected: ReadonlySet<MealType>
  counts: Record<MealType, number>
  onChange: (next: ReadonlySet<MealType>) => void
}) {
  const allSelected = selected.size === 0 || selected.size === ORDER.length
  const totalCount = useMemo(() => ORDER.reduce((acc, k) => acc + (counts[k] ?? 0), 0), [counts])

  const toggle = useCallback(
    (m: MealType) => {
      const next = new Set(allSelected ? [] : selected)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      if (next.size === ORDER.length || next.size === 0) onChange(new Set())
      else onChange(next)
    },
    [allSelected, selected, onChange],
  )

  const clear = useCallback(() => onChange(new Set()), [onChange])

  return (
    <div
      role="toolbar"
      aria-label="Filtrar reservas por tipo de servicio"
      className="flex flex-wrap items-center gap-1.5"
    >
      <Chip
        active={allSelected}
        onClick={clear}
        count={totalCount}
        label="Todos"
        accent="var(--primary)"
      />
      {ORDER.map((m) => {
        const isOn = allSelected || selected.has(m)
        return (
          <Chip
            key={m}
            active={isOn}
            dimmed={!allSelected && !selected.has(m)}
            onClick={() => toggle(m)}
            count={counts[m] ?? 0}
            label={MEAL_TYPE_LABELS[m]}
            accent={MEAL_ACCENTS[m]}
          />
        )
      })}
    </div>
  )
}

const MEAL_ACCENTS: Record<MealType, string> = {
  breakfast: '#f59e0b', // amber
  lunch: '#16a34a', // green
  tea_time: '#ec4899', // pink
  dinner: '#0ea5e9', // sky
  hub_event: '#7c3aed', // violet
}

function Chip({
  active,
  dimmed,
  onClick,
  count,
  label,
  accent,
}: {
  active: boolean
  dimmed?: boolean
  onClick: () => void
  count: number
  label: string
  accent: string
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-transparent bg-secondary text-foreground'
          : 'border-border/60 bg-transparent text-muted-foreground hover:bg-secondary/50',
        dimmed && 'opacity-60',
      )}
      style={active ? { boxShadow: `inset 0 0 0 1px ${accent}55` } : undefined}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-3.5 items-center justify-center rounded-full transition-opacity',
          active ? 'opacity-100' : 'opacity-40',
        )}
        style={{ backgroundColor: `${accent}22`, color: accent }}
      >
        {active ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
      <span>{label}</span>
      {count > 0 ? (
        <span
          className={cn(
            'inline-flex min-w-[1.25rem] justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
            active ? 'bg-background/60 text-foreground' : 'bg-secondary/60 text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}
