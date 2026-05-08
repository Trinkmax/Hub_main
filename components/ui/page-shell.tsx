import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageShellProps = {
  children: ReactNode
  className?: string
  /** width preset: `compact` (max-w-3xl), `default` (max-w-7xl), `wide` (max-w-screen-2xl) */
  width?: 'compact' | 'default' | 'wide' | 'full'
  /** Si true, no aplica padding lateral. Útil para layouts especiales (kanbans, kitchen). */
  flush?: boolean
}

const widthClass: Record<NonNullable<PageShellProps['width']>, string> = {
  compact: 'max-w-3xl',
  default: 'max-w-7xl',
  wide: 'max-w-screen-2xl',
  full: 'max-w-none',
}

/**
 * Container estándar para páginas del manager. Centraliza padding, max-width y vertical
 * spacing entre secciones. Reemplaza el patrón ad-hoc `mx-auto max-w-7xl space-y-6 px-4 py-8`.
 */
export function PageShell({
  children,
  className,
  width = 'default',
  flush = false,
}: PageShellProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full space-y-6 py-6 sm:py-8',
        widthClass[width],
        flush ? '' : 'px-4 sm:px-6 lg:px-8',
        className,
      )}
    >
      {children}
    </div>
  )
}
