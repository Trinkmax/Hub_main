'use client'

import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Un bloque que no se pudo leer (una lista, el estado de cuenta): su error con
 * «Reintentar», sin tirar el resto de la pantalla. Mismo texto y forma que el
 * `error.tsx` de la sección.
 */
export function BlockError({ message, className }: { message: string; className?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="No pudimos cargar esto."
      description={message}
      className={className}
      action={
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2 md:h-9"
          disabled={pending}
          onClick={() => start(() => router.refresh())}
        >
          <RotateCcwIcon className="size-4" aria-hidden />
          {pending ? 'Reintentando…' : 'Reintentar'}
        </Button>
      }
    />
  )
}
