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
    // Alto: la pantalla menos el topbar del panel (--topbar-h), nunca 56 px a mano.
    // --form-actions-offset: en el celular las pestañas de abajo (WaBottomTabs)
    // miden 3,875 rem + el pelo + el área segura; la barra fija de FormActions
    // arranca arriba de ellas en vez de taparlas. Si cambia el alto de las
    // pestañas, cambia acá.
    <div className="wa flex h-[calc(100dvh-var(--topbar-h))] w-full overflow-hidden bg-(--wa-app) max-md:[--form-actions-offset:calc(3.875rem+1px+env(safe-area-inset-bottom))]">
      <WaRail tenantSlug={tenantSlug} role={access.role} unreadTotal={unreadTotal} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background">
          {children}
        </div>
        {/* Mobile: las secciones van abajo, como WhatsApp en el teléfono */}
        <Suspense fallback={null}>
          <WaBottomTabs tenantSlug={tenantSlug} role={access.role} unreadTotal={unreadTotal} />
        </Suspense>
      </div>
    </div>
  )
}
