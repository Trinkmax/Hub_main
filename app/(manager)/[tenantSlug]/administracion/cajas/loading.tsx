import { Suspense } from 'react'
import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import { TabSkeleton } from './_components/caja-switch'
import { LoQueHaySkeleton } from './_components/cash-daily-section'
import { FlowTabSkeleton } from './_components/flow-blocks'

/**
 * Cajas y bancos mientras carga, con la forma de lo que viene. «Lo que hay» es
 * la billetera: el total, las acciones, tres tarjetas con su lomo, el dibujo y
 * los movimientos. «Entró y salió» (`?tab=flujo`) es otra pantalla: el período,
 * el dibujo por mes, las barras por categoría y las próximas semanas. Cuál de
 * los dos se ve lo decide `TabSkeleton`, que lee la URL.
 *
 * Los dos esqueletos son los mismos que muestra la página al cambiar de vista.
 */
export default function CajasLoading() {
  return (
    <AdmPage>
      <Skeleton className="h-9 w-56" />
      <div className="flex gap-1.5">
        <Skeleton className="h-11 w-28 rounded-full md:h-9" />
        <Skeleton className="h-11 w-32 rounded-full md:h-9" />
      </div>
      {/* Sin la URL a mano (el primer dibujo en el servidor), la vista de siempre. */}
      <Suspense fallback={<LoQueHaySkeleton />}>
        <TabSkeleton saldos={<LoQueHaySkeleton />} flujo={<FlowTabSkeleton />} />
      </Suspense>
    </AdmPage>
  )
}
