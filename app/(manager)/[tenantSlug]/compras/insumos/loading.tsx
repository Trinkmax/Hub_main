import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** La misma forma que la lista: encabezado, búsqueda con filtros y dos zonas con sus filas. */
export default function InsumosLoading() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Compras"
        title="Insumos"
        description={<Skeleton className="h-4 w-[30rem] max-w-full" />}
        actions={
          <>
            <Skeleton className="h-11 flex-1 sm:w-40 sm:flex-none md:h-10" />
            <Skeleton className="h-11 flex-1 sm:w-48 sm:flex-none md:h-10" />
          </>
        }
      />
      <div className="space-y-3 border-b border-border/60 pb-3">
        <Skeleton className="h-11 w-full md:h-10" />
        <div className="flex gap-2 overflow-hidden">
          {['todos', 'corregir', 'frecuentes', 'secundarios', 'eventuales', 'desactivados'].map(
            (key) => (
              <Skeleton key={key} className="h-11 w-28 shrink-0 rounded-full md:h-9" />
            ),
          )}
        </div>
      </div>
      <div className="space-y-8">
        {['zona-a', 'zona-b'].map((zone) => (
          <section key={zone} className="space-y-2.5">
            <Skeleton className="h-6 w-40" />
            <div className="card-hairline divide-y divide-border/60 rounded-xl border bg-card shadow-xs">
              {['a', 'b', 'c', 'd'].map((row) => (
                <div key={row} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-44 max-w-full" />
                    <Skeleton className="h-3.5 w-64 max-w-full" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  )
}
