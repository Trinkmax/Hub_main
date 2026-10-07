import { PageShell } from '@/components/ui/page-shell'
import { SkeletonPageHeader, SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'

/** Mismo armado que la página: encabezado con «Nueva página» y la tabla de páginas. */
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={1} />
      <SkeletonTable rows={4} columns={5} />
    </PageShell>
  )
}
