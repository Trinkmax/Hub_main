import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CashLive } from '@/components/pos/cash/cash-live'
import { BranchChooser } from '@/components/pos/ui/branch-chooser'
import { AccountSheet } from '@/components/shell/salon/account-sheet'
import { signOutAction } from '@/components/shell/sign-out-action'
import { requireFeature } from '@/lib/platform/guards'
import { getShiftSnapshot, listShifts } from '@/lib/pos/cash/queries'
import { POS_CASH_ROLES } from '@/lib/pos/cash/roles'
import { serviceDayAt } from '@/lib/pos/cash/screen'
import { posFont } from '@/lib/pos/font'
import { getActiveBranch } from '@/lib/pos/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Caja' }

/** Cuántos turnos para atrás se le ofrecen a un dueño (unas seis semanas con dos turnos por día). */
const HISTORY_SHIFTS = 90

/**
 * La caja por turno de una sucursal (docs/features/pos.md): abrir confirmando lo que dejó el turno
 * anterior, la cinta que se escribe sola con cada cobro, sacar y guardar plata, y cerrar contando
 * los billetes.
 * `?sucursal=<slug>` entra directo a una sucursal; si no, la que eligió este dispositivo.
 */
export default async function PosCashPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ sucursal?: string | string[] }>
}) {
  const [{ tenantSlug }, { sucursal }] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_CASH_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')

  const { branches, active, chosen } = await getActiveBranch(
    access.tenant.id,
    Array.isArray(sucursal) ? sucursal[0] : sucursal,
  )
  if (!active) notFound()

  // Más de una sucursal y este dispositivo nunca eligió: se pregunta una vez. La caja es de una sucursal.
  if (!chosen) {
    return (
      <div className={cn('pos', posFont.variable)}>
        <BranchChooser
          slug={tenantSlug}
          branches={branches.map(({ id, name, color, address }) => ({ id, name, color, address }))}
        />
      </div>
    )
  }

  const [snapshot, shifts] = await Promise.all([
    getShiftSnapshot(active.id),
    listShifts(active.id, { limit: HISTORY_SHIFTS }),
  ])
  if (!snapshot.ok) {
    if (snapshot.error.code === 'forbidden') notFound()
    throw new Error(`pos_shift_snapshot: ${snapshot.error.code}`)
  }

  const timeZone = access.tenant.timezone || 'America/Argentina/Cordoba'
  // Quien está en la caja ve los turnos de hoy; los dueños, los de cualquier fecha. El rol es el
  // que devolvió la base para esta sucursal.
  const today = serviceDayAt(snapshot.data.now, timeZone)
  const visibleShifts =
    snapshot.data.role === 'owner' ? shifts : shifts.filter((shift) => shift.service_day === today)
  const toBranch = ({
    id,
    name,
    short_name,
    slug,
    color,
    is_default,
  }: (typeof branches)[number]) => ({
    id,
    name,
    short_name,
    slug,
    color,
    is_default,
  })

  return (
    <div className={cn('pos', posFont.variable)}>
      <CashLive
        slug={tenantSlug}
        initial={snapshot.data}
        branch={toBranch(active)}
        branches={branches.map(toBranch)}
        shifts={visibleShifts}
        timeZone={timeZone}
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
