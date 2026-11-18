'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { markOnboardingCompleted } from '@/lib/onboarding/actions'

/**
 * «Ocultar» de la lista de primeros pasos: para el bar que ya arrancó y no va a hacer alguno (por
 * ejemplo, uno que no hace eventos). No borra nada: solo deja de mostrar la lista.
 */
export function DismissChecklistButton({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 text-muted-foreground"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markOnboardingCompleted(tenantSlug)
          if (result.ok) router.refresh()
          else toast.error('No se pudo ocultar la lista. Probá de nuevo.')
        })
      }
    >
      {pending ? 'Ocultando…' : 'Ocultar'}
    </Button>
  )
}
