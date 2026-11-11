import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TICKET_SALES_ROLES } from '@/lib/tenant/roles'
import { listCapacityFunctions } from '@/lib/ticketing/queries'
import { SalesTabs } from '../_components/sales-tabs'
import { CapacityList, type CapacityResult } from './_components/capacity-list'

export const metadata = { title: 'Funciones y cupos' }

// Los lugares cambian con cada venta y cada reserva: nada que prerenderizar.
export const dynamic = 'force-dynamic'

/**
 * Las funciones que vienen, con cuántos entran y cómo van. Pedido de los socios del
 * 11/11/2026: el cupo del cine es 54, pero a veces van a 100 y a veces a menos, y lo tiene que
 * poder cambiar Luz. Entran el dueño y la anfitriona, igual que a las ventas.
 */
export default async function FuncionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ pelicula?: string | string[] }>
}) {
  const { tenantSlug } = await params
  const { pelicula } = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, TICKET_SALES_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const result: CapacityResult = await listCapacityFunctions(access.tenant.id).then(
    (functions): CapacityResult => ({ ok: true, functions }),
    (): CapacityResult => ({ ok: false }),
  )

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Entradas"
        title="Ventas online"
        description="Cuántas personas entran en cada función. Si cambiás un cupo, la cartelera se actualiza sola, y lo que queda se recalcula con cada venta y con cada reserva que se carga a mano."
      />
      <SalesTabs tenantSlug={tenantSlug} active="funciones" />
      <CapacityList
        tenantSlug={tenantSlug}
        result={result}
        film={typeof pelicula === 'string' ? pelicula : null}
      />
    </PageShell>
  )
}
