import { Eye, UtensilsCrossed } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { listMenu } from '@/lib/menu/queries'
import { listPhysicalTables } from '@/lib/tables/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { MenuBoard } from './_components/menu-board'
import { NewCategoryForm } from './_components/new-category-form'

export const metadata = { title: 'Menú' }

export default async function MenuPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [{ categories, items }, tables] = await Promise.all([
    listMenu({ tenantId: access.tenant.id }),
    listPhysicalTables(access.tenant.id),
  ])
  const totalItems = items.length
  const previewTable = tables.find((t) => t.active) ?? tables[0]

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Catálogo"
        title="Menú"
        description={`${categories.length} categoría${categories.length === 1 ? '' : 's'} · ${totalItems} ítem${totalItems === 1 ? '' : 's'}. Arrastrá para reordenar.`}
        actions={
          previewTable ? (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href={`/m/${previewTable.qr_token}`} target="_blank" rel="noopener">
                <Eye className="size-4" />
                Vista cliente
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="card-hairline rounded-xl border bg-card p-5">
        <h2 className="font-display text-sm font-semibold tracking-tight">Nueva categoría</h2>
        <p className="text-xs text-muted-foreground">
          Las categorías agrupan ítems en el wizard de cierre de mesa.
        </p>
        <div className="mt-4">
          <NewCategoryForm tenantSlug={tenantSlug} />
        </div>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="Empezá creando una categoría"
          description="Por ejemplo: Tragos, Comida, Postres. Después agregás los ítems en cada una."
        />
      ) : (
        <MenuBoard
          tenantSlug={tenantSlug}
          tenantId={access.tenant.id}
          categories={categories}
          items={items}
        />
      )}
    </div>
  )
}
