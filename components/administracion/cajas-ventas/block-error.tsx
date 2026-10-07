'use client'

import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Un bloque que no se pudo leer (una lista, el estado de cuenta), sin tirar la
 * pantalla (H.2): el encabezado y el período siguen ahí. Mismo texto y forma
 * que el `error.tsx` de la sección; el motivo viene listo de la lectura (G.4).
 */
export function BlockError({ message, className }: { message: string; className?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <EmptyState
      className={className}
      icon={TriangleAlertIcon}
      title="No pudimos cargar esto."
      description={message}
      action={
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2 md:h-9"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RotateCcwIcon className="size-4" aria-hidden />
          {pending ? 'Reintentando…' : 'Reintentar'}
        </Button>
      }
    />
  )
}

/** El período de la URL no se entiende: se dice por qué y se elige de nuevo arriba. */
export function PeriodError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1 text-pretty">
        <p className="font-medium">{message}</p>
        <p className="text-muted-foreground">
          Elegí el período de nuevo con los botones de arriba.
        </p>
      </div>
    </div>
  )
}
