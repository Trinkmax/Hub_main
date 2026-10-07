'use client'

import { Check } from 'lucide-react'
import { useId } from 'react'
import type { MenuCategory } from '@/lib/menu/queries'
import { flattenForPicker } from '@/lib/menu/tree'
import { cn } from '@/lib/utils'

/**
 * Elegir una categoría del árbol (con sangría por nivel). Son radios de verdad:
 * Tab entra a la elegida y las flechas recorren la lista. La elegida lleva el
 * check a la derecha y el fondo de selección.
 */
export function CategoryTreePicker({
  categories,
  value,
  onChange,
  excludeSubtreeOf,
  excludeIds,
  allowRoot = false,
  rootLabel = 'Raíz (sin categoría madre)',
  'aria-label': ariaLabel = 'Categoría',
}: {
  categories: MenuCategory[]
  value: string | null
  onChange: (id: string | null) => void
  /** Excluye esta categoría y su subárbol (para mover sin ciclos). */
  excludeSubtreeOf?: string
  /** Excluye categorías puntuales (p. ej. el origen de un move de ítems). */
  excludeIds?: string[]
  allowRoot?: boolean
  rootLabel?: string
  'aria-label'?: string
}) {
  const groupName = useId()
  const excluded = excludeIds ? new Set(excludeIds) : null
  const entries = flattenForPicker(categories, excludeSubtreeOf).filter((e) => !excluded?.has(e.id))

  const option = (key: string, id: string | null, label: string, depth: number, strong = false) => {
    const checked = value === id
    return (
      <label
        key={key}
        style={{ paddingInlineStart: `${0.625 + depth}rem` }}
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-2 rounded-md py-2 pe-2.5 type-body',
          '-outline-offset-2 outline-(--ring) has-[:focus-visible]:outline-2',
          checked ? 'bg-selected text-foreground' : 'hover:bg-hover',
        )}
      >
        <input
          type="radio"
          name={groupName}
          checked={checked}
          onChange={() => onChange(id)}
          className="sr-only"
        />
        <span className={cn('flex-1 truncate', strong && 'font-medium')}>{label}</span>
        {checked ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
      </label>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid max-h-64 gap-0.5 overflow-y-auto rounded-lg border border-border bg-card p-1"
    >
      {allowRoot ? option('__root__', null, rootLabel, 0, true) : null}
      {entries.map((e) => option(e.id, e.id, e.name, e.depth))}
      {entries.length === 0 && !allowRoot ? (
        <p className="px-2.5 py-3 type-small text-muted-foreground">
          No hay otra categoría a la que mover.
        </p>
      ) : null}
    </div>
  )
}
