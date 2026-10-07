import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

export default function ClientesLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <ListSkeleton rows={8} />
    </div>
  )
}
