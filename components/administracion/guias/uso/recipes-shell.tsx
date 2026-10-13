'use client'

import type { ReactNode } from 'react'
import { GuideNavProvider, useGuideNav } from '@/components/administracion/guias/guide-nav'
import type { RecipeId } from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'
import { RECIPE_ICON } from './guide-icons'

/**
 * El cuerpo de «El día a día»: comparte con todas las recetas cuál está abierta y el salto a
 * `#receta-…` (`GuideNavProvider`, el mismo de la guía de ARCA), y en la compu suma el índice a
 * la izquierda, fijo mientras se baja. En el celular no hace falta: las recetas cerradas ya son
 * la lista.
 */

export type RecipeIndexItem = {
  readonly id: RecipeId
  readonly anchor: string
  readonly title: string
  /** `true`: es una rutina y hoy te toca (con lo que hay cargado). */
  readonly due: boolean
}

function RecipeIndex({ items }: { items: readonly RecipeIndexItem[] }) {
  const nav = useGuideNav()
  return (
    <nav
      aria-label="Las recetas"
      className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
    >
      <p className="px-2 font-serif text-lg font-semibold tracking-tight">¿Qué pasó?</p>
      <ol className="mt-2 space-y-0.5">
        {items.map((item) => {
          const Icon = RECIPE_ICON[item.id]
          return (
            <li key={item.id}>
              <a
                href={`#${item.anchor}`}
                onClick={(event) => {
                  if (!nav) return
                  event.preventDefault()
                  nav.reveal(item.id)
                }}
                className={cn(
                  'flex min-h-9 items-start gap-2 rounded-lg px-2 py-1.5 text-sm leading-snug outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring',
                  nav?.isOpen(item.id) ? 'font-medium text-foreground' : 'text-foreground/80',
                )}
              >
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-pretty">{item.title}</span>
                {item.due ? (
                  <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary">
                    Te toca
                  </span>
                ) : null}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function RecipesShell({
  items,
  initialOpen,
  children,
}: {
  items: readonly RecipeIndexItem[]
  /** Las recetas abiertas al entrar (si la URL no trae un `#receta-…`). */
  initialOpen: readonly string[]
  children: ReactNode
}) {
  return (
    <GuideNavProvider
      items={items.map((item) => ({ id: item.id, anchor: item.anchor }))}
      initialOpen={initialOpen}
    >
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <RecipeIndex items={items} />
        <div className="min-w-0 space-y-3">{children}</div>
      </div>
    </GuideNavProvider>
  )
}
