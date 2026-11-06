import { notFound } from 'next/navigation'
import type { SupplierView } from '@/components/purchasing/catalog/supplier-editor'
import { SuppliersManager } from '@/components/purchasing/catalog/suppliers-manager'
import { PageShell } from '@/components/ui/page-shell'
import { todayInCordoba } from '@/lib/dates'
import { formatPhoneForDisplay } from '@/lib/phone'
import { isFeatureEnabled } from '@/lib/platform/features'
import { type Catalog, getCatalog } from '@/lib/purchasing/queries'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Proveedores · Compras' }

export const dynamic = 'force-dynamic'

/** Cuántos nombres de insumos se muestran en la ficha del proveedor («y 9 más»). */
const ITEM_NAMES_IN_SHEET = 8

/**
 * Compras › Proveedores (docs/features/compras.md): a quién se le manda cada pedido. Lo que falta
 * (WhatsApp, días de entrega) va arriba. Contrato de URL: `?editar=<id>` abre la ficha de ese
 * proveedor y `?nuevo=1` una vacía.
 */
export default async function ProveedoresPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, PURCHASING_MANAGE_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }
  if (!access.isPlatformAdmin && !isFeatureEnabled(access.tenant, 'purchasing')) notFound()

  const catalog = await getCatalog(access.tenant.id)

  return (
    <PageShell width="comfortable">
      <SuppliersManager
        tenantSlug={tenantSlug}
        today={todayInCordoba()}
        suppliers={supplierViews(catalog)}
      />
    </PageShell>
  )
}

/** Cada proveedor con su WhatsApp para leer y los insumos activos que se le piden. */
function supplierViews(catalog: Catalog): SupplierView[] {
  const names = new Map<string, string[]>()
  for (const item of catalog.items) {
    if (!item.active || !item.supplierId) continue
    const list = names.get(item.supplierId) ?? []
    list.push(item.name)
    names.set(item.supplierId, list)
  }
  return catalog.suppliers.map((supplier) => {
    const items = (names.get(supplier.id) ?? []).sort((a, b) => a.localeCompare(b, 'es'))
    return {
      ...supplier,
      whatsappDisplay: supplier.whatsapp ? formatPhoneForDisplay(`+${supplier.whatsapp}`) : null,
      activeItems: items.length,
      itemNames: items.slice(0, ITEM_NAMES_IN_SHEET),
    }
  })
}
