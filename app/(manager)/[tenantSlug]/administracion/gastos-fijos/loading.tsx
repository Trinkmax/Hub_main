import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import { SheetSkeleton } from './_components/sheet-skeleton'

/** Gastos fijos mientras carga: el título, las píldoras de mes y la hoja con su forma. */
export default function GastosFijosLoading() {
  return (
    <AdmPage>
      <div aria-busy="true" className="space-y-6">
        <span className="sr-only">Cargando Gastos fijos…</span>
        <div className="space-y-2">
          <Skeleton className="h-9 w-48 max-w-full" />
          <Skeleton className="h-4 w-[26rem] max-w-full" />
        </div>
        <SheetSkeleton />
      </div>
    </AdmPage>
  )
}
