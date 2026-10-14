import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'

/** Factura aparte: volver, el título, los pasos a la izquierda y el papel de la factura a la derecha. */
export default function NuevaFacturaLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          {['a', 'b', 'c'].map((key) => (
            <div
              key={key}
              className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-5 w-56 max-w-full" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden space-y-3 rounded-[3px] border border-border/60 bg-card p-6 lg:block">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex gap-4 pt-2">
            <Skeleton className="size-14 rounded-[3px]" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="ml-auto h-7 w-32" />
        </div>
      </div>
    </AdmPage>
  )
}
