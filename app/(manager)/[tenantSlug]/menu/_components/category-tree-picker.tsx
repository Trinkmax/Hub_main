'use client'

import { Check } from 'lucide-react'
import type { MenuCategory } from '@/lib/menu/queries'
import { flattenForPicker } from '@/lib/menu/tree'
import { cn } from '@/lib/utils'

export function CategoryTreePicker({
  categories,
  value,
  onChange,
  excludeSubtreeOf,
  allowRoot = false,
  rootLabel = 'Raíz (sin categoría padre)',
}: {
  categories: MenuCategory[]
  value: string | null
  onChange: (id: string | null) => void
  /** Excluye esta categoría y su subárbol (para mover sin ciclos). */
  excludeSubtreeOf?: string
  allowRoot?: boolean
  rootLabel?: string
}) {
  const entries = flattenForPicker(categories, excludeSubtreeOf)

  return (
    <ul className="card-hairline max-h-64 overflow-y-auto rounded-lg border bg-card p-1.5">
      {allowRoot ? (
        <li>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
              value === null ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/40',
            )}
          >
            <span className="flex-1 truncate font-medium">{rootLabel}</span>
            {value === null ? <Check className="size-4 text-primary" aria-hidden /> : null}
          </button>
        </li>
      ) : null}
      {entries.map((e) => {
        const checked = value === e.id
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onChange(e.id)}
              aria-pressed={checked}
              style={{ paddingLeft: `${0.625 + e.depth * 1}rem` }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md py-2 pr-2.5 text-left text-sm transition-colors',
                checked ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/40',
              )}
            >
              <span className="flex-1 truncate">{e.name}</span>
              {checked ? <Check className="size-4 text-primary" aria-hidden /> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
