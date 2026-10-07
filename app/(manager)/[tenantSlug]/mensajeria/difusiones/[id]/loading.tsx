import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-32" />
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={`stat-${i.toString()}`} className="h-28 rounded-xl" />
        ))}
      </section>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  )
}
