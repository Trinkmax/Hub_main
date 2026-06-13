'use client'

import type { MenuItem } from '@/lib/menu/queries'
import type { MenuTreeNode } from '@/lib/menu/tree'
import { cn } from '@/lib/utils'
import { ItemCard } from './item-card'

/**
 * Sección de una categoría raíz. Renderiza sus ítems directos y, recursivamente,
 * sus subcategorías como sub-encabezados anidados (sin aplanar el árbol). El
 * nivel de profundidad ajusta el tamaño del título para mantener jerarquía visual.
 */
export function CategorySection({
  node,
  onOpenItem,
  registerRef,
  depth = 0,
}: {
  node: MenuTreeNode
  onOpenItem: (item: MenuItem) => void
  /** Sólo las categorías raíz (depth 0) se registran para el scroll-spy. */
  registerRef?: (id: string, el: HTMLElement | null) => void
  depth?: number
}): React.JSX.Element {
  const isRoot = depth === 0
  const headingId = `cat-${node.id}`

  return (
    <section
      id={isRoot ? `seccion-${node.id}` : undefined}
      ref={isRoot && registerRef ? (el) => registerRef(node.id, el) : undefined}
      aria-labelledby={headingId}
      className={cn(isRoot ? 'scroll-mt-32 pt-2' : 'pt-1')}
    >
      <header className={cn('flex items-baseline gap-2', isRoot ? 'mb-3 px-1' : 'mb-2 mt-4 px-1')}>
        <h2
          id={headingId}
          className={cn(
            'font-serif font-semibold tracking-tight text-balance',
            isRoot ? 'text-xl' : 'text-[15px] text-foreground/80',
          )}
        >
          {node.name}
        </h2>
        <span
          aria-hidden
          className={cn(
            'h-px flex-1',
            isRoot
              ? 'bg-gradient-to-r from-border to-transparent'
              : 'bg-gradient-to-r from-border/60 to-transparent',
          )}
        />
      </header>

      {node.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {node.items.map((item) => (
            <li key={item.id}>
              <ItemCard item={item} onOpen={onOpenItem} />
            </li>
          ))}
        </ul>
      )}

      {node.children.length > 0 && (
        <div className="mt-1">
          {node.children.map((child) => (
            <CategorySection
              key={child.id}
              node={child}
              onOpenItem={onOpenItem}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </section>
  )
}
