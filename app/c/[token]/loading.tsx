import { Skeleton } from '@/components/ui/skeleton'

// Esqueleto de la wallet mientras resuelve el server component de la page.
// Espeja el layout: header → hero → canjeables → QR.

export default function WalletLoading() {
  return (
    <main className="bg-app-gradient min-h-[100dvh]">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pb-16 pt-8 sm:pt-12">
        {/* Header */}
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-36" />
        </div>

        {/* Tier hero */}
        <div className="card-hairline flex flex-col items-center gap-4 rounded-2xl border bg-card p-6">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="size-[168px] rounded-full" />
          <Skeleton className="h-4 w-48" />
          <div className="mt-2 grid w-full grid-cols-2 gap-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        </div>

        {/* Canjeables */}
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders fijos sin identidad
              <div key={i} className="card-hairline overflow-hidden rounded-2xl border bg-card">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* QR */}
        <div className="card-hairline flex flex-col items-center gap-4 rounded-2xl border bg-card p-6">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="size-56 max-w-full rounded-2xl" />
          <Skeleton className="h-4 w-52" />
        </div>
      </div>
    </main>
  )
}
