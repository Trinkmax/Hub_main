import Link from 'next/link'
import { cn } from '@/lib/utils'

export type SectionNavItem = {
  /** Lo que identifica la pestaña (`proveedores`, `comprobantes`…). */
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
 * Las pestañas de una pantalla de Administración (`?tab=` o sub-rutas): links
 * de verdad (la URL se comparte y «atrás» funciona) con el subrayado de las
 * pestañas de Automatizaciones. La pestaña activa la decide la página (ya
 * leyó `searchParams`) y se marca con `aria-current="page"`. Server-safe.
 */
export function SectionNav({
  items,
  active,
  label,
  className,
}: {
  items: readonly SectionNavItem[]
  active: string
  /** Para lectores: «Secciones de Compras». */
  label: string
  className?: string
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        '-mx-4 flex items-center gap-1 overflow-x-auto border-b border-border/60 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0',
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
              'relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
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
