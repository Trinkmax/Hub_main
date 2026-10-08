import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/** Marketing › Link de Instagram, con las pestañas de Marketing arriba. */
export default async function EnlacesLayout({
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
