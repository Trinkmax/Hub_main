import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/** La portada de la guía: el encabezado, el mapa de cinco paradas, las recetas y la rutina. */
export default function GuiasLoading() {
  return (
    <AdmPage>
      <div className="space-y-2">
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      {/* El mapa: el panel verde con sus cinco paradas (parado en el celular). */}
      <div className="@container rounded-3xl border border-border/60 bg-card/60 p-5 sm:p-7">
        <Skeleton className="h-7 w-96 max-w-full" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <div className="mt-7 grid gap-6 @[60rem]:grid-cols-5">
          {['a', 'b', 'c', 'd', 'e'].map((k) => (
            <div key={k} className="space-y-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-7 w-40 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2 pt-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
          <Skeleton key={k} className="h-[4.5rem] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-5 xl:grid-cols-1">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl xl:col-span-7 xl:h-full" />
      </div>
    </AdmPage>
  )
}
