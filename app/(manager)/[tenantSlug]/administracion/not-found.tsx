import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { BackToSummary } from './_components/back-to-summary'

/** Un comprobante, asiento o ficha que no existe (o que es de otro bar: la RLS no lo muestra). */
export default function AdministracionNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <EmptyState
        icon={FileQuestion}
        title="Eso no existe o es de otro bar."
        description="Puede que lo hayan anulado o que el link esté incompleto."
        action={<BackToSummary />}
      />
    </div>
  )
}
