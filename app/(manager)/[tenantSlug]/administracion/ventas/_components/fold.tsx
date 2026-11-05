import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** El plegable de una pantalla: el rótulo y la flecha. */
export const FOLD_SUMMARY =
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:pointer-fine:min-h-9 [&::-webkit-details-marker]:hidden'

export function FoldChevron() {
  return (
    <ChevronDown
      aria-hidden
      className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/fold:rotate-180 motion-reduce:transition-none"
    />
  )
}

/**
 * Lo que existe y no se usa todos los días, plegado debajo de la planilla: el mismo papel, con su
 * rótulo y la flecha. Sin JavaScript (`<details>`): lo de adentro ya viene en la página.
 */
export function PlanillaFold({
  title,
  open = false,
  className,
  children,
}: {
  title: ReactNode
  open?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <details
      open={open}
      className={cn('group/fold rounded-xl border border-border/70 bg-card shadow-xs', className)}
    >
      <summary className={cn(FOLD_SUMMARY, 'px-3')}>
        {title}
        <FoldChevron />
      </summary>
      <div className="border-t border-border/70 p-3">{children}</div>
    </details>
  )
}
