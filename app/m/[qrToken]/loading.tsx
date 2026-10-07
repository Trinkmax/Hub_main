import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col gap-4 p-6">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-32 w-full" />
    </main>
  )
}
