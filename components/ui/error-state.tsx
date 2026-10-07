'use client'

import { CircleAlert } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { useEffect, useRef, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { emptyStateParts, emptyStateVariants } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

/**
 * Algo no cargó (kit HUB §3.4). Mismo esqueleto que `EmptyState`, con
 * `CircleAlert` en un disco `destructive-soft`.
 *
 * - Muestra el `digest` del error («Código: 3f2a…») con un botón para copiarlo
 *   entero: es lo que el dueño nos pasa para buscarlo en los logs.
 * - **Nunca muestra `error.message` en producción** (puede traer datos de
 *   alguien). En desarrollo, sí, abajo y chico.
 * - `size="sm"` es en línea (una fila de tabla, una tarjeta): lleva
 *   `role="alert"`. `md` (default) y `lg` son de página: el título es un
 *   encabezado y recibe el foco al aparecer, así el lector de pantalla arranca
 *   por ahí.
 * - «Reintentar» corre `onRetry` adentro de una transición: muestra el spinner
 *   mientras tanto y no se puede disparar dos veces (sigue enfocable).
 *
 * Cliente por el reintento y el foco. Desde un Server Component se usa sin
 * `onRetry` (las funciones no cruzan la frontera) y sin `error`.
 */

export type ErrorStateProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  /** Default «No pudimos cargar esto». */
  title?: string
  /** Default «Probá de nuevo. Si sigue pasando, avisanos con este código.» */
  description?: React.ReactNode
  error?: (Error & { digest?: string }) | null
  /** Puede ser asíncrono: el spinner dura lo que dure. */
  onRetry?: () => void | Promise<void>
  /** Default «Reintentar». */
  retryLabel?: string
  /** Link de salida, por ejemplo al Resumen (`/${slug}`). */
  homeHref?: string
  /** Default «Ir al Resumen». */
  homeLabel?: string
  size?: 'sm' | 'md' | 'lg'
  /**
   * Nivel del encabezado en página (`md`, `lg`). Default 2; el `error.tsx` de
   * un segmento, que reemplaza a la página entera (y a su `h1`), pasa 1.
   */
  headingLevel?: 1 | 2
}

/** El `digest` es largo: se ve el principio y se copia entero. */
function shortDigest(digest: string): string {
  return digest.length > 10 ? `${digest.slice(0, 8)}…` : digest
}

function ErrorState({
  title = 'No pudimos cargar esto',
  description,
  error,
  onRetry,
  retryLabel = 'Reintentar',
  homeHref,
  homeLabel = 'Ir al Resumen',
  size = 'md',
  headingLevel = 2,
  className,
  ...props
}: ErrorStateProps) {
  const [pending, startTransition] = useTransition()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const inline = size === 'sm'
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const digest = error?.digest?.trim() || null

  useEffect(() => {
    // En página, el foco va al título para que el lector arranque por el error.
    if (!inline) headingRef.current?.focus()
  }, [inline])

  const retry = () => {
    if (!onRetry || pending) return
    startTransition(async () => {
      await onRetry()
    })
  }

  const body =
    description ??
    (digest
      ? 'Probá de nuevo. Si sigue pasando, avisanos con este código.'
      : 'Probá de nuevo. Si sigue pasando, avisanos.')
  const devMessage = process.env.NODE_ENV === 'development' ? error?.message : undefined

  return (
    <div
      data-slot="error-state"
      role={inline ? 'alert' : undefined}
      className={cn(emptyStateVariants({ size }), className)}
      {...props}
    >
      <div
        data-slot="error-state-icon"
        className={cn(emptyStateParts.disc, 'bg-destructive-soft text-destructive-text')}
      >
        <CircleAlert className={emptyStateParts.icon} strokeWidth={1.75} aria-hidden="true" />
      </div>
      {inline ? (
        <div data-slot="error-state-title" className={emptyStateParts.title}>
          {title}
        </div>
      ) : (
        <Heading
          ref={headingRef}
          tabIndex={-1}
          data-slot="error-state-title"
          className={cn(emptyStateParts.title, 'outline-none')}
        >
          {title}
        </Heading>
      )}
      <div data-slot="error-state-description" className={emptyStateParts.description}>
        {body}
      </div>
      {digest ? (
        <div
          data-slot="error-state-code"
          className="mt-3 flex items-center justify-center gap-1 type-caption text-muted-foreground"
        >
          <span>
            Código: <span className="font-mono">{shortDigest(digest)}</span>
          </span>
          <CopyButton
            value={digest}
            iconOnly
            label="Copiar el código"
            copiedLabel="Código copiado"
          />
        </div>
      ) : null}
      {onRetry || homeHref ? (
        <div data-slot="error-state-actions" className={emptyStateParts.actions}>
          {homeHref ? (
            // Sin reintento, la salida es la acción principal.
            <Button
              asChild
              variant={onRetry ? 'secondary' : undefined}
              size={inline ? 'sm' : undefined}
            >
              <Link href={homeHref}>{homeLabel}</Link>
            </Button>
          ) : null}
          {onRetry ? (
            // `loading`: spinner, `aria-busy` y sin onClick mientras corre (sigue enfocable).
            <Button
              type="button"
              size={inline ? 'sm' : undefined}
              onClick={retry}
              loading={pending}
            >
              {retryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
      {devMessage ? (
        <pre
          data-slot="error-state-dev-message"
          className="mt-4 max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-left font-mono type-caption whitespace-pre-wrap text-muted-foreground"
        >
          {devMessage}
        </pre>
      ) : null}
    </div>
  )
}

export { ErrorState }
