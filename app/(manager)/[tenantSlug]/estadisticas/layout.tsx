import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Estadísticas: Resumen, Cómo nos fue, Señas y Comisiones, con las pestañas de la sección
 * arriba (Reseñas, en /reviews, tiene su propio layout).
 */
export default async function EstadisticasLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <SectionTabsLayout section="estadisticas" tenantSlug={tenantSlug}>
      {children}
    </SectionTabsLayout>
  )
}
