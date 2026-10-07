import { Skeleton } from '@/components/ui/skeleton'

/** Espeja el chrome del editor: barra arriba, previa a la derecha, código a la izquierda. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <Skeleton className="h-[4.5rem] w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start">
        <div className="order-1 space-y-3 lg:order-2">
          <Skeleton className="h-[42dvh] w-full rounded-xl lg:h-[calc(100dvh-22rem)] lg:min-h-[26rem]" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <div className="order-2 space-y-3 lg:order-1">
          <Skeleton className="h-9 w-64 rounded-lg" />
          <Skeleton className="h-[52dvh] w-full rounded-xl lg:h-[calc(100dvh-16rem)]" />
        </div>
      </div>
    </div>
  )
}
