import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Un chip que es un link (nivel de sumas y saldos, «Antes de la refundición»):
 * el mismo chip de los rangos de Reservas, con la elección en la URL para que
 * «atrás» y compartir el link funcionen. Server-safe.
 */
export function ChipLink({
  href,
  active,
  children,
  className,
  'aria-label': ariaLabel,
}: {
  href: string
  active: boolean
  children: ReactNode
  className?: string
  'aria-label'?: string
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
        className,
      )}
    >
      {children}
    </Link>
  )
}
