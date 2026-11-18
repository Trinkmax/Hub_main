import type { ReactNode } from 'react'
import { loadSectionViewer } from '@/components/shell/section-tabs-server'
import { FEATURE_KEYS } from '@/lib/platform/features'
import { SettingsNav } from './_components/settings-nav'

export default async function ConfiguracionLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  // Quién mira, para las entradas que dependen de una función del bar (Sucursales, Plano). Es la
  // misma resolución que ya hacen el layout del panel y cada página: no suma un viaje a la base.
  const viewer = await loadSectionViewer(tenantSlug)
  const features = FEATURE_KEYS.filter(
    (key) => viewer !== null && (viewer.isPlatformAdmin || viewer.features[key]),
  )

  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:flex lg:py-8">
      <SettingsNav tenantSlug={tenantSlug} features={features} />

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
