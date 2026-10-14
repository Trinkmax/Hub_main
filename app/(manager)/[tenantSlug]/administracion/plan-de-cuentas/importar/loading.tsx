import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/** Importar plan mientras carga: el «‹ Plan de cuentas», el título y el paso 1 (pegar el plan). */
export default function ImportarPlanLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-36" />
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-4 w-[34rem] max-w-full" />
        </div>
      </div>
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="flex items-start gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-48 w-full" />
        <div className="flex justify-end">
          <Skeleton className="h-11 w-40 md:pointer-fine:h-9" />
        </div>
      </div>
    </AdmPage>
  )
}
