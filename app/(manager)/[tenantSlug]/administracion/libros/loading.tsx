import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Libros mientras carga, con la forma real: el título, la fila de pestañas del
 * año, el panel del mes en dos columnas (la afirmación con su botón y el IVA) y
 * el índice de los libros.
 */
export default function LibrosLoading() {
  return (
    <AdmPage>
      <div className="space-y-2.5">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-1">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <Skeleton key={k} className="h-[4.25rem] rounded-t-xl rounded-b-md sm:w-28" />
          ))}
        </div>
        <div className="card-hairline grid gap-6 rounded-2xl border bg-card p-5 shadow-xs sm:p-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <Skeleton className="h-8 w-80 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
            <Skeleton className="h-12 w-full sm:w-64" />
          </div>
          <div className="space-y-3 border-t border-border/60 pt-5 lg:col-span-5 lg:border-l lg:border-t-0 lg:pt-0 lg:pl-6">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>

      <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="hidden h-10 w-64 sm:block" />
        </div>
        <div className="mt-5 gap-x-10 lg:columns-2">
          {['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => (
            <div
              key={k}
              className="flex break-inside-avoid items-center gap-3 border-b border-border/50 py-2.5"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-4 w-8" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </AdmPage>
  )
}
