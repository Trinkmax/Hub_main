import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export type BreadcrumbItem = {
  label: string
  /** Sin `href` se dibuja como texto (la página actual o un nivel sin pantalla propia). */
  href?: string
}

export type BreadcrumbProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  items: ReadonlyArray<BreadcrumbItem>
}

/**
 * Link de nivel: foco «afuera» del kit, subrayado al pasar y área táctil de
 * 24 px (44 con el dedo) sin agrandar el dibujo.
 */
export const crumbLinkClass =
  'relative hit-area rounded-sm underline-offset-4 transition-colors duration-(--duration-quick) hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none'

/**
 * Migas de pan del kit (§3.5), para cuando hay dos niveles o más: «Proveedores
 * › Coca-Cola › Pagos». Server-safe.
 *
 * - `<nav aria-label="Migas de pan">` con una lista ordenada.
 * - El separador es `ChevronRight` de 12 px con `aria-hidden` (no un carácter:
 *   un «›» o «/» se lee en voz alta).
 * - El último nivel lleva `aria-current="page"`.
 *
 * Reemplaza al `breadcrumb.tsx` de shadcn (sin usos): la versión vieja quedó
 * congelada en `components/ui-legacy`.
 */
export function Breadcrumb({
  items,
  className,
  'aria-label': ariaLabel = 'Migas de pan',
  ...props
}: BreadcrumbProps) {
  if (items.length === 0) return null
  return (
    <nav
      data-slot="breadcrumb"
      aria-label={ariaLabel}
      className={cn('min-w-0', className)}
      {...props}
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 type-small text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: la miga es posicional y el mismo rótulo puede repetirse en dos niveles
              key={`${index}-${item.label}`}
              data-slot="breadcrumb-item"
              className="inline-flex min-w-0 items-center gap-1"
            >
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={last ? 'page' : undefined}
                  className={cn(crumbLinkClass, last && 'text-foreground')}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(last && 'text-foreground')}
                >
                  {item.label}
                </span>
              )}
              {last ? null : <ChevronRight aria-hidden="true" className="size-3 shrink-0" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
