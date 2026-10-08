import { Skeleton } from '@/components/ui/skeleton'

/** La factura imprimible mientras carga: la barra de arriba y la hoja A4. */
export default function PrintFacturaLoading() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6" aria-busy="true">
      <span className="sr-only">Cargando la factura…</span>
      <div className="mx-auto w-full max-w-[210mm] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-40 bg-neutral-200" />
          <Skeleton className="h-9 w-48 bg-neutral-200" />
        </div>
        <div className="space-y-4 rounded-lg border border-neutral-300 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-6 w-48 bg-neutral-200" />
              <Skeleton className="h-3 w-36 bg-neutral-200" />
            </div>
            <Skeleton className="size-16 bg-neutral-200" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-28 bg-neutral-200" />
              <Skeleton className="h-3 w-44 bg-neutral-200" />
            </div>
          </div>
          <Skeleton className="h-16 w-full bg-neutral-200" />
          <Skeleton className="h-24 w-full bg-neutral-200" />
          <div className="flex justify-between gap-4">
            <Skeleton className="h-16 w-1/2 bg-neutral-200" />
            <Skeleton className="size-28 bg-neutral-200" />
          </div>
        </div>
      </div>
    </main>
  )
}
