import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { type RouteNavItem, TabsNavRow } from '@/components/ui/route-nav'

/*
 * Subnavegación por rutas con el aspecto de las pestañas (kit HUB §3.3). Son
 * links, no tabs: un `<nav>` con `aria-current="page"` en el activo, un link
 * por parada de Tab y sin flechas.
 *
 * Server-safe (sin hooks): se monta directo en un layout. El pathname lo lee
 * la fila de `route-nav.tsx`, que es cliente; acá solo se dibujan los íconos,
 * porque un componente de ícono (una función) no cruza de un Server Component
 * a uno cliente y un elemento sí.
 */

export type TabsNavItem = {
  href: string
  label: string
  /** Solo ese path exacto. Sin esto también sus subrutas, y gana el path más largo. */
  exact?: boolean
  count?: number
  icon?: LucideIcon
}

export type TabsNavProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  items: ReadonlyArray<TabsNavItem>
  /** «Secciones de la automatización»: nombra el landmark. */
  'aria-label': string
}

/** El ícono, dibujado del lado del server: 16 px y trazo fino, como el menú lateral. */
export function toRouteNavItems(
  items: ReadonlyArray<TabsNavItem & { group?: string }>,
): RouteNavItem[] {
  return items.map(({ icon: Icon, ...item }) => ({
    ...item,
    icon: Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} /> : undefined,
  }))
}

/**
 * La fila subrayada de subpáginas: pelo abajo, scroll horizontal cuando no
 * entra (con máscara en el borde que tiene más) y el activo llevado a la
 * vista al montar. `className` y `data-tour` van al `<nav>`, que es la fila
 * misma: un `-mx-4 px-4` la lleva de borde a borde en el celular.
 */
export function TabsNav({ items, ...props }: TabsNavProps) {
  return <TabsNavRow {...props} items={toRouteNavItems(items)} />
}
