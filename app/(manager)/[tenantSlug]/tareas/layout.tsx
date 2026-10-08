import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/** Marketing › Tareas, con las pestañas de Marketing arriba. */
export default async function TareasLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <SectionTabsLayout section="marketing" tenantSlug={tenantSlug}>
      {children}
    </SectionTabsLayout>
  )
}
