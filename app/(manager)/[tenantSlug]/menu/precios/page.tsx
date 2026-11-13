import { notFound } from 'next/navigation'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { getPriceSnapshot } from '@/lib/menu/prices/queries'
import type { PriceSnapshot } from '@/lib/menu/prices/types'
import {
  MENU_EDIT_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { PriceBoard } from './_components/price-board'

export const metadata = { title: 'Precios' }

/**
 * «Precios»: buscar un producto y cambiarle el precio, o subir toda la carta un porcentaje.
 * Es de quien edita la carta (dueño y contenido). Lee todo de una vez; lo demás (buscar,
 * cambiar de sucursal, la vista previa de un aumento) pasa en el navegador, sin esperar.
 */
export default async function PreciosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const { sucursal } = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, MENU_EDIT_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }

  let snapshot: PriceSnapshot
  try {
    snapshot = await getPriceSnapshot(access.tenant.id)
  } catch {
    // La lectura ya dejó el detalle en el log del servidor. La pantalla conserva su lugar.
    return (
      <AdmPage className="max-w-4xl">
        <AdmHeader back={{ href: `/${tenantSlug}/menu`, label: 'Carta' }} title="Precios" />
        <PanelError
          title="No pudimos leer los precios"
          message="La carta no llegó a cargarse. Tus precios están como estaban: no se cambió nada. Reintentá en un momento."
        />
      </AdmPage>
    )
  }

  return (
    <PriceBoard
      tenantSlug={tenantSlug}
      snapshot={snapshot}
      initialBranchSlug={typeof sucursal === 'string' ? sucursal : null}
    />
  )
}
