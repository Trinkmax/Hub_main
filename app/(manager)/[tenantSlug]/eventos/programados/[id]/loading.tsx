import { PageShell } from '@/components/ui/page-shell'
import {
  SkeletonForm,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

/** Un evento programado: su formulario y, abajo, sus reservas. */
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando el evento…" />
      <SkeletonPageHeader context actions={1} description={false} />
      <SkeletonForm fields={6} />
      <SkeletonTable rows={4} columns={4} />
    </PageShell>
  )
}
