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
 * «Aplicar ahora» (H.7): usa los saldos a favor del proveedor contra sus
 * facturas pendientes (el más viejo primero, contra la que vence antes). No
 * pregunta: guarda y deja «Deshacer» 6 s (quita las imputaciones; el saldo
 * vuelve a quedar a favor).
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
        toastUndo('Saldo a favor aplicado', {
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
              toast.success('Listo: el saldo volvió a quedar a favor.')
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
      size="sm"
      className="h-11 shrink-0 md:h-8"
      disabled={pending}
      onClick={apply}
    >
      {pending ? 'Aplicando…' : 'Aplicar ahora'}
    </Button>
  )
}
