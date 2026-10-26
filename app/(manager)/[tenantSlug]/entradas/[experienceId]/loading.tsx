import { Skeleton } from '@/components/ui/skeleton'

/** Espeja el editor: encabezado, el formulario a la izquierda y publicación + funciones a la derecha. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-1 size-9 shrink-0 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6 lg:order-1">
          <Skeleton className="h-[26rem] w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
        <div className="order-first space-y-6 lg:order-2">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="hidden h-48 w-full rounded-xl lg:block" />
        </div>
      </div>
    </div>
  )
}
