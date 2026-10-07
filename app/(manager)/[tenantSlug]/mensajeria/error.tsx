'use client'

import { useParams } from 'next/navigation'
import { useEffect } from 'react'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'

// Error boundary de la sección Mensajería. Las páginas son `force-dynamic` con
// queries a Supabase; sin esto, un fallo de datos mostraba el error crudo de Next.
// Se dibuja adentro del marco de WhatsApp (el layout persiste).
export default function MensajeriaError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const params = useParams<{ tenantSlug?: string }>()
  const tenantSlug = typeof params?.tenantSlug === 'string' ? params.tenantSlug : null

  useEffect(() => {
    // Solo el digest: referencia el log del server y no lleva datos de nadie.
    console.error('[mensajeria] error de render:', error.digest ?? '(sin digest)')
  }, [error])

  return (
    <PageShell width="compact">
      <ErrorState
        size="lg"
        headingLevel={1}
        title="No pudimos cargar esta sección"
        description={
          error.digest
            ? 'Suele ser algo pasajero al traer los datos de mensajería. Probá de nuevo; si sigue pasando, avisanos con este código.'
            : 'Suele ser algo pasajero al traer los datos de mensajería. Probá de nuevo en un momento.'
        }
        error={error}
        onRetry={reset}
        homeHref={tenantSlug ? `/${tenantSlug}` : undefined}
      />
    </PageShell>
  )
}
