'use client'

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
import { saveParty } from '@/lib/accounting/actions/master'
import type { PartyKind } from '@/lib/accounting/types'

/**
 * Desactivar (o volver a activar) un proveedor. Desactivar se confirma: deja
 * de aparecer al cargar comprobantes. Lo ya cargado no cambia y su saldo se
 * sigue viendo.
 */
export function SupplierActiveToggle({
  tenantSlug,
  id,
  name,
  kind,
  active,
  updatedAt,
  hasBalance,
}: {
  tenantSlug: string
  id: string
  name: string
  kind: PartyKind
  active: boolean
  updatedAt: string
  /** Tiene deuda o saldo a favor: se puede desactivar igual, pero se avisa. */
  hasBalance: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  const save = (nextActive: boolean) =>
    start(async () => {
      try {
        const result = await saveParty(tenantSlug, {
          id,
          expectedUpdatedAt: updatedAt,
          kind,
          name,
          active: nextActive,
        })
        if (!result.ok) {
          toast.error(
            result.code === 'stale'
              ? 'Alguien cambió estos datos recién. Recargá la página y probá de nuevo.'
              : result.message,
          )
          return
        }
        setConfirming(false)
        toast.success(nextActive ? `${name} volvió a estar activo.` : result.message)
        router.refresh()
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  if (!active) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        disabled={pending}
        onClick={() => save(true)}
      >
        {pending ? 'Activando…' : 'Volver a activar'}
      </Button>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 text-muted-foreground md:h-8"
        onClick={() => setConfirming(true)}
      >
        Desactivar
      </Button>
      <AlertDialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivás a {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              No va a aparecer al cargar facturas, gastos ni pagos. Lo que ya cargaste queda igual y
              lo podés volver a activar cuando quieras.
              {hasBalance ? ' Ojo: todavía tiene saldo; se sigue viendo en la lista.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                save(false)
              }}
            >
              {pending ? 'Desactivando…' : 'Desactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
