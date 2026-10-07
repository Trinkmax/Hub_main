import { PageShell } from '@/components/ui/page-shell'
import { SkeletonForm, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** El alta: una columna de formulario (la plantilla de formulario del kit). */
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando el formulario…" />
      <SkeletonPageHeader context />
      <SkeletonForm fields={8} />
    </PageShell>
  )
}
