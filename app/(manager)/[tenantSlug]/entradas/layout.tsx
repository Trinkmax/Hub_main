import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Marketing › Entradas, con las pestañas de Marketing arriba. El editor de cada película no las
 * lleva, igual que el de Páginas (ver components/shell/section-tabs-config.ts).
 */
export default async function EntradasLayout({
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
