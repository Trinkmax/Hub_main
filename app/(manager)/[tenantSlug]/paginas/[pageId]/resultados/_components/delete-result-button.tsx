'use client'

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { deleteExamResult } from '@/lib/landings/actions'

/** Saca un intento de la lista y del promedio (una prueba, uno repetido). */
export function DeleteResultButton({
  tenantSlug,
  pageId,
  resultId,
  name,
}: {
  tenantSlug: string
  pageId: string
  resultId: string
  name: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const result = await deleteExamResult(tenantSlug, { id: resultId, pageId })
      if (result.ok) {
        toast.success('Resultado borrado.')
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Borrar el resultado de ${name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar el resultado de {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de la lista y del promedio. Sirve para sacar una prueba o un intento repetido. No
              se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                confirm()
              }}
            >
              {pending ? 'Borrando…' : 'Sí, borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
