import { Skeleton } from '@/components/ui-legacy/skeleton'

export default function EscanearLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="aspect-square w-full rounded-2xl" />
      <Skeleton className="h-13 w-full rounded-lg" />
    </div>
  )
}
