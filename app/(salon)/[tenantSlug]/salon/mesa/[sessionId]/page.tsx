import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { OrderScreen } from '@/components/pos/order/order-screen'
import { TakenTable } from '@/components/pos/order/taken-table'
import { PosViewerProvider } from '@/components/pos/ui/pos-viewer'
import { AccountSheet } from '@/components/shell/salon/account-sheet'
import { signOutAction } from '@/components/shell/sign-out-action'
import { requireFeature } from '@/lib/platform/guards'
import { isLockedFor, tableOwner } from '@/lib/pos/floor/waiter'
import { posFont } from '@/lib/pos/font'
import { getPosMenu, getSessionDetail, listBranches } from '@/lib/pos/queries'
import {
  POS_FLOOR_ROLES,
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

  // A un mozo, la mesa que atiende otro no se le abre (en el mapa ya la ve tomada).
  if (
    session.status === 'open' &&
    isLockedFor(access.role, tableOwner(session.waiter_id, access.user.id))
  ) {
    return (
      <div className={cn('pos', posFont.variable)}>
        <TakenTable
          slug={tenantSlug}
          label={detail.data.table?.label ?? null}
          waiter={session.waiter ?? null}
        />
      </div>
    )
  }

  const menu = await getPosMenu(session.branch_id)
  if (!menu.ok) {
    if (menu.error.code === 'forbidden') notFound()
    throw new Error(`pos_menu: ${menu.error.code}`)
  }

  return (
    <div className={cn('pos', posFont.variable)}>
      <PosViewerProvider userId={access.user.id}>
        <OrderScreen
          slug={tenantSlug}
          initial={detail.data}
          initialMenu={menu.data}
          timeZone={access.tenant.timezone || 'America/Argentina/Cordoba'}
          startAdding={session.status === 'open' && (nueva === '1' || tickets.length === 0)}
          branchSlug={branches.find((branch) => branch.id === session.branch_id)?.slug ?? null}
          account={
            <AccountSheet
              email={access.user.email ?? ''}
              role={access.role}
              tenantName={access.tenant.name}
              tenantSlug={tenantSlug}
              signOut={signOutAction}
              posNotices={POS_FLOOR_ROLES.includes(access.role)}
            />
          }
        />
      </PosViewerProvider>
    </div>
  )
}
