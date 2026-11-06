import { notFound } from 'next/navigation'
import type { FormatOption } from '@/components/purchasing/catalog/recipe-sheet'
import { type RecipeSummary, RecipesBoard } from '@/components/purchasing/catalog/recipes-board'
import { PageShell } from '@/components/ui/page-shell'
import { isFeatureEnabled } from '@/lib/platform/features'
import { dataIssues } from '@/lib/purchasing/checks'
import { type Catalog, getCatalog } from '@/lib/purchasing/queries'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Recetas · Compras' }

export const dynamic = 'force-dynamic'

/**
 * Compras › Recetas (docs/features/compras.md): lo que lleva cada formato del calendario para N
 * personas. Contrato de URL: `?nuevo=1` abre «Nueva receta» y `&formato=<templateId>` la arranca
 * con ese formato. La ficha de cada receta es `/compras/recetas/<id>`.
 */
export default async function RecetasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  const [catalog, formats] = await Promise.all([
    getCatalog(access.tenant.id),
    getFormats(access.tenant.id),
  ])

  return (
    <PageShell width="comfortable">
      <RecipesBoard
        tenantSlug={tenantSlug}
        recipes={recipeSummaries(catalog)}
        formats={formats}
        defaultGuests={catalog.settings.recipeBaseGuests}
      />
    </PageShell>
  )
}

/** Los formatos del calendario del bar (activos y no), por nombre. */
async function getFormats(tenantId: string): Promise<FormatOption[]> {
  const db = await createClient()
  const { data, error } = await db
    .from('scheduled_event_templates')
    .select('id, name, active')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) {
    console.error('[compras.recetas] formatos', { code: error.code })
    throw new Error('No se pudieron leer los formatos del calendario.')
  }
  return data
}

/** Cada receta con sus cuentas (sin las líneas: la lista no las necesita). */
function recipeSummaries(catalog: Catalog): RecipeSummary[] {
  const review = new Map<string, number>()
  for (const issue of dataIssues({
    items: catalog.items,
    suppliers: catalog.suppliers,
    recipes: catalog.recipes,
    upcoming: [],
  })) {
    if (issue.target.kind !== 'recipe') continue
    review.set(issue.target.id, (review.get(issue.target.id) ?? 0) + 1)
  }
  return catalog.recipes.map((recipe) => {
    // Una receta vacía (sin insumos ni aviso) se marca aparte («Sin insumos»): no son renglones.
    const empty = recipe.lines.length === 0 && !recipe.notes
    return {
      id: recipe.id,
      templateId: recipe.templateId,
      name: recipe.name,
      variant: recipe.variant,
      baseGuests: recipe.baseGuests,
      notes: recipe.notes,
      active: recipe.active,
      buyLines: recipe.lines.filter((line) => !line.inHouse).length,
      inHouseLines: recipe.lines.filter((line) => line.inHouse).length,
      reviewCount: empty ? 0 : (review.get(recipe.id) ?? 0),
    }
  })
}
