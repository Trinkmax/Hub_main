import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="card-hairline space-y-4 rounded-xl border bg-card p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={`field-${i.toString()}`} className="h-10 w-full" />
        ))}
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  )
}
