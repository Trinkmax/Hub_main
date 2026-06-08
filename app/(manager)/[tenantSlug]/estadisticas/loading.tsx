import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex gap-2">
        {['t1', 't2', 't3', 't4', 't5'].map((k) => (
          <Skeleton key={k} className="h-9 w-28 rounded-md" />
        ))}
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['s1', 's2', 's3', 's4'].map((k) => (
          <Skeleton key={k} className="h-28 w-full rounded-xl" />
        ))}
      </section>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  )
}
