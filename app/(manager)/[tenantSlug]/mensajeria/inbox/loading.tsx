import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Mensajería"
        title="Bandeja"
        description={<Skeleton className="h-4 w-80" />}
        className="pb-0"
      />
      <div className="card-hairline flex flex-1 overflow-hidden rounded-xl border bg-card">
        <aside className="flex w-full max-w-[320px] shrink-0 flex-col border-r border-border/60 bg-surface/40">
          <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-6 rounded-full" />
          </header>
          <div className="space-y-2 p-3">
            {['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((k) => (
              <Skeleton key={k} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </aside>
        <section className="hidden flex-1 flex-col gap-3 p-4 sm:flex">
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-16 w-3/4 rounded-lg" />
            <Skeleton className="ml-auto h-16 w-2/3 rounded-lg" />
            <Skeleton className="h-16 w-3/5 rounded-lg" />
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
        </section>
      </div>
    </div>
  )
}
