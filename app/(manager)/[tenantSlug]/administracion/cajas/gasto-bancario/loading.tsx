import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'

const STEPS = [
  { key: 'a', rows: 1 },
  { key: 'b', rows: 1 },
  { key: 'c', rows: 5 },
  { key: 'd', rows: 2 },
] as const

/**
 * Gastos del banco mientras carga, con su forma: volver, el título, las cuatro
 * secciones numeradas y, al costado, el resumen que se arma.
 */
export default function GastoBancarioLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div
        aria-hidden="true"
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
      >
        <div className="space-y-4">
          {STEPS.map((step) => (
            <div
              key={step.key}
              className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-5 w-64 max-w-full" />
                  <Skeleton className="h-3.5 w-80 max-w-full" />
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {Array.from({ length: step.rows }, (_, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: renglones fijos de un esqueleto
                    key={index}
                    className="flex items-center justify-between gap-4"
                  >
                    <Skeleton className="h-4 w-48 max-w-[55%]" />
                    <Skeleton className="h-11 w-44 max-w-[40%] md:h-10" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* El papel del resumen */}
        <div className="hidden space-y-3 rounded-lg bg-adm-paper/60 p-5 lg:block">
          <Skeleton className="mx-auto h-5 w-40" />
          <Skeleton className="mx-auto h-3 w-28" />
          {['a', 'b', 'c'].map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-28" />
          </div>
        </div>
      </div>
    </AdmPage>
  )
}
