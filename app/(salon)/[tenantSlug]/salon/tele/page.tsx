import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { KitchenLive } from '@/components/pos/kitchen/kitchen-live'
import { BranchChooser } from '@/components/pos/ui/branch-chooser'
import { requireFeature } from '@/lib/platform/guards'
import { posFont } from '@/lib/pos/font'
import { parseStationParam } from '@/lib/pos/kitchen/stations'
import { getActiveBranch, getKitchenQueue } from '@/lib/pos/queries'
import {
  POS_KITCHEN_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Cocina' }

// La pantalla es oscura de punta a punta: que la barra del celular no quede crema arriba de un riel negro.
export const viewport: Viewport = { themeColor: '#0b1410' }

/**
 * La tele de la cocina: el riel de comandas (docs/features/pos.md).
 *
 *   `?sucursal=<slug>`      entra directo a una sucursal; si no, la que eligió este dispositivo.
 *   `?estaciones=<id,id>`   qué estaciones muestra esta pantalla; vacío = todas. Una segunda tele en la
 *                           barra se arma copiando la dirección con solo Barra elegida.
 */
export default async function KitchenTvPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ sucursal?: string | string[]; estaciones?: string | string[] }>
}) {
  const [{ tenantSlug }, { sucursal, estaciones }] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_KITCHEN_ROLES)
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

  // Una tele es de una sucursal: la primera vez se elige, y después nunca pregunta.
  if (!chosen) {
    return (
      <div className={cn('pos', posFont.variable)}>
        <BranchChooser
          fill="screen"
          slug={tenantSlug}
          branches={branches.map(({ id, name, color, address }) => ({ id, name, color, address }))}
        />
      </div>
    )
  }

  const queue = await getKitchenQueue(active.id)
  if (!queue.ok) {
    if (queue.error.code === 'forbidden') notFound()
    throw new Error(`pos_kitchen_queue: ${queue.error.code}`)
  }

  return (
    <div className={cn('pos', posFont.variable)}>
      <KitchenLive
        slug={tenantSlug}
        initial={queue.data}
        timeZone={access.tenant.timezone || 'America/Argentina/Cordoba'}
        stationParam={parseStationParam(estaciones)}
        isKitchen={access.role === 'kitchen'}
      />
    </div>
  )
}
