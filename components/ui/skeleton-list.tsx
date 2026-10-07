import { Skeleton } from './skeleton'

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card-hairline rounded-xl border bg-card">
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={`skeleton-${i.toString()}`}
            className="flex items-center gap-3 px-4 py-3"
          >
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`card-skeleton-${i.toString()}`}
          className="card-hairline rounded-xl border bg-card p-5 space-y-3"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  )
}
