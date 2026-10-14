import { Suspense } from 'react'
import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import { TabSkeleton } from './_components/caja-switch'
import { CashMoveSkeleton } from './_components/cash-daily-section'
import { FlowSkeleton } from './_components/flow-blocks'
import { RecentActivitySkeleton } from './_components/recent-activity'

const CARDS = ['a', 'b', 'c'] as const
const ACTIONS = ['a', 'b', 'c', 'd'] as const

/**
 * Cajas y bancos mientras carga, con la forma de lo que viene. «Lo que hay» es
 * la billetera: el total, la fila de acciones, tres tarjetas con su lomo, el
 * dibujo y los movimientos. «Entró y salió» (`?tab=flujo`) es otra pantalla: el
 * período, el dibujo por mes, las barras por categoría y las próximas semanas.
 * Cuál de los dos se ve lo decide `TabSkeleton`, que lee la URL.
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
      <Suspense fallback={<WalletSkeleton />}>
        <TabSkeleton saldos={<WalletSkeleton />} flujo={<FlowTabSkeleton />} />
      </Suspense>
    </AdmPage>
  )
}

/** «Entró y salió»: el período con su «Exportar», los dos bloques del flujo y las próximas semanas. */
function FlowTabSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-11 w-64 max-w-full rounded-full md:h-9" />
        <Skeleton className="h-11 w-28 md:h-9" />
      </div>
      <FlowSkeleton />
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-96 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-36 w-full" />
      </div>
    </div>
  )
}

/** «Lo que hay»: la billetera. */
function WalletSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-11 w-64 max-w-full sm:h-12" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-4 w-36" />
          {/* Celular: cuatro círculos con su nombre. Compu: píldoras. */}
          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
            {ACTIONS.map((key) => (
              <div key={key} className="flex flex-col items-center gap-1.5 sm:block">
                <Skeleton className="size-12 rounded-full sm:h-11 sm:w-40" />
                <Skeleton className="h-3 w-14 sm:hidden" />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CARDS.map((key) => (
            <div
              key={key}
              className="card-hairline relative overflow-hidden rounded-2xl border bg-card p-4 pt-[1.375rem] shadow-xs"
            >
              <Skeleton className="absolute inset-x-0 top-0 h-1.5 rounded-none" />
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-9 w-44" />
              <Skeleton className="mt-3 h-6 w-40 rounded-full" />
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-11 w-20 rounded-full sm:h-9" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <CashMoveSkeleton className="lg:col-span-8" />
        <RecentActivitySkeleton className="lg:col-span-4" />
      </div>
    </div>
  )
}
