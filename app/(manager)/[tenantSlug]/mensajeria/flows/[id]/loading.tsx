import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col px-4 py-4 sm:px-6">
      <div className="mb-4 shrink-0 space-y-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-16" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-44 shrink-0 space-y-2 border-r border-border/60 p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
          <div className="flex flex-1 items-start justify-center p-8">
            <div className="w-56 space-y-6">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="mx-auto h-20 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
