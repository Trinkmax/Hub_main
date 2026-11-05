import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * El segmento chico de los libros: Mes · Ejercicio · Rango, Plan simple · Todas, Posición · Compras ·
 * Ventas. Una fila de botones pegados, con el elegido relleno en tinta. 44 px donde se toca con el
 * dedo; 32 con mouse. Server-safe.
 */

export const SEG_ROOT =
  'inline-flex max-w-full items-stretch overflow-x-auto rounded-lg border border-border bg-card shadow-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export const SEG_ITEM =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap px-3 text-[13px] font-medium tabular-nums outline-none transition-colors not-first:border-l not-first:border-border/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none md:pointer-fine:h-8 md:pointer-fine:px-2.5'

export const SEG_ON = 'bg-primary text-primary-foreground'

export const SEG_OFF = 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'

export type SegLink = { key: string; label: string; href: string; active: boolean }

/** Un segmento de links (cada opción es otra URL). */
export function SegLinks({
  label,
  items,
  className,
}: {
  /** Nombre del grupo, para lectores de pantalla. */
  label: string
  items: readonly SegLink[]
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn(SEG_ROOT, className)}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          aria-current={item.active ? 'true' : undefined}
          className={cn(SEG_ITEM, item.active ? SEG_ON : SEG_OFF)}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
