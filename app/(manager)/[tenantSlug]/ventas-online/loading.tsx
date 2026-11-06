import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Dos días de ejemplo, con tres y dos compras: lo que se ve mientras llegan los datos. */
const DAYS = [
  { id: 'hoy', rows: ['a', 'b', 'c'] },
  { id: 'ayer', rows: ['a', 'b'] },
] as const

/** Las mismas tarjetas por día que la página: el título del día y sus compras. */
export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Entradas"
        title="Ventas online"
        description={<Skeleton className="h-4 w-[30rem] max-w-full" />}
      />
      {DAYS.map((day) => (
        <div key={day.id} className="card-hairline overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-5">
            <Skeleton className="h-6 w-48 max-w-[60%]" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-2.5 p-3 sm:p-4">
            {day.rows.map((row) => (
              <Skeleton key={row} className="h-24 w-full rounded-xl md:h-12" />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  )
}
