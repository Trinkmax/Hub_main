import { PageShell } from '@/components/ui/page-shell'
import { SkeletonForm, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** Programar un evento: una columna de formulario. */
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando el formulario…" />
      <SkeletonPageHeader context />
      <SkeletonForm fields={6} />
    </PageShell>
  )
}
