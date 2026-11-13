import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FloorLive } from '@/components/pos/floor/floor-live'
import { AccountSheet } from '@/components/shell/salon/account-sheet'
import { signOutAction } from '@/components/shell/sign-out-action'
import { requireFeature } from '@/lib/platform/guards'
import { posFont } from '@/lib/pos/font'
import { getActiveBranch, getFloorSnapshot } from '@/lib/pos/queries'
import {
  POS_VIEW_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Salón' }

/**
 * El salón en vivo: la pantalla de inicio del punto de venta.
 * `?sucursal=<slug>` entra directo a una sucursal (links, tele); si no, la que eligió este dispositivo.
 */
export default async function PosFloorPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ sucursal?: string }>
}) {
  const [{ tenantSlug }, { sucursal }] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_VIEW_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')

  const { branches, active } = await getActiveBranch(access.tenant.id, sucursal)
  if (!active) notFound()

  const snapshot = await getFloorSnapshot(active.id)
  if (!snapshot.ok) {
    if (snapshot.error.code === 'forbidden') notFound()
    throw new Error(`pos_floor_snapshot: ${snapshot.error.code}`)
  }

  return (
    <div className={cn('pos', posFont.variable)}>
      <FloorLive
        slug={tenantSlug}
        initial={snapshot.data}
        branches={branches}
        timeZone={access.tenant.timezone || 'America/Argentina/Cordoba'}
        canEditPlan={access.role === 'owner'}
        account={
          <AccountSheet
            email={access.user.email ?? ''}
            role={access.role}
            tenantName={access.tenant.name}
            tenantSlug={tenantSlug}
            signOut={signOutAction}
          />
        }
      />
    </div>
  )
}
