import Link from 'next/link'
import type { ReactNode } from 'react'
import { Panel } from '@/components/administracion/kit/panel'
import { cn } from '@/lib/utils'
import { RetryButton } from './retry-button'

/**
 * Un bloque del Resumen que no se pudo leer: conserva su lugar y su título,
 * dice por qué (el motivo viene listo de la lectura) y ofrece reintentar. El
 * resto de la pantalla sigue ahí.
 */
export function PanelError({
  title,
  message,
  className,
}: {
  title: string
  message: string
  className?: string
}) {
  return (
    <Panel title={title} className={className}>
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="max-w-prose text-sm text-muted-foreground text-pretty">
          {message}
        </p>
        <RetryButton />
      </div>
    </Panel>
  )
}

/** El link callado de un panel («Ver cajas», «Ver la proyección»): 44 px de toque en el celular. */
export function PanelLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0',
        className,
      )}
    >
      {children}
    </Link>
  )
}
