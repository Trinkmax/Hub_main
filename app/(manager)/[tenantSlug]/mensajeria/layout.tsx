import { notFound } from 'next/navigation'
import { type ReactNode, Suspense } from 'react'
import { getUnreadTotal } from '@/lib/bandeja/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { WaBottomTabs } from './_components/wa-bottom-tabs'
import { WaRail } from './_components/wa-rail'

export default async function MensajeriaLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    // Unión de los roles que usa alguna page del árbol (inbox llega a waiter).
    // Cada page conserva su gate fino; esto solo corta a editor/host un nivel antes.
    requireRole(access.role, ['owner', 'cashier', 'waiter'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const unreadTotal = await getUnreadTotal(access.tenant.id)

  return (
    // En la tablet la barra del panel flota abajo (--dock-space); en el celular, la de Mensajería
    // (`data-wa-scroll` deja lugar para ella, ver components/shell/dock/dock.css).
    <div className="wa flex h-[calc(100dvh-3.5rem-var(--dock-space,0px))] w-full overflow-hidden bg-(--wa-app)">
      <WaRail tenantSlug={tenantSlug} role={access.role} unreadTotal={unreadTotal} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-wa-scroll=""
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background"
        >
          {children}
        </div>
        {/* Celular: las secciones van abajo, como WhatsApp en el teléfono */}
        <Suspense fallback={null}>
          <WaBottomTabs tenantSlug={tenantSlug} role={access.role} unreadTotal={unreadTotal} />
        </Suspense>
      </div>
    </div>
  )
}
