import { Skeleton } from '@/components/ui/skeleton'

export default function ReservasOperativoLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="size-10 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="size-10 rounded-md" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
