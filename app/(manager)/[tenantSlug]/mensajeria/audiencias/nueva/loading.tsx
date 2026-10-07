import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-10 w-full sm:max-w-md" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-11 w-full sm:w-32" />
    </div>
  )
}
