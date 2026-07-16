import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { MensajeriaNav } from './_components/mensajeria-nav'

export default async function MensajeriaLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let role: Awaited<ReturnType<typeof requireTenantAccess>>['role']
  try {
    const access = await requireTenantAccess(tenantSlug)
    // Unión de los roles que usa alguna page del árbol (inbox llega a waiter).
    // Cada page conserva su gate fino; esto solo corta a editor/host un nivel antes.
    requireRole(access.role, ['owner', 'cashier', 'waiter'])
    role = access.role
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

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
