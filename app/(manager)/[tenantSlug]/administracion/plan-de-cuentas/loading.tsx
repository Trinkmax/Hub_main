import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Plan de cuentas mientras carga: el título, las tres píldoras de vista y la
 * lista en dos columnas (la forma de «Tus categorías», que es donde cae un
 * socio; el árbol de la contadora tiene el mismo ritmo de renglones).
 */
export default function PlanDeCuentasLoading() {
  return (
    <AdmPage>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <Skeleton className="h-11 w-44 md:pointer-fine:h-9" />
      </div>
      <div className="flex gap-1.5 overflow-hidden py-1">
        {['w-36', 'w-36', 'w-44'].map((w, i) => (
          <Skeleton
            key={`vista-${i.toString()}`}
            className={`h-11 shrink-0 rounded-full md:pointer-fine:h-9 ${w}`}
          />
        ))}
      </div>
      <div className="card-hairline space-y-5 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-96 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-full max-w-md rounded-full" />
        <div className="gap-x-10 lg:columns-2">
          {['a', 'b', 'c', 'd'].map((group) => (
            <div key={group} className="mb-6 break-inside-avoid space-y-1">
              <Skeleton className="mb-2 ml-2 h-3 w-32" />
              {['1', '2', '3', '4'].map((k) => (
                <div key={k} className="flex min-h-11 items-center gap-3 px-2">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AdmPage>
  )
}
