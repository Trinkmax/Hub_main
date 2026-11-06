'use client'

import { RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'

/** Vuelve a pedirle los datos al server sin recargar la página entera. */
export function RetryButton({ label = 'Reintentar' }: { label?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 sm:h-9"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RotateCcw className={pending ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
      {pending ? 'Cargando…' : label}
    </Button>
  )
}
