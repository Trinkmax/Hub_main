import Link from 'next/link'
import { cn } from '@/lib/utils'

export type SegmentItem = {
  key: string
  label: string
  href: string
  active: boolean
  /** Un contador al lado. Sin dato (o en cero), nada: un «0» al lado de cada opción es ruido. */
  count?: number
}

/** El marco de un segmento: las opciones pegadas, con el scroll adentro si no entran (celular). */
export const SEGMENT_LIST = 'inline-flex overflow-hidden rounded-lg border border-border bg-card'

/** Cada opción. Lo elegido va relleno; en táctil, cómodo para el pulgar. */
export function segmentOption(active: boolean): string {
  return cn(
    'inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:pointer-fine:h-8',
    active
      ? 'bg-primary font-medium text-primary-foreground'
      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
  )
}

/**
 * Un filtro chico de opciones que se excluyen: «Todos · Con factura · Sin factura». Cada opción es
 * un link (la lista se comparte y «atrás» funciona) y no mueve la página. Server-safe.
 */
export function Segment({
  label,
  items,
  className,
}: {
  /** Nombre accesible del filtro. */
  label: string
  items: readonly SegmentItem[]
  className?: string
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <ul className={SEGMENT_LIST}>
        {items.map((item) => (
          <li key={item.key} className="not-first:border-l not-first:border-border/70">
            <Link
              href={item.href}
              scroll={false}
              aria-current={item.active ? 'true' : undefined}
              className={segmentOption(item.active)}
            >
              {item.label}
              {item.count ? <span className="tabular-nums opacity-70">{item.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
