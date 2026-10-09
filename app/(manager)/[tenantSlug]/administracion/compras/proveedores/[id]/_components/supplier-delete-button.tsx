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
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { deleteParty } from '@/lib/accounting/actions/master'
import { comprasHref } from '../../../_lib/links'

/**
 * «Eliminar» un proveedor (pedido de los socios, 09/10/2026): solo con la
 * cuenta corriente en cero. Si ya tiene comprobantes no se puede borrar (la
 * historia queda): la base lo dice y se sugiere desactivarlo.
 */
export function SupplierDeleteButton({
  tenantSlug,
  id,
  name,
  updatedAt,
  hasBalance,
}: {
  tenantSlug: string
  id: string
  name: string
  updatedAt: string
  hasBalance: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const remove = () =>
    start(async () => {
      try {
        const result = await deleteParty(tenantSlug, { id, expectedUpdatedAt: updatedAt })
        if (!result.ok) {
          toast.error(
            result.code === 'stale'
              ? 'Alguien cambió estos datos recién. Recargá la página y probá de nuevo.'
              : result.message,
          )
          setOpen(false)
          return
        }
        setOpen(false)
        toast.success(`${name} quedó eliminado.`)
        router.push(comprasHref(tenantSlug))
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 gap-1.5 text-muted-foreground md:h-8"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" aria-hidden />
        Eliminar
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasBalance ? `${name} todavía tiene saldo` : `¿Eliminás a ${name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasBalance
                ? 'Un proveedor se elimina cuando su cuenta corriente queda en cero. Cancelá lo que le debés (o aplicá lo que tenés a favor) y después lo podés eliminar.'
                : 'Se borra de la lista. Si ya le cargaste facturas o pagos no se puede borrar (esos comprobantes lo nombran): en ese caso desactivalo y deja de aparecer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {hasBalance ? (
              <AlertDialogCancel>Entendido</AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault()
                    remove()
                  }}
                >
                  {pending ? 'Eliminando…' : 'Eliminar'}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
