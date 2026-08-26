import { Skeleton } from '@/components/ui/skeleton'

export default function QrClubLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="aspect-[3/4] w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  )
}
