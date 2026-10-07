import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

const INDEX_ROWS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11'] as const

/**
 * Mientras carga el catálogo: el encabezado con sus dos controles, el índice
 * de la izquierda (desde `lg`) y el primer bloque con sus dos paneles, a los
 * mismos altos que lo que viene (§3.4: nada salta al cargar).
 */
export default function Loading() {
  return (
    <PageShell width="wide" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context actions={2} />
      <Skeleton aria-hidden="true" className="h-16 w-full rounded-lg" />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div aria-hidden="true" className="hidden w-56 shrink-0 flex-col gap-2 lg:flex">
          {INDEX_ROWS.map((key) => (
            <Skeleton key={key} className="h-8 w-full" />
          ))}
        </div>
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-4">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
