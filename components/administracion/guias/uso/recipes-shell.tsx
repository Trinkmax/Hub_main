'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { GuideNavProvider, useGuideNav } from '@/components/administracion/guias/guide-nav'
import type { RecipeId } from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'
import { RECIPE_ICON } from './guide-icons'

/**
 * El cuerpo de «El día a día»: comparte con todas las recetas cuál está abierta y el salto a
 * `#receta-…` (`GuideNavProvider`, el mismo de la guía de ARCA), y en la compu suma el índice a
 * la izquierda, fijo mientras se baja y con la receta que se está leyendo marcada. En el
 * celular no hace falta: las recetas cerradas ya son la lista.
 */

export type RecipeIndexItem = {
  readonly id: RecipeId
  readonly anchor: string
  readonly title: string
  /** `true`: es una rutina y hoy te toca (con lo que hay cargado). */
  readonly due: boolean
}

/**
 * La receta que se está leyendo: la que cruza la franja de arriba de la pantalla. Sirve con una
 * sola abierta y con varias (antes se marcaba «la abierta», y con dos abiertas no decía nada).
 */
function useReading(items: readonly RecipeIndexItem[]): string | null {
  const [reading, setReading] = useState<string | null>(null)
  const anchors = items.map((item) => item.anchor).join('|')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const byAnchor = new Map(
      anchors
        .split('|')
        .map((anchor) => [anchor, document.getElementById(anchor)] as const)
        .filter((entry): entry is readonly [string, HTMLElement] => entry[1] !== null),
    )
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        // La primera, en el orden de la página, de las que tocan la franja.
        const first = [...byAnchor.keys()].find((anchor) => visible.has(anchor))
        if (first) setReading(first)
      },
      // Una franja angosta debajo del encabezado: lo que está ahí es lo que se lee.
      { rootMargin: '-18% 0px -72% 0px' },
    )
    for (const element of byAnchor.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [anchors])
  return reading
}

function RecipeIndex({ items }: { items: readonly RecipeIndexItem[] }) {
  const nav = useGuideNav()
  const reading = useReading(items)
  return (
    <nav
      aria-label="Las recetas"
      className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
    >
      <p className="px-2 font-serif text-lg font-semibold tracking-tight">¿Qué pasó?</p>
      <ol className="mt-2 space-y-0.5">
        {items.map((item) => {
          const Icon = RECIPE_ICON[item.id]
          const here = reading === item.anchor
          return (
            <li key={item.id}>
              <a
                href={`#${item.anchor}`}
                aria-current={here ? 'true' : undefined}
                onClick={(event) => {
                  if (!nav) return
                  event.preventDefault()
                  nav.reveal(item.id)
                }}
                className={cn(
                  // El riel de la izquierda está siempre (transparente), así el texto no se corre.
                  'relative flex min-h-9 items-start gap-2 rounded-lg py-1.5 pr-2 pl-3 text-sm leading-snug outline-none transition-colors before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  here
                    ? 'bg-cream-tint font-medium text-foreground before:bg-primary'
                    : 'text-foreground/80',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    here ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span className="min-w-0 flex-1 text-pretty">{item.title}</span>
                {item.due ? (
                  <span className="mt-0.5 shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[11px] font-medium text-warning-text">
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
      hashOpensAlone
    >
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <RecipeIndex items={items} />
        <div className="min-w-0 space-y-3">{children}</div>
      </div>
    </GuideNavProvider>
  )
}
