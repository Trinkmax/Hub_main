import { Planilla, SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'

/** La ficha del gasto fijo mientras carga: el título y el bloque con sus campos en grilla. */
export default function GastoFijoLoading() {
  return (
    <SimplePage width="narrow">
      <span className="sr-only" aria-live="polite">
        Cargando el gasto fijo…
      </span>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
      </div>
      <Planilla>
        <div className="grid gap-x-6 gap-y-5 p-4 sm:p-5 md:grid-cols-2">
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
      </Planilla>
    </SimplePage>
  )
}
