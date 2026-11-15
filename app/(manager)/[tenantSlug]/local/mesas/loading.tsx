import { Skeleton } from '@/components/ui/skeleton'

/** El hueco del editor mientras llega el plano: el mismo tamaño, así nada salta al cargar. */
export default function Loading() {
  return (
    <Skeleton className="h-[calc(100dvh-3.5rem-var(--dock-space,0px))] min-h-[26rem] w-full rounded-none" />
  )
}
