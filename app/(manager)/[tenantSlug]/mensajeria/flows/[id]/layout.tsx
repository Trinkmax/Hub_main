import { History, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { TabsNav } from '@/components/ui/tabs-nav'

// Una automatización tiene dos caras: cómo está armada (Creador) y qué hizo
// realmente (Registros). El layout sostiene la barra que las une (`TabsNav`
// del kit: links reales, cada pestaña es una URL y el «atrás» del navegador
// anda); el título y el «volver» siguen en cada página.
//
// El layout ocupa todo el alto del marco de Mensajería: el editor se estira
// (flex-1) debajo de las pestañas y los registros crecen y scrollean como
// cualquier página.

export default async function FlowLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const base = `/${tenantSlug}/mensajeria/flows/${id}`
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabsNav
        aria-label="Secciones de la automatización"
        className="shrink-0 px-4 sm:px-6"
        items={[
          { href: base, label: 'Creador', icon: Workflow, exact: true },
          { href: `${base}/registros`, label: 'Registros de ejecución', icon: History },
        ]}
      />
      {children}
    </div>
  )
}
