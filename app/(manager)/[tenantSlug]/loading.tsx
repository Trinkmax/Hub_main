import { PageShell } from '@/components/ui/page-shell'
import { SkeletonKPIGroup, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/**
 * Carga del workspace (kit §4.7): el Resumen y toda pantalla sin `loading.tsx`
 * propio. Encabezado + fila de KPIs con los altos finales, así nada salta al
 * llegar la página. Sin `<main>` propio: lo pone el shell.
 */
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={1} />
      <SkeletonKPIGroup count={4} />
    </PageShell>
  )
}
