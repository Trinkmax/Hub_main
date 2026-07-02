import type { ReactNode } from 'react'
import { requireTenantAccess } from '@/lib/tenant'
import { MensajeriaNav } from './_components/mensajeria-nav'

export default async function MensajeriaLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { role } = await requireTenantAccess(tenantSlug)

  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:flex lg:py-8">
      <aside className="hidden shrink-0 lg:block">
        <div className="sticky top-20">
          <MensajeriaNav tenantSlug={tenantSlug} role={role} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
