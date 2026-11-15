import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Reservas › Ventas online: las compras de la cartelera, con las pestañas de Reservas arriba.
 */
export default async function VentasOnlineLayout({
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
