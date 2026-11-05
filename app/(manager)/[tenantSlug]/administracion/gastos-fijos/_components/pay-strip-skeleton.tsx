import { Skeleton } from '@/components/ui/skeleton'

/** La tira de pago mientras baja lo que necesita: la forma real, sin spinner. */
export function PayStripSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
      <span className="sr-only">Cargando las cajas…</span>
      <div className="grid w-full gap-1.5 sm:w-52">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-full pointer-coarse:h-11" />
      </div>
      <div className="grid w-full gap-1.5 sm:w-40">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-9 w-full pointer-coarse:h-11" />
      </div>
      <Skeleton className="h-9 w-28 pointer-coarse:h-11" />
      <Skeleton className="h-9 w-40 pointer-coarse:h-11" />
    </div>
  )
}
