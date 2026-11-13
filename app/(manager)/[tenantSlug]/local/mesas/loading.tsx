import { Skeleton } from '@/components/ui/skeleton'

/** El hueco del editor mientras llega el plano: el mismo tamaño, así nada salta al cargar. */
export default function Loading() {
  return (
    <div className="p-3">
      <Skeleton className="h-[calc(100dvh-5rem)] min-h-[620px] w-full rounded-[22px]" />
    </div>
  )
}
