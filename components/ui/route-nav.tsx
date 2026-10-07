'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { matchesPath } from '@/components/shell/nav-active'
import {
  tabsCountClasses,
  tabsListClasses,
  tabsTriggerClasses,
  useScrollRow,
} from '@/components/ui/tabs'
import { formatNumber } from '@/lib/format/number-kind'
import { cn } from '@/lib/utils'

/*
 * La mitad cliente de `TabsNav` y `SectionNav`: links que se marcan solos con
 * `aria-current="page"` según el pathname. Los componentes públicos están en
 * `tabs-nav.tsx` y `section-nav.tsx`, que son server-safe: reciben el ícono
 * como componente (lo que dice la spec) y lo mandan acá ya dibujado, porque
 * una función no cruza de un Server Component (los layouts) a uno cliente.
 */

/** Un link de la navegación por rutas, con el ícono ya dibujado. */
export type RouteNavItem = {
  href: string
  label: string
  /** Solo ese path exacto (sin esto, también sus subrutas). */
  exact?: boolean
  count?: number
  icon?: React.ReactNode
  /** Título del grupo en la columna de `SectionNav`. */
  group?: string
}

/**
 * El href activo: el de path más largo que matchea (`matchesPath` de
 * nav-active.ts, la misma idea de «estoy acá» que el menú lateral). Así
 * `/flows/1` y `/flows/1/registros` no se prenden juntos aunque el primero no
 * sea `exact`. Compara solo el path: las subpáginas por query son `Tabs` con
 * `syncParam`. Con dos hrefs del mismo path gana el primero.
 */
export function activeNavHref(
  pathname: string,
  items: ReadonlyArray<Pick<RouteNavItem, 'href' | 'exact'>>,
): string | null {
  let best: string | null = null
  let bestLength = -1
  for (const item of items) {
    if (!matchesPath(pathname, item.href, item.exact)) continue
    const length = (item.href.split('?')[0] ?? item.href).length
    if (length > bestLength) {
      best = item.href
      bestLength = length
    }
  }
  return best
}

/** Los ítems por grupo, en el orden en que aparece cada grupo por primera vez. */
export function groupNavItems<T extends Pick<RouteNavItem, 'group'>>(
  items: ReadonlyArray<T>,
): Array<{ label: string | undefined; items: T[] }> {
  const groups: Array<{ label: string | undefined; items: T[] }> = []
  for (const item of items) {
    const group = groups.find((g) => g.label === item.group)
    if (group) group.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }
  return groups
}

function useActiveHref(items: ReadonlyArray<RouteNavItem>): string | null {
  const pathname = usePathname() ?? ''
  return activeNavHref(pathname, items)
}

/** Ícono + etiqueta + contador, igual en la fila y en la columna. */
function LinkContent({ item }: { item: RouteNavItem }) {
  return (
    <>
      {item.icon}
      <span className="min-w-0 truncate">{item.label}</span>
      {item.count !== undefined ? (
        <span data-slot="nav-count" className={tabsCountClasses}>
          {formatNumber(item.count)}
        </span>
      ) : null}
    </>
  )
}

function UnderlineLinks({
  items,
  active,
}: {
  items: ReadonlyArray<RouteNavItem>
  active: string | null
}) {
  return items.map((item) => {
    const isActive = item.href === active
    return (
      <Link
        key={item.href}
        href={item.href}
        data-slot="tabs-nav-link"
        data-state={isActive ? 'active' : 'inactive'}
        aria-current={isActive ? 'page' : undefined}
        className={tabsTriggerClasses}
      >
        <LinkContent item={item} />
      </Link>
    )
  })
}

export type TabsNavRowProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  items: ReadonlyArray<RouteNavItem>
}

/** La fila de `TabsNav`: un `<nav>` que es él mismo la fila con scroll. */
export function TabsNavRow({ items, className, ref, ...props }: TabsNavRowProps) {
  const active = useActiveHref(items)
  const row = useScrollRow<HTMLElement>(active, '[aria-current="page"]', ref)
  return (
    <nav
      ref={row.ref}
      data-slot="tabs-nav"
      data-overflow={row.overflow}
      className={cn(tabsListClasses, className)}
      {...props}
    >
      <UnderlineLinks items={items} active={active} />
    </nav>
  )
}

/** La misma fila sin `<nav>` propio: va adentro del `<nav>` de `SectionNav`. */
function UnderlineRow({
  items,
  active,
  className,
}: {
  items: ReadonlyArray<RouteNavItem>
  active: string | null
  className?: string
}) {
  const row = useScrollRow<HTMLDivElement>(active, '[aria-current="page"]')
  return (
    <div
      ref={row.ref}
      data-slot="section-nav-row"
      data-overflow={row.overflow}
      className={cn(tabsListClasses, className)}
    >
      <UnderlineLinks items={items} active={active} />
    </div>
  )
}

/**
 * Ítem de la columna: el mismo del menú lateral (§4.2). Activo con fondo
 * `--selected`, ícono en `text-primary` y la barra de 2 px a la izquierda
 * (`forced-colors:bg-[Highlight]`: en alto contraste los fondos se van).
 */
const sectionItemClasses = [
  'relative flex min-h-8 items-center gap-2.5 rounded-md px-2.5 type-body font-medium text-muted-foreground pointer-coarse:min-h-11',
  'hover:bg-hover hover:text-foreground',
  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
  'aria-[current=page]:bg-selected aria-[current=page]:text-foreground',
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-primary",
].join(' ')

export type SectionNavLinksProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  items: ReadonlyArray<RouteNavItem>
}

/**
 * `SectionNav`: desde `lg`, columna de 224 px con grupos; debajo, la fila de
 * `TabsNav` con scroll. Las dos están en el DOM y una se esconde con
 * `display: none` (sale del orden de Tab y del lector), adentro de un único
 * `<nav>`: un solo landmark.
 */
export function SectionNavLinks({ items, className, ...props }: SectionNavLinksProps) {
  const active = useActiveHref(items)
  const groups = groupNavItems(items)
  const baseId = React.useId()

  return (
    <nav
      data-slot="section-nav"
      className={cn('min-w-0 lg:w-56 lg:shrink-0', className)}
      {...props}
    >
      <UnderlineRow items={items} active={active} className="lg:hidden" />
      <div data-slot="section-nav-column" className="hidden lg:flex lg:flex-col lg:gap-5">
        {groups.map((group, index) => {
          const labelId = group.label ? `${baseId}-group-${index}` : undefined
          return (
            <div
              key={group.label ?? `sin-grupo-${index}`}
              data-slot="section-nav-group"
              className="flex flex-col gap-0.5"
            >
              {group.label ? (
                <p
                  id={labelId}
                  className="flex min-h-7 items-center px-2.5 type-group text-subtle-foreground"
                >
                  {group.label}
                </p>
              ) : null}
              <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = item.href === active
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-slot="section-nav-link"
                        aria-current={isActive ? 'page' : undefined}
                        className={sectionItemClasses}
                      >
                        {isActive ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary forced-colors:bg-[Highlight]"
                          />
                        ) : null}
                        <LinkContent item={item} />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
