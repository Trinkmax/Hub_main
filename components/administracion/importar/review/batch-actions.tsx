'use client'

import { RefreshCcw, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { buildImportProposals, cancelImportBatch } from '@/lib/imports/actions'
import { importHref } from '@/lib/imports/ui/labels'
import { OFFLINE_TEXT } from './review-context'

/** «Revisar de nuevo»: vuelve a armar todo con los datos de hoy (proveedores, cuentas, reglas). */
export function RebuildButton({
  slug,
  batchId,
  label = 'Revisar de nuevo',
  variant = 'outline',
}: {
  slug: string
  batchId: string
  label?: string
  variant?: 'outline' | 'default'
}) {
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      variant={variant}
      className="h-11 w-full gap-2 sm:w-auto md:h-9"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const result = await buildImportProposals(slug, { batchId })
            if (!result.ok) toast.error(result.message)
            else toast.success('Listo: lo volvimos a armar con los datos de hoy.')
          } catch {
            toast.error(OFFLINE_TEXT)
          }
        })
      }
    >
      <RefreshCcw className="size-4" aria-hidden />
      {pending ? 'Armando…' : label}
    </Button>
  )
}

/**
 * «Cancelar la importación» con confirmación (es irreversible): lo que no se
 * cargó queda afuera; lo que ya se cargó queda en los libros y se anula desde
 * cada comprobante, como siempre.
 */
export function CancelBatchButton({
  slug,
  batchId,
  posted,
}: {
  slug: string
  batchId: string
  /** Cuántos ya se cargaron (para decirlo en la confirmación). */
  posted: number
}) {
  const router = useRouter()
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()

  const cancel = () =>
    start(async () => {
      try {
        const result = await cancelImportBatch(slug, {
          batchId,
          reason: reason.trim() === '' ? null : reason.trim().slice(0, 300),
        })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(result.message)
        setOpen(false)
        router.push(importHref(slug))
      } catch {
        toast.error(OFFLINE_TEXT)
      }
    })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 text-destructive hover:text-destructive sm:w-auto md:h-9"
        onClick={() => setOpen(true)}
      >
        <XCircle className="size-4" aria-hidden />
        Cancelar la importación
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cancelás esta importación?</AlertDialogTitle>
          <AlertDialogDescription>
            Lo que todavía no se cargó se descarta.{' '}
            {posted > 0
              ? `Los ${posted} que ya se cargaron quedan en los libros: si hace falta, anulalos desde cada comprobante.`
              : 'No se cargó nada todavía, así que los libros no cambian.'}{' '}
            Después podés volver a subir el mismo archivo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={reasonId}>
            Motivo <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={300}
            rows={2}
            placeholder="Subí el archivo equivocado"
            className="text-base md:text-sm"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 md:h-9">Volver</AlertDialogCancel>
          <AlertDialogAction
            className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              cancel()
            }}
          >
            {pending ? 'Cancelando…' : 'Sí, cancelarla'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
