'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useShellHomeHref } from '@/components/shell/shell-home'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'

/**
 * Error de cualquier pantalla del panel (kit §4.7). Se dibuja adentro del
 * shell, porque el layout persiste: el menú y ⌘K siguen a mano para irse a
 * otro lado. (Mensajería tiene el suyo, más cerca.)
 *
 * «Reintentar» vuelve a pedir la pantalla al server y después limpia el error
 * (`router.refresh()` + `reset()`, lo mismo que el `unstable_retry` de Next
 * 16): las pantallas son Server Components y con `reset()` solo se volvería a
 * dibujar el mismo resultado roto.
 */
export default function ManagerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const homeHref = useShellHomeHref()

  useEffect(() => {
    // Solo el digest: el mensaje puede traer datos de alguien (CLAUDE.md §9).
    // El detalle está en el log del server, buscándolo por este código.
    console.error('[panel] error de render', { digest: error.digest ?? null })
  }, [error])

  return (
    <PageShell width="compact">
      <ErrorState
        size="lg"
        // Reemplaza a la página entera (y a su <h1>).
        headingLevel={1}
        title="Algo se rompió en esta pantalla"
        description={
          error.digest
            ? 'No es tu culpa. Probá de nuevo; si sigue pasando, avisanos con este código.'
            : 'No es tu culpa. Probá de nuevo; si sigue pasando, avisanos.'
        }
        error={error}
        onRetry={() => {
          router.refresh()
          reset()
        }}
        homeHref={homeHref}
      />
    </PageShell>
  )
}
