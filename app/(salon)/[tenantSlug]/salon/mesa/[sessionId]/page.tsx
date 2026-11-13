import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { OrderScreen } from '@/components/pos/order/order-screen'
import { AccountSheet } from '@/components/shell/salon/account-sheet'
import { signOutAction } from '@/components/shell/sign-out-action'
import { requireFeature } from '@/lib/platform/guards'
import { posFont } from '@/lib/pos/font'
import { getPosMenu, getSessionDetail, listBranches } from '@/lib/pos/queries'
import {
  POS_VIEW_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Mesa' }

/**
 * La comanda de una mesa abierta: lo que pidió, en tandas, y la carta para seguir cargando.
 * `?nueva=1` llega desde el mapa al abrir una mesa: entra derecho a cargar.
 */
export default async function PosOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; sessionId: string }>
  searchParams: Promise<{ nueva?: string }>
}) {
  const [{ tenantSlug, sessionId }, { nueva }] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_VIEW_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')
  if (!z.uuid().safeParse(sessionId).success) notFound()

  // La RPC chequea el rol contra el bar DE LA MESA. Que además sea una mesa de ESTE bar (el de la
  // URL) se confirma con sus sucursales: quien trabaja en dos bares no ve una mesa del otro acá.
  const [detail, branches] = await Promise.all([
    getSessionDetail(sessionId),
    listBranches(access.tenant.id),
  ])
  if (!detail.ok) {
    if (detail.error.code === 'session_not_found' || detail.error.code === 'forbidden') notFound()
    throw new Error(`pos_session_detail: ${detail.error.code}`)
  }
  const { session, tickets } = detail.data
  if (!branches.some((branch) => branch.id === session.branch_id)) notFound()

  const menu = await getPosMenu(session.branch_id)
  if (!menu.ok) {
    if (menu.error.code === 'forbidden') notFound()
    throw new Error(`pos_menu: ${menu.error.code}`)
  }

  return (
    <div className={cn('pos', posFont.variable)}>
      <OrderScreen
        slug={tenantSlug}
        initial={detail.data}
        initialMenu={menu.data}
        timeZone={access.tenant.timezone || 'America/Argentina/Cordoba'}
        startAdding={session.status === 'open' && (nueva === '1' || tickets.length === 0)}
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
