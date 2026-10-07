'use client'

import { Eye, Plus, QrCode, Tag, UtensilsCrossed } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** «Nueva categoría» en un popover chico: nombre, foto opcional y listo. */
function NewCategoryPopover({
  tenantId,
  tenantSlug,
  trigger,
  align = 'end',
}: {
  tenantId: string
  tenantSlug: string
  trigger: React.ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="flex w-80 flex-col gap-3">
        <PopoverHeader>
          <PopoverTitle>Nueva categoría</PopoverTitle>
          <PopoverDescription>Por ejemplo: Tragos, Comida, Postres.</PopoverDescription>
        </PopoverHeader>
        <NewCategoryForm tenantId={tenantId} tenantSlug={tenantSlug} />
      </PopoverContent>
    </Popover>
  )
}

export function MenuHub(props: MenuHubProps): React.JSX.Element {
  const { tenantSlug, tenantId, role, menu, tags } = props

  return (
    <PageShell width="comfortable">
      {/* Título a la izquierda y TODAS las acciones a la derecha, en una sola
          fila (la principal, «Nueva categoría», última). */}
      <PageHeader
        title="Carta"
        description={`${plural(menu.categories.length, 'categoría', 'categorías')} · ${plural(
          menu.items.length,
          'ítem',
          'ítems',
        )}. Cargá y ordená lo que vendés.`}
        actions={
          <>
            <CartaTourButton role={role} />
            <Button asChild variant="secondary">
              <Link
                href={`/carta/${tenantSlug}`}
                target="_blank"
                rel="noopener"
                data-tour="menu-ver-carta"
              >
                <Eye aria-hidden="true" />
                Ver carta
              </Link>
            </Button>
            <TagsManagerDialog
              tenantSlug={tenantSlug}
              tags={tags}
              trigger={
                <Button variant="secondary" data-tour="menu-etiquetas">
                  <Tag aria-hidden="true" />
                  Gestionar etiquetas
                  {tags.length > 0 ? (
                    <span className="type-caption type-amount text-muted-foreground">
                      {tags.length}
                    </span>
                  ) : null}
                </Button>
              }
            />
            <Button asChild variant="secondary">
              <Link href={`/print/carta/${tenantSlug}`} target="_blank" rel="noopener">
                <QrCode aria-hidden="true" />
                QR de la carta
              </Link>
            </Button>
            <NewCategoryPopover
              tenantId={tenantId}
              tenantSlug={tenantSlug}
              trigger={
                <Button data-tour="menu-nueva-categoria">
                  <Plus aria-hidden="true" />
                  Nueva categoría
                </Button>
              }
            />
          </>
        }
      />

      {menu.categories.length === 0 ? (
        <EmptyState
          size="lg"
          icon={UtensilsCrossed}
          title="Empezá creando una categoría"
          description="Las categorías agrupan los ítems de la carta (Tragos, Comida, Postres). Después cargás lo que vendés en cada una."
          action={
            <NewCategoryPopover
              tenantId={tenantId}
              tenantSlug={tenantSlug}
              align="center"
              trigger={
                <Button>
                  <Plus aria-hidden="true" />
                  Crear la primera categoría
                </Button>
              }
            />
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
    </PageShell>
  )
}
