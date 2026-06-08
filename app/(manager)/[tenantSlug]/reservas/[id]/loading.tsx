import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`field-${i.toString()}`} className="h-10 w-full" />
          ))}
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  )
}
