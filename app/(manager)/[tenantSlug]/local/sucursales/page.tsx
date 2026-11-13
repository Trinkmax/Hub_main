import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { getAppUrl } from '@/lib/app-url'
import { requireFeature } from '@/lib/platform/guards'
import { POS_SETUP_ROLES } from '@/lib/pos/branches/authorize'
import { kitchenScreenUrl } from '@/lib/pos/branches/links'
import { getBranchBoard } from '@/lib/pos/branches/queries'
import type { BranchBoardSnapshot } from '@/lib/pos/branches/types'
import { renderQrSvg } from '@/lib/qr'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { SucursalesBoard } from './_components/sucursales-board'

export const metadata: Metadata = { title: 'Sucursales' }

/**
 * «Sucursales» (docs/features/pos.md): los locales del bar, lo que le falta a cada uno para
 * abrir y los ajustes del punto de venta. Es del dueño, y viene con el punto de venta.
 *
 * `?sucursal=<slug>` elige la sucursal; `?ver=ajustes` muestra los ajustes, que valen para
 * todo el bar. Lee todo de una vez (`getBranchBoard`).
 */
export default async function SucursalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ sucursal?: string | string[]; ver?: string | string[] }>
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_SETUP_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')

  let snapshot: BranchBoardSnapshot
  try {
    snapshot = await getBranchBoard(access.tenant.id)
  } catch {
    // La lectura ya dejó el detalle en el log del servidor. La pantalla conserva su lugar.
    return (
      <AdmPage width="comfortable">
        <AdmHeader title="Sucursales" />
        <PanelError
          title="No pudimos leer las sucursales"
          message="No se cambió nada: tus sucursales están como estaban. Reintentá en un momento."
        />
      </AdmPage>
    )
  }

  // El link de la pantalla de cocina de cada sucursal, con su QR para escanearlo desde la tele.
  const origin = await getAppUrl()
  const tele: Record<string, { url: string; qr: string | null }> = {}
  await Promise.all(
    snapshot.branches.map(async (branch) => {
      const url = kitchenScreenUrl(origin, tenantSlug, branch.slug)
      let qr: string | null = null
      try {
        qr = await renderQrSvg(url)
      } catch {
        // Sin QR queda el link para copiar.
      }
      tele[branch.id] = { url, qr }
    }),
  )

  return (
    <SucursalesBoard
      tenantSlug={tenantSlug}
      snapshot={snapshot}
      selectedSlug={typeof query.sucursal === 'string' ? query.sucursal : null}
      view={query.ver === 'ajustes' ? 'ajustes' : 'sucursales'}
      timeZone={access.tenant.timezone || 'America/Argentina/Cordoba'}
      tele={tele}
    />
  )
}
