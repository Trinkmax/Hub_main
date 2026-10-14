import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'
import { HeaderSkeleton } from '../_components/book-skeleton'

/**
 * Asiento manual y «Sueldos del mes» mientras cargan: el encabezado y la hoja
 * de carga (el tipo o el primer paso, los campos y el botón). El esqueleto no
 * sabe todavía cuál de las dos caras toca, así que dibuja lo que tienen en
 * común.
 */
export default function AsientoManualLoading() {
  return (
    <AdmPage width="comfortable">
      <HeaderSkeleton action={false} />
      <div className="card-hairline grid gap-6 rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <div className="flex items-start gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-56 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {['a', 'b', 'c', 'd'].map((k) => (
            <div key={k} className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-12 w-full sm:w-52" />
      </div>
    </AdmPage>
  )
}
