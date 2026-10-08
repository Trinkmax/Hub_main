import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Clientes › Personas: la lista, la ficha, el alta y el canje, con las pestañas de Clientes
 * arriba.
 */
export default async function ClientesLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <SectionTabsLayout section="clientes" tenantSlug={tenantSlug}>
      {children}
    </SectionTabsLayout>
  )
}
