import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { SectionNavLinks } from '@/components/ui/route-nav'
import { toRouteNavItems } from '@/components/ui/tabs-nav'

/*
 * Subbarra para ajustes con muchas subpáginas (kit HUB §3.3), como
 * Configuración. Server-safe: va directo en el layout, con los íconos como
 * componentes (se dibujan acá; el pathname lo lee la parte cliente).
 *
 * Arregla Configuración en el celular: la `settings-nav` de hoy es
 * `hidden … lg:block`, y Comisiones y Reseñas solo se alcanzan por link
 * profundo. Debajo de `lg` esto es la fila de `TabsNav` con scroll.
 */

export type SectionNavItem = {
  href: string
  label: string
  icon?: LucideIcon
  /** Título del grupo en la columna («Equipo», «Salón»). Los ítems se agrupan en el orden en que aparece cada grupo. */
  group?: string
  /** Solo ese path exacto (útil para la portada de la sección). Sin esto gana el path más largo. */
  exact?: boolean
}

export type SectionNavProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  items: ReadonlyArray<SectionNavItem>
  /** «Secciones de Configuración»: nombra el landmark. */
  'aria-label': string
}

/**
 * - Desde `lg`: lista vertical en una columna de 224 px (`lg:w-56`), con el
 *   mismo ítem del menú lateral (fondo `--selected` + barra) y los títulos de
 *   grupo en `type-group`.
 * - Debajo de `lg`: la fila subrayada de `TabsNav`, con scroll horizontal.
 *
 * El layout pone la columna al lado del contenido (`lg:flex lg:gap-8`) y, si
 * quiere, `lg:sticky` por `className`; en el celular le da aire abajo.
 */
export function SectionNav({ items, ...props }: SectionNavProps) {
  return <SectionNavLinks {...props} items={toRouteNavItems(items)} />
}
