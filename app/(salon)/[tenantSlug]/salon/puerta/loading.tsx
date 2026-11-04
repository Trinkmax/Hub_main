import { Skeleton } from '@/components/ui/skeleton'

export default function PuertaLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="aspect-square w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  )
}
