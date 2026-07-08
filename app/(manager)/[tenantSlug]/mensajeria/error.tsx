'use client'

import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

// Error boundary de la sección Mensajería. Las páginas son `force-dynamic` con
// queries a Supabase; sin esto, un fallo de datos mostraba el error crudo de Next.
export default function MensajeriaError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log para diagnóstico (el digest referencia el log del server; sin PII del cliente).
    console.error('[mensajeria] error de render:', error.digest ?? error.message)
  }, [error])

  return (
    <div className="p-4 sm:p-6">
      <EmptyState
        icon={TriangleAlertIcon}
        title="No pudimos cargar esta sección"
        description="Ocurrió un error al traer los datos de mensajería. Suele ser temporal — probá de nuevo en un momento."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => reset()}
          >
            <RotateCcwIcon className="size-4" aria-hidden />
            Reintentar
          </Button>
        }
      />
    </div>
  )
}
