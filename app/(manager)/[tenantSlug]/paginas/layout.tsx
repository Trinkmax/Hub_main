import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Marketing › Páginas, con las pestañas de Marketing arriba. El editor de cada página no las
 * lleva (ver components/shell/section-tabs-config.ts).
 */
export default async function PaginasLayout({
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
