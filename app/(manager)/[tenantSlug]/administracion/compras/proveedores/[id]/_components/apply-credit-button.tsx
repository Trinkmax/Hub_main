'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { allocateItems, unallocateItem } from '@/lib/accounting/actions/documents'

/**
 * «Usarlo ahora»: usa lo que el proveedor tiene a tu favor contra lo que le
 * debés (lo más viejo primero, contra lo que vence antes). No pregunta: guarda
 * y deja «Deshacer» 6 s (quita las imputaciones; vuelve a quedar a favor).
 *
 * Misma acción y mismo envío de siempre (`allocateItems` con los pares y la
 * fecha de hoy); cambió el nombre del botón, que era jerga.
 * La contadora no lo ve.
 */
export function ApplyCreditButton({
  pairs,
}: {
  pairs: ReadonlyArray<{ debitLineId: string; creditLineId: string; amountCents: number }>
}) {
  const { tenantSlug, today, readOnly } = useAccounting()
  const router = useRouter()
  const [pending, start] = useTransition()

  if (readOnly || pairs.length === 0) return null

  const apply = () =>
    start(async () => {
      try {
        const result = await allocateItems(tenantSlug, { pairs: [...pairs], date: today })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        router.refresh()
        const ids = result.data.allocationIds
        toastUndo('Usaste lo que tenías a favor', {
          description: result.message,
          onUndo: async () => {
            try {
              for (const allocationId of ids) {
                const undone = await unallocateItem(tenantSlug, {
                  allocationId,
                  reason: 'Deshacer',
                })
                if (!undone.ok) {
                  toast.error(undone.message)
                  router.refresh()
                  return
                }
              }
              toast.success('Listo: volvió a quedar a tu favor.')
              router.refresh()
            } catch {
              toast.error(ACC_UNREACHABLE.offline)
            }
          },
        })
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 shrink-0 rounded-full px-5 md:h-9"
      disabled={pending}
      onClick={apply}
    >
      {pending ? 'Usándolo…' : 'Usarlo ahora'}
    </Button>
  )
}
