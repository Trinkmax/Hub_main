import type { ReactNode } from 'react'
import { SettingsNav } from './_components/settings-nav'

export default async function ConfiguracionLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:flex lg:py-8">
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-20">
          <SettingsNav tenantSlug={tenantSlug} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
