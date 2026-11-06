import { Skeleton } from '@/components/ui/skeleton'

export default function StockLoading() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-4 pt-2 pb-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-36 w-full rounded-3xl" />
      <Skeleton className="h-28 w-full rounded-3xl" />
      <Skeleton className="h-32 w-full rounded-3xl" />
    </div>
  )
}
