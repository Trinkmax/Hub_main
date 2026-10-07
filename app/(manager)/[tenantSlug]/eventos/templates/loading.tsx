import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/**
 * `/eventos/templates` redirige a la pestaña Formatos del calendario: mientras
 * resuelve se ve la forma de esa pantalla (encabezado, pestañas y formatos).
 */
export default function Loading() {
  return (
    <PageShell width="wide" aria-busy="true">
      <SkeletonStatus label="Cargando los formatos…" />
      <SkeletonPageHeader actions={2} />
      <div aria-hidden className="flex flex-col gap-3">
        <div className="flex gap-6 border-b border-border pb-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  )
}
