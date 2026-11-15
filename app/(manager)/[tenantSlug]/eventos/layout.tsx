import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Reservas › Calendario: los eventos del mes y sus formatos, con las pestañas de Reservas arriba.
 */
export default async function EventosLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <SectionTabsLayout section="reservas" tenantSlug={tenantSlug}>
      {children}
    </SectionTabsLayout>
  )
}
