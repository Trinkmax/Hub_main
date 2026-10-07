import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonCardGrid,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
} from '@/components/ui/skeleton'

/** Copia «Canjear puntos»: volver a la ficha, cliente y saldo, y la grilla de recompensas. */
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <SkeletonKPIGroup count={2} columns={2} />
      <div className="flex flex-col gap-4">
        <Skeleton aria-hidden="true" className="h-5 w-32" />
        <SkeletonCardGrid count={4} className="lg:grid-cols-2" />
      </div>
    </PageShell>
  )
}
