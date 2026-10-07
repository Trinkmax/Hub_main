'use client'

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { softDeleteCustomer } from '@/lib/customers/actions'

/**
 * «Borrar» de la ficha. Es un borrado lógico (`deleted_at`): por eso la
 * confirmación explica que los datos quedan guardados. Si falla, el diálogo
 * queda abierto con el motivo (ConfirmDialog del kit).
 */
export function DeleteButton({
  tenantSlug,
  customerId,
  customerName,
}: {
  tenantSlug: string
  customerId: string
  customerName: string
}) {
  const router = useRouter()

  return (
    <ConfirmDialog
      tone="danger"
      title={`¿Borrar a «${customerName}»?`}
      description="Deja de aparecer en la lista y en las estadísticas, pero sus datos quedan guardados. Si te equivocaste, soporte lo puede recuperar."
      confirmLabel="Borrar cliente"
      pendingLabel="Borrando…"
      trigger={
        <Button variant="danger-ghost">
          <Trash2 aria-hidden="true" />
          Borrar
        </Button>
      }
      onConfirm={async () => {
        const result = await softDeleteCustomer(tenantSlug, customerId)
        if (!result.ok) return result
        toast.success('Cliente borrado.')
        router.push(`/${tenantSlug}/clientes`)
      }}
    />
  )
}
