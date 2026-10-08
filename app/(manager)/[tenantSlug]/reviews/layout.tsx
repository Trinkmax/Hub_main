import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/** Estadísticas › Reseñas, con las pestañas de Estadísticas arriba. */
export default async function ReviewsLayout({
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
