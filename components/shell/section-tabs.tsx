'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export type SectionTabItem = {
  /** Lo que identifica la pestaña (`proveedores`, `compras`…). */
  value: string
  label: string
  /** Etiqueta corta para el celular. */
  shortLabel?: string
  /** URL completa de la pestaña (`/hub/administracion/compras?tab=pagos`). */
  href: string
  /** Contador al lado (como «Reseñas» en la ficha del cliente). `null`/0 no se muestra. */
  count?: number | null
}

/**
 * Cuánto correr la barra para que la pestaña activa quede centrada, sin pasarse de los bordes.
 * Pura (la usa el efecto de abajo y los tests). Las cajas son las de `getBoundingClientRect`.
 */
export function scrollLeftToCenter({
  scrollLeft,
  overflow,
  navLeft,
  navWidth,
  tabLeft,
  tabWidth,
}: {
  /** `scrollLeft` actual de la barra. */
  scrollLeft: number
  /** `scrollWidth - clientWidth`: lo máximo que se puede correr. */
  overflow: number
  navLeft: number
  navWidth: number
  tabLeft: number
  tabWidth: number
}): number {
  if (overflow <= 0) return 0
  const target = scrollLeft + (tabLeft - navLeft) - (navWidth - tabWidth) / 2
  return Math.max(0, Math.min(target, overflow))
}

/**
 * Pestañas que son links de verdad (la URL se comparte y «atrás» funciona), con el subrayado de
 * las pestañas de Automatizaciones. Sirven para los dos niveles del panel: las partes de una
 * sección, arriba de todo (`SectionTabsBar`), y las vistas de una pantalla, debajo del título
 * (`?tab=` o sub-rutas). La activa la decide quien las usa y se marca con `aria-current="page"`.
 *
 * En el celular la barra se desliza de costado, sin barra de scroll a la vista, y si la activa es
 * de las últimas (y quedaría tapada) se trae al centro de la barra sin mover la página. Si la
 * barra entra entera, no se mueve nada.
 */
export function SectionTabs({
  items,
  active,
  label,
  className,
}: {
  items: readonly SectionTabItem[]
  /** `value` de la pestaña activa; `null` si no corresponde ninguna (una ficha de detalle). */
  active: string | null
  /** Para lectores: «Secciones de Compras». */
  label: string
  className?: string
}) {
  const navRef = useRef<HTMLElement>(null)

  // Layout effect: corre antes de pintar, así la barra no aparece en cero y después salta.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` no se lee adentro, pero cambiar de pestaña tiene que volver a centrar la nueva (el DOM ya la marca con aria-current)
  useLayoutEffect(() => {
    const nav = navRef.current
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !tab) return
    const overflow = nav.scrollWidth - nav.clientWidth
    if (overflow <= 0) return
    const navBox = nav.getBoundingClientRect()
    const tabBox = tab.getBoundingClientRect()
    nav.scrollLeft = scrollLeftToCenter({
      scrollLeft: nav.scrollLeft,
      overflow,
      navLeft: navBox.left,
      navWidth: navBox.width,
      tabLeft: tabBox.left,
      tabWidth: tabBox.width,
    })
  }, [active])

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={cn(
        '-mx-4 flex items-center gap-1 overflow-x-auto border-b border-border/60 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.value === active
        return (
          <Link
            key={item.value}
            href={item.href}
            scroll={false}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              // ring-inset: la barra scrollea (overflow) y recorta lo que sale de la pestaña, así
              // que el anillo de foco se dibuja adentro para que se vea entero con el teclado.
              'relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.shortLabel ? (
              <>
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
              </>
            ) : (
              item.label
            )}
            {item.count ? (
              <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {item.count}
              </span>
            ) : null}
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
