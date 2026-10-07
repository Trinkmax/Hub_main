'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Error boundary del salón. Sin esto, cualquier excepción en el turno le tira
 * al mozo la pantalla de error genérica de Next, sin marca y sin salida.
 */
export default function SalonError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[salon] boundary', error.digest ?? error.message)
  }, [error])

  return (
    <div className="card-hairline mt-6 rounded-2xl border bg-card p-8 text-center">
      <TriangleAlert className="mx-auto size-10 text-warning" aria-hidden />
      <h2 className="mt-3 font-display text-xl font-semibold tracking-tight">
        Se cortó algo de este lado
      </h2>
      <p className="mt-1 text-sm text-muted-foreground text-balance">
        No es culpa tuya. Probá de nuevo; si sigue pasando, avisale al dueño.
      </p>
      <Button onClick={reset} size="xl" className="mt-6 w-full gap-2">
        <RotateCcw className="size-4" aria-hidden />
        Reintentar
      </Button>
    </div>
  )
}
