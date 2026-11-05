import { Suspense } from 'react'
import { SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { AccountsSkeleton } from './_components/accounts-skeleton'
import { TabSkeleton } from './_components/caja-switch'
import { FlowTabSkeleton } from './_components/flow-blocks'

/** Lo de arriba de la tabla: la frase y «Entró plata» / «Salió plata». */
function CuentasSkeleton() {
  return (
    <>
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-2.5">
        <Skeleton className="h-4 w-44" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <AccountsSkeleton />
    </>
  )
}

/**
 * Caja mientras carga, con la forma de lo que viene: la tabla de cuentas o, con `?tab=flujo`, el
 * detalle (el período, el dibujo por mes y las próximas semanas). Cuál de los dos se ve lo decide
 * `TabSkeleton`, que lee la URL.
 */
export default function CajasLoading() {
  return (
    <SimplePage>
      {/* Sin la URL a mano (el primer dibujo en el servidor), la tabla de siempre. */}
      <Suspense fallback={<CuentasSkeleton />}>
        <TabSkeleton saldos={<CuentasSkeleton />} flujo={<FlowTabSkeleton />} />
      </Suspense>
    </SimplePage>
  )
}
