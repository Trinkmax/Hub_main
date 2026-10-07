'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createAreaAction } from '@/lib/floor-plan/actions'

export function ZeroAreaCta({ slug }: { slug: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const onClick = () => {
    start(async () => {
      const result = await createAreaAction(slug, { name: 'Salón' })
      if (result.ok) {
        toast.success('Área creada.')
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Button type="button" onClick={onClick} loading={pending} loadingText="Creando…">
      <Plus aria-hidden />
      Crear la primera área
    </Button>
  )
}
