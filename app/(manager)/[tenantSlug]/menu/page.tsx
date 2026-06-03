import { Eye, Plus, Tag, UtensilsCrossed } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { listItemTags } from '@/lib/item-tags/queries'
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
import { TagsManagerDialog } from './_components/tags-manager-dialog'

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

  const [{ categories, items }, tables, tags] = await Promise.all([
    listMenu({ tenantId: access.tenant.id }),
    listPhysicalTables(access.tenant.id),
    listItemTags(access.tenant.id),
  ])
  const totalItems = items.length
  const featuredCount = items.filter((i) => i.featured).length
  const previewTable = tables.find((t) => t.active) ?? tables[0]

  // Texto dinámico — guía al dueño hacia el siguiente paso.
  const headerDescription =
    categories.length === 0
      ? 'Armá tu primera categoría y empezá a cargar lo que vendés.'
      : `${categories.length} categoría${categories.length === 1 ? '' : 's'} · ${totalItems} ítem${
          totalItems === 1 ? '' : 's'
        }${featuredCount > 0 ? ` · ${featuredCount} destacado${featuredCount === 1 ? '' : 's'}` : ''}.`

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Catálogo"
        title="Menú"
        description={headerDescription}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {previewTable ? (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href={`/m/${previewTable.qr_token}`} target="_blank" rel="noopener">
                  <Eye className="size-4" />
                  Vista cliente
                </Link>
              </Button>
            ) : null}
            <TagsManagerDialog
              tenantSlug={tenantSlug}
              tags={tags}
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Tag className="size-4" />
                  Gestionar etiquetas
                  {tags.length > 0 ? (
                    <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-medium tabular-nums text-secondary-foreground">
                      {tags.length}
                    </span>
                  ) : null}
                </Button>
              }
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="size-4" />
                  Nueva categoría
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3" sideOffset={6}>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Nueva categoría
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Por ejemplo: Tragos, Comida, Postres.
                </p>
                <NewCategoryForm tenantId={access.tenant.id} tenantSlug={tenantSlug} />
              </PopoverContent>
            </Popover>
          </div>
        }
      />

      {categories.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="Empezá creando una categoría"
          description="Las categorías agrupan tus ítems en la carta. Después agregás lo que vendés en cada una."
          action={
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="size-4" />
                  Crear primera categoría
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-80 p-3" sideOffset={6}>
                <p className="mb-3 text-xs text-muted-foreground">
                  Por ejemplo: Tragos, Comida, Postres.
                </p>
                <NewCategoryForm tenantId={access.tenant.id} tenantSlug={tenantSlug} />
              </PopoverContent>
            </Popover>
          }
        />
      ) : (
        <MenuBoard
          tenantSlug={tenantSlug}
          tenantId={access.tenant.id}
          categories={categories}
          items={items}
          tags={tags}
        />
      )}
    </div>
  )
}
