import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PayScreen } from '@/components/pos/pay/pay-screen'
import { AccountSheet } from '@/components/shell/salon/account-sheet'
import { signOutAction } from '@/components/shell/sign-out-action'
import { requireFeature } from '@/lib/platform/guards'
import { requestBill } from '@/lib/pos/actions'
import {
  addDiscount,
  closeTable,
  pay,
  refreshBill,
  removeDiscount,
  requestVoid,
  voidPayment,
} from '@/lib/pos/cash/actions'
import { getBill } from '@/lib/pos/cash/queries'
import { POS_CASH_ROLES, POS_CHARGE_ROLES } from '@/lib/pos/cash/roles'
import { posFont } from '@/lib/pos/font'
import { listBranches } from '@/lib/pos/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Cuenta' }

/**
 * La cuenta de una mesa: lo que falta cobrar, la cuenta de papel y el talón para cobrarla.
 * Se llega desde la comanda (el botón «Cuenta», que además avisa en el mapa que la pidieron) y la
 * flecha vuelve a la comanda.
 */
export default async function PosBillPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; sessionId: string }>
}) {
  const { tenantSlug, sessionId } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_CHARGE_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')
  if (!z.uuid().safeParse(sessionId).success) notFound()

  // La RPC chequea el rol contra el bar DE LA MESA. Que además sea una mesa de ESTE bar (el de la
  // URL) se confirma con sus sucursales: quien trabaja en dos bares no ve una mesa del otro acá.
  const [bill, branches] = await Promise.all([getBill(sessionId), listBranches(access.tenant.id)])
  if (!bill.ok) {
    if (bill.error.code === 'session_not_found' || bill.error.code === 'forbidden') notFound()
    throw new Error(`pos_bill: ${bill.error.code}`)
  }
  const branch = branches.find((item) => item.id === bill.data.session.branch_id)
  if (!branch) notFound()

  return (
    <div className={cn('pos', posFont.variable)}>
      <PayScreen
        slug={tenantSlug}
        initial={bill.data}
        timeZone={access.tenant.timezone || 'America/Argentina/Cordoba'}
        // El membrete de la cuenta: el bar y, si tiene más de una sucursal, cuál.
        place={branches.length > 1 ? `${access.tenant.name} · ${branch.name}` : access.tenant.name}
        branchSlug={branch.slug}
        // El mismo criterio con el que la pantalla de Caja deja entrar a abrir el turno.
        canOpenShift={POS_CASH_ROLES.includes(access.role)}
        actions={{
          refresh: refreshBill.bind(null, tenantSlug, sessionId),
          pay: pay.bind(null, tenantSlug),
          closeTable: closeTable.bind(null, tenantSlug, sessionId),
          voidPayment: voidPayment.bind(null, tenantSlug),
          addDiscount: addDiscount.bind(null, tenantSlug),
          removeDiscount: removeDiscount.bind(null, tenantSlug),
          requestVoid: requestVoid.bind(null, tenantSlug),
          unrequestBill: requestBill.bind(null, tenantSlug, sessionId, false),
        }}
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
