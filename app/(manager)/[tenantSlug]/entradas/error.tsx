'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

// Error boundary de Marketing › Entradas (la pestaña y el editor de cada película). Las páginas son
// `force-dynamic` con queries a Supabase; sin esto, un fallo de datos mostraba el error crudo de Next.
// `unstable_retry` (Next 16.2) vuelve a pedirle la página al server: `reset` solo re-renderizaría
// el mismo error que ya llegó.
export default function EntradasError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    // El digest referencia el log del server; sin datos de clientes.
    console.error('[entradas] error de render:', error.digest ?? error.message)
  }, [error])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <EmptyState
        icon={TriangleAlert}
        title="No pudimos cargar las entradas online"
        description="Suele ser algo de un momento. Probá de nuevo; si sigue pasando, avisanos."
        action={
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={pending}
            onClick={() => startTransition(() => unstable_retry())}
          >
            <RotateCcw className={pending ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            {pending ? 'Cargando…' : 'Reintentar'}
          </Button>
        }
      />
    </div>
  )
}
