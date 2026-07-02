import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <ListSkeleton rows={8} />
    </div>
  )
}
