'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ErrorState } from '@/components/ui/error-state'

/**
 * Error de una pantalla de Configuración. Va adentro del layout de la sección
 * (el `error.tsx` de un segmento no reemplaza al `layout.tsx` del mismo
 * segmento), así la subnavegación sigue a mano para ir a otra subpágina.
 *
 * «Reintentar» vuelve a pedir la pantalla al server y después limpia el error
 * (`router.refresh()` + `reset()`, como el error del panel): con `reset()`
 * solo se volvería a dibujar el mismo resultado roto.
 */
export default function ConfiguracionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const params = useParams<{ tenantSlug: string }>()

  useEffect(() => {
    // Solo el digest: el mensaje puede traer datos de alguien (CLAUDE.md §9).
    console.error('[configuracion] error de render', { digest: error.digest ?? null })
  }, [error])

  return (
    <ErrorState
      size="lg"
      // Reemplaza a la página (y a su <h1>), no a la subnavegación.
      headingLevel={1}
      title="No pudimos abrir esta parte de la configuración"
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
      homeHref={params?.tenantSlug ? `/${params.tenantSlug}/configuracion` : undefined}
      homeLabel="Volver a Configuración"
    />
  )
}
