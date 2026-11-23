'use client'

import { FileQuestion } from 'lucide-react'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { BackToSummary } from './back-to-summary'

/**
 * El 404 de la sección. Para quien tiene «solo compras y pagos» también es lo que ve en lo que no es de
 * su acceso (caja, ventas, sueldos, libros…): «no existe o es de otro bar» no sería cierto, así que se
 * le dice qué ve con su acceso. Lo de un comprobante que ya no está vale para los dos.
 */
export function SectionNotFound() {
  const buyer = useAccountingOptional()?.purchasesOnly === true
  return (
    <EmptyState
      icon={FileQuestion}
      title={buyer ? 'Esto no está en Compras y pagos.' : 'Eso no existe o es de otro bar.'}
      description={
        buyer
          ? 'Con tu acceso a Administración ves las compras, los pagos y los proveedores. Si era un comprobante, puede que lo hayan anulado o que el link esté incompleto.'
          : 'Puede que lo hayan anulado o que el link esté incompleto.'
      }
      action={<BackToSummary />}
    />
  )
}
