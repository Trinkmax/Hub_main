import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { MESAS_DESCRIPTION, MESAS_TITLE } from './_components/page-copy'

/**
 * Copia el layout final del editor (pestañas y la grilla áreas · lienzo ·
 * panel, con los mismos cortes) para que nada salte al cargar. Es un `div`
 * (PageShell): el `<main>` lo pone el shell.
 */
export default function Loading() {
  return (
    <PageShell width="wide" aria-busy="true">
      <SkeletonStatus />
      <PageHeader title={MESAS_TITLE} description={MESAS_DESCRIPTION} />

      <div aria-hidden="true" className="flex flex-col gap-6">
        {/* Pestañas: Editar plano · En vivo · Lista de mesas */}
        <div className="flex min-h-10 items-center gap-6 shadow-[inset_0_-1px_0_0_var(--border)] pointer-coarse:min-h-11">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
          {/* Áreas */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-3 lg:col-span-2 xl:col-span-1">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>

          {/* Paleta + lienzo */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {['mesa', 'barra', 'pared', 'columna', 'isla', 'puerta'].map((k) => (
                <Skeleton key={k} className="h-(--control-sm) w-20" />
              ))}
            </div>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-[70vh] min-h-[420px] w-full rounded-xl" />
          </div>

          {/* Panel del costado */}
          <div className="flex flex-col gap-3 self-start rounded-xl border border-border bg-card p-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
