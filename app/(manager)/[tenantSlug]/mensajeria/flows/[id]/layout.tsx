import type { ReactNode } from 'react'
import { FlowTabs } from '../_components/flow-tabs'

// Una automatización tiene dos caras: cómo está armada (Creador) y qué hizo
// realmente (Registros). El layout sostiene la barra que las une; el título y
// el "volver" siguen en cada página porque el editor necesita su propio alto.

export default async function FlowLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  return (
    <div className="flex min-h-0 flex-col">
      <FlowTabs tenantSlug={tenantSlug} flowId={id} />
      {children}
    </div>
  )
}
