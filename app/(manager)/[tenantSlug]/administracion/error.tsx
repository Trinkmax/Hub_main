'use client'

import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/** Un fallo al traer datos de Administración: se reintenta sin perder la sección (H.2). */
export default function AdministracionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Solo el digest o el mensaje técnico: nunca datos del bar ni de personas.
    console.error('[administracion] error de render:', error.digest ?? error.message)
  }, [error])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <EmptyState
        icon={TriangleAlertIcon}
        title="No pudimos cargar esto."
        description="Suele ser algo pasajero: probá de nuevo. Si sigue pasando, avisanos."
        action={
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 md:h-9"
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
