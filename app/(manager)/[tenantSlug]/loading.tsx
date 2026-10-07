import { PageShell } from '@/components/ui/page-shell'
import { SkeletonKPIGroup, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/**
 * Carga del workspace (kit §4.7): el Resumen y toda pantalla sin `loading.tsx`
 * propio (Mensajería, onboarding, club/simular, configuración/bienvenida).
 * Copia el arranque del Resumen con sus altos finales: el saludo arriba del
 * título, las dos acciones y la fila de cuatro KPIs, así nada salta al llegar
 * la página. Lo de abajo (hoy en el salón, gráfico y ranking) no se dibuja: en
 * las otras pantallas sería un esqueleto engañoso. Sin `<main>` propio: lo pone
 * el shell.
 */
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context actions={2} />
      {/* El KPIGroup de 4 va en 2 × 2 hasta xl; el preset pasa a 4 columnas desde md. */}
      <SkeletonKPIGroup count={4} className="md:grid-cols-2 xl:grid-cols-4" />
    </PageShell>
  )
}
