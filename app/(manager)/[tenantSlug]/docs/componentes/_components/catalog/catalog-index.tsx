'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { CATALOG_FAMILIES } from './registry'

/**
 * La familia que se está leyendo: la primera, en el orden de la página, que
 * ocupa la franja de lectura (de debajo del topbar a la mitad de la
 * pantalla). Sin animación: es lo que cambia al hacer scroll.
 */
function useActiveFamily(): string | null {
  const [active, setActive] = React.useState<string | null>(null)

  React.useEffect(() => {
    const sections = CATALOG_FAMILIES.map((family) => document.getElementById(family.id)).filter(
      (element): element is HTMLElement => element !== null,
    )
    if (sections.length === 0) return
    const visible = new Set<string>()
    const pick = () => {
      // La primera familia en el orden de la página que está a la vista.
      const first = CATALOG_FAMILIES.find((family) => visible.has(family.id))
      if (first) setActive(first.id)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        pick()
      },
      // La franja de lectura: debajo del topbar y hasta la mitad de la pantalla.
      { rootMargin: '-64px 0px -50% 0px' },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [])

  return active
}

/** Ítem de la columna: el mismo vocabulario que el menú lateral (fondo `--selected` + barra de 2 px). */
const ITEM_CLASSES = [
  'relative flex min-h-8 items-center rounded-md px-2.5 type-body font-medium text-muted-foreground pointer-coarse:min-h-11',
  'hover:bg-hover hover:text-foreground',
  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
  'aria-[current=location]:bg-selected aria-[current=location]:text-foreground',
].join(' ')

const CHILD_CLASSES = [
  'flex min-h-7 items-center rounded-md px-2.5 py-1 type-small text-pretty text-muted-foreground pointer-coarse:min-h-11',
  'hover:bg-hover hover:text-foreground',
  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
].join(' ')

/**
 * El índice (§6.2): a la izquierda y fijo debajo del topbar desde `lg`, con
 * un ancla por familia y por bloque. En el celular, las familias en una fila
 * arriba del contenido. Son anclas de la misma página: `aria-current="location"`
 * marca la familia que se está leyendo.
 */
export function CatalogIndex() {
  const active = useActiveFamily()
  return (
    <>
      <nav aria-label="Familias del catálogo" className="lg:hidden">
        <ul className="flex flex-wrap gap-2">
          {CATALOG_FAMILIES.map((family) => (
            <li key={family.id}>
              <a
                href={`#${family.id}`}
                aria-current={active === family.id ? 'location' : undefined}
                className={cn(
                  'press relative hit-area inline-flex h-(--control-sm) items-center rounded-full border border-border-strong px-3 type-label text-muted-foreground',
                  'hover:bg-hover hover:text-foreground',
                  'outline-offset-2 outline-(--ring) focus-visible:outline-2',
                  'aria-[current=location]:border-primary aria-[current=location]:bg-card aria-[current=location]:text-foreground',
                )}
              >
                {family.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <nav
        aria-label="Índice del catálogo"
        className="sticky top-[calc(var(--topbar-h)+1.5rem)] hidden max-h-[calc(100dvh-var(--topbar-h)-3rem)] w-56 shrink-0 overflow-y-auto overscroll-contain pe-1 lg:block"
      >
        <ol className="flex flex-col gap-1">
          {CATALOG_FAMILIES.map((family) => {
            const isActive = active === family.id
            return (
              <li key={family.id} className="flex flex-col gap-0.5">
                <a
                  href={`#${family.id}`}
                  aria-current={isActive ? 'location' : undefined}
                  className={ITEM_CLASSES}
                >
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary forced-colors:bg-[Highlight]"
                    />
                  ) : null}
                  {family.label}
                </a>
                <ol className="ms-3 flex flex-col gap-px border-s border-border ps-1.5">
                  {family.blocks.map((block) => (
                    <li key={block.id}>
                      <a href={`#${block.id}`} className={CHILD_CLASSES}>
                        {block.name}
                      </a>
                    </li>
                  ))}
                </ol>
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}
