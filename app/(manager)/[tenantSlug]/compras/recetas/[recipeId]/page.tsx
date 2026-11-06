import { notFound } from 'next/navigation'
import { RecipeEditor, type SiblingRecipe } from '@/components/purchasing/catalog/recipe-editor'
import type { FormatOption } from '@/components/purchasing/catalog/recipe-sheet'
import { PageShell } from '@/components/ui/page-shell'
import { isFeatureEnabled } from '@/lib/platform/features'
import { getCatalog } from '@/lib/purchasing/queries'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Receta · Compras' }

export const dynamic = 'force-dynamic'

/**
 * Compras › Recetas › una receta: sus datos (formato, variante, personas, aviso) y los insumos para
 * N personas, que se editan en la pantalla y se guardan todos juntos.
 */
export default async function RecetaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; recipeId: string }>
}) {
  const { tenantSlug, recipeId } = await params

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
  const recipe = catalog.recipes.find((r) => r.id === recipeId)
  if (!recipe) notFound()

  const format = recipe.templateId
    ? (formats.find((f) => f.id === recipe.templateId) ?? null)
    : null
  const siblings: SiblingRecipe[] = format
    ? catalog.recipes
        .filter((r) => r.templateId === format.id)
        .map((r) => ({ id: r.id, variant: r.variant, active: r.active }))
        .sort((a, b) => a.variant.localeCompare(b.variant, 'es'))
    : []

  return (
    <PageShell width="comfortable">
      <RecipeEditor
        // Otra receta (saltar entre variantes) arranca con su propio borrador.
        key={recipe.id}
        tenantSlug={tenantSlug}
        recipe={recipe}
        format={format}
        formats={formats}
        items={catalog.items}
        variants={catalog.recipes.map((r) => ({
          id: r.id,
          templateId: r.templateId,
          variant: r.variant,
        }))}
        siblings={siblings}
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
    console.error('[compras.receta] formatos', { code: error.code })
    throw new Error('No se pudieron leer los formatos del calendario.')
  }
  return data
}
