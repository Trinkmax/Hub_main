import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** La misma forma que la lista: un formato con sus variantes y los que no tienen receta. */
export default function RecetasLoading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Compras"
        title="Recetas"
        description={<Skeleton className="h-4 w-[28rem] max-w-full" />}
        actions={<Skeleton className="h-11 flex-1 sm:w-40 sm:flex-none md:h-10" />}
      />
      {['formato-a', 'formato-b'].map((group) => (
        <section key={group} className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {['a', 'b', 'c'].map((card) => (
              <div
                key={card}
                className="card-hairline space-y-3 rounded-xl border bg-card p-4 shadow-xs"
              >
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="space-y-3">
        <Skeleton className="h-6 w-56" />
        <div className="card-hairline divide-y divide-border/60 rounded-xl border bg-card shadow-xs">
          {['a', 'b'].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3 py-2 pr-2 pl-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-11 w-36 md:h-9" />
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  )
}
