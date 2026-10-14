import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Panel } from './panel'
import { RetryButton } from './retry-button'

/**
 * Un bloque que no se pudo leer: conserva su lugar y su título, dice por qué
 * (el motivo viene listo de la lectura: `settleQuery` ya lo deja en palabras)
 * y ofrece reintentar. El resto de la pantalla sigue ahí: una lectura que
 * falla nunca tira abajo la página entera.
 *
 *   if (!result.ok) return <PanelError title="Entró y salió" message={result.message} />
 *
 * Cuándo NO: para los errores de un formulario (eso es `FormBanner` y los
 * avisos de cada hoja); para un período inválido (`PeriodError`); ni para un
 * bloque vacío (eso es `EmptyTeach`: vacío no es error).
 */
export function PanelError({
  title,
  message,
  retryLabel,
  className,
}: {
  /** El mismo título que tiene el bloque cuando carga. */
  title: string
  message: string
  /** Por defecto, «Reintentar». */
  retryLabel?: string
  className?: string
}) {
  return (
    <Panel title={title} className={className}>
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="max-w-prose text-sm text-muted-foreground text-pretty">
          {message}
        </p>
        <RetryButton label={retryLabel} />
      </div>
    </Panel>
  )
}

/**
 * El link callado de un panel («Ver cajas», «Ver la proyección»): 44 px de
 * toque en el celular.
 *
 * Cuándo NO: para la acción principal del bloque (eso es un botón).
 */
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
