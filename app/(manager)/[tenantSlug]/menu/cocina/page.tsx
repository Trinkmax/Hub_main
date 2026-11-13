import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { getKitchenSnapshot } from '@/lib/menu/kitchen/queries'
import type { KitchenSnapshot } from '@/lib/menu/kitchen/types'
import { requireFeature } from '@/lib/platform/guards'
import {
  MENU_EDIT_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { KitchenBoard } from './_components/kitchen-board'

export const metadata: Metadata = { title: 'Cocina y aclaraciones' }

/**
 * «Cocina y aclaraciones» (docs/features/pos.md): a qué estación de la cocina va cada cosa de la
 * carta y qué aclaraciones se le pueden tocar a cada producto. Es de quien edita la carta, y viene
 * con el punto de venta. `?ver=aclaraciones` abre las aclaraciones.
 */
export default async function CocinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ ver?: string | string[] }>
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, MENU_EDIT_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')

  let snapshot: KitchenSnapshot
  try {
    snapshot = await getKitchenSnapshot(access.tenant.id)
  } catch {
    // La lectura ya dejó el detalle en el log del servidor. La pantalla conserva su lugar.
    return (
      <AdmPage width="comfortable">
        <AdmHeader
          back={{ href: `/${tenantSlug}/menu`, label: 'Carta' }}
          title="Cocina y aclaraciones"
        />
        <PanelError
          title="No pudimos leer la carta"
          message="No se cambió nada: las estaciones y las aclaraciones están como estaban. Reintentá en un momento."
        />
      </AdmPage>
    )
  }

  return (
    <KitchenBoard
      tenantSlug={tenantSlug}
      snapshot={snapshot}
      tab={query.ver === 'aclaraciones' ? 'aclaraciones' : 'estaciones'}
    />
  )
}
