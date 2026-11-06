import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/** Compras (docs/features/compras.md): Pedidos, Insumos, Recetas y Proveedores, como pestañas. */
export default async function ComprasLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <SectionTabsLayout section="compras" tenantSlug={tenantSlug}>
      {children}
    </SectionTabsLayout>
  )
}
