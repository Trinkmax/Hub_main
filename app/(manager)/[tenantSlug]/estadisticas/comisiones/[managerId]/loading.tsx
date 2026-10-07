import { PageShell } from '@/components/ui/page-shell'
import {
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

// Copia el detalle del gestor: volver + nombre, los tres totales y la tabla de
// reservas (con scroll de costado en el celular, como la de verdad).
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div className="flex flex-col gap-6">
        <SkeletonKPIGroup count={3} columns={3} />
        <SkeletonTable rows={6} columns={8} mobile="scroll" />
      </div>
    </PageShell>
  )
}
