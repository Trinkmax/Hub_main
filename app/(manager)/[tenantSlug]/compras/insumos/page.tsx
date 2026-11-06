import { notFound } from 'next/navigation'
import { ItemsManager } from '@/components/purchasing/catalog/items-manager'
import { PageShell } from '@/components/ui/page-shell'
import { isFeatureEnabled } from '@/lib/platform/features'
import { getCatalog } from '@/lib/purchasing/queries'
import type { PurRecipe } from '@/lib/purchasing/types'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Insumos · Compras' }

// Lo que se edita acá lo usa la cocina al rato: nunca una versión cacheada.
export const dynamic = 'force-dynamic'

/**
 * Compras › Insumos (docs/features/compras.md): la lista maestra que antes vivía en la planilla.
 * Contrato de URL (otras pantallas linkean acá): `?editar=<id>` abre la ficha de ese insumo,
 * `?nuevo=1` una vacía y `?zonas=1` las zonas del recorrido.
 */
export default async function InsumosPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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
    <PageShell>
      <ItemsManager
        tenantSlug={tenantSlug}
        items={catalog.items}
        zones={catalog.zones}
        suppliers={catalog.suppliers}
        usedIn={recipesByItem(catalog.recipes)}
      />
    </PageShell>
  )
}

/** Por insumo, las recetas activas que lo llevan: «Noche de Ramen · Cerdo». */
function recipesByItem(recipes: readonly PurRecipe[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const recipe of recipes) {
    if (!recipe.active) continue
    const title =
      recipe.variant && recipe.variant !== 'Única'
        ? `${recipe.name} · ${recipe.variant}`
        : recipe.name
    for (const line of recipe.lines) {
      if (!line.itemId || line.inHouse) continue
      const list = out[line.itemId] ?? []
      if (!list.includes(title)) list.push(title)
      out[line.itemId] = list
    }
  }
  return out
}
