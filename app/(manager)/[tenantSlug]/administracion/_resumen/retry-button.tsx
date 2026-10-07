'use client'

import { RotateCcwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'

/** «Reintentar» de un bloque que no cargó: vuelve a pedir la página sin perder el resto. */
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
