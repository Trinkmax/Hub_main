import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Puesta en marcha mientras carga: el encabezado, el riel de seis pasos, dos
 * secciones numeradas y, al costado, el papel del ticket. La forma real de la
 * pantalla, sin spinner.
 */
export default function ConfigurarLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-2.5">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="flex max-w-md items-center gap-2">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((k, index) => (
          <div key={k} className="flex flex-1 items-center gap-2 last:flex-none">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            {index < 5 ? <Skeleton className="h-0.5 flex-1" /> : null}
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          {['a', 'b'].map((k) => (
            <div key={k} className="card-hairline space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-72 max-w-full" />
                  <Skeleton className="h-4 w-96 max-w-full" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-[5.5rem] rounded-xl" />
                <Skeleton className="h-[5.5rem] rounded-xl" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="hidden h-80 rounded-sm lg:block" />
      </div>
    </AdmPage>
  )
}
