'use client'

import { Eye, Plus, QrCode, Tag, UtensilsCrossed } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { listItemTags } from '@/lib/item-tags/queries'
import type { listMenu } from '@/lib/menu/queries'
import type { TenantRole } from '@/lib/tenant/types'
import { CartaTourButton } from './carta-tour'
import { MenuBoard } from './menu-board'
import { NewCategoryForm } from './new-category-form'
import { TagsManagerDialog } from './tags-manager-dialog'

export type MenuHubProps = {
  tenantSlug: string
  tenantId: string
  role: TenantRole
  menu: Awaited<ReturnType<typeof listMenu>>
  tags: Awaited<ReturnType<typeof listItemTags>>
}

export function MenuHub(props: MenuHubProps): React.JSX.Element {
  const { tenantSlug, tenantId, role, menu, tags } = props

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* CABECERA — título a la izquierda y TODAS las acciones a la derecha, en una
          sola fila. Al sacar el toggle Carta/Club ya no hace falta una toolbar aparte. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Catálogo
          </p>
          <h1 className="mt-0.5 font-serif text-3xl font-semibold tracking-tight">Carta</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {`${menu.categories.length} categoría${menu.categories.length === 1 ? '' : 's'} · ${menu.items.length} ítem${menu.items.length === 1 ? '' : 's'}. Cargá y ordená lo que vendés.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <CartaTourButton role={role} />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link
              href={`/carta/${tenantSlug}`}
              target="_blank"
              rel="noopener"
              data-tour="menu-ver-carta"
            >
              <Eye className="size-4" />
              Ver carta
            </Link>
          </Button>
          <TagsManagerDialog
            tenantSlug={tenantSlug}
            tags={tags}
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5" data-tour="menu-etiquetas">
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
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/print/carta/${tenantSlug}`} target="_blank" rel="noopener">
              <QrCode className="size-4" />
              QR de la carta
            </Link>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" className="gap-1.5" data-tour="menu-nueva-categoria">
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
              <NewCategoryForm tenantId={tenantId} tenantSlug={tenantSlug} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {menu.categories.length === 0 ? (
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
                <NewCategoryForm tenantId={tenantId} tenantSlug={tenantSlug} />
              </PopoverContent>
            </Popover>
          }
        />
      ) : (
        <MenuBoard
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          categories={menu.categories}
          items={menu.items}
          tags={tags}
        />
      )}
    </div>
  )
}
