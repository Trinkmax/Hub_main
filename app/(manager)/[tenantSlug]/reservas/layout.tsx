import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Reservas › Reservas: la lista, con las pestañas de Reservas arriba (Operativo, Calendario, Ventas
 * online). El alta y la ficha no las llevan: la pestaña es exacta (section-tabs-config.ts).
 */
export default async function ReservasLayout({
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
