import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/** Clientes › Acreditar, con las pestañas de Clientes arriba. */
export default async function AcreditarLayout({
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
