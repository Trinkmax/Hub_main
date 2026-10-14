'use client'

import { RotateCcwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'

/**
 * «Reintentar» de un bloque que no cargó: vuelve a pedir la página sin perder
 * el resto (lo que ya se ve se queda donde está). 44 px en el celular.
 *
 * Cuándo NO: para reintentar un guardado (eso lo resuelve cada formulario con
 * su botón); ni suelto, sin decir antes qué fue lo que no cargó (`PanelError`).
 */
export function RetryButton({ label = 'Reintentar' }: { label?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 gap-2 md:h-9"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RotateCcwIcon className="size-4" aria-hidden />
      {pending ? 'Cargando…' : label}
    </Button>
  )
}
