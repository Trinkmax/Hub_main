import type { MenuCategory, MenuItem } from './queries'

export type MenuTreeNode = MenuCategory & {
  children: MenuTreeNode[]
  items: MenuItem[]
}

/** Arma el bosque de categorías desde listas planas. Ítems van bajo su categoría
 *  directa (category_id). Hijos e ítems quedan ordenados por position. */
export function buildCategoryTree(categories: MenuCategory[], items: MenuItem[]): MenuTreeNode[] {
  const byId = new Map<string, MenuTreeNode>()
  for (const c of categories) byId.set(c.id, { ...c, children: [], items: [] })

  for (const it of items) {
    if (!it.category_id) continue
    byId.get(it.category_id)?.items.push(it)
  }

  const roots: MenuTreeNode[] = []
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const sortRec = (nodes: MenuTreeNode[]) => {
    nodes.sort(byPos)
    for (const n of nodes) {
      n.items.sort(byPos)
      sortRec(n.children)
    }
  }
  sortRec(roots)
  return roots
}

/** Ancestros desde la raíz hasta la categoría (incluida). */
export function categoryPath(categories: MenuCategory[], id: string): MenuCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const out: MenuCategory[] = []
  let cur = byId.get(id)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return out
}

/** "Bebidas › Vinos". */
export function categoryPathLabel(categories: MenuCategory[], id: string): string {
  return categoryPath(categories, id)
    .map((c) => c.name)
    .join(' › ')
}

export type PickerEntry = { id: string; name: string; depth: number; path: string }

/** Lista plana en orden de árbol con depth y path; opcionalmente excluye un
 *  subárbol entero (la categoría `excludeSubtreeOf` y todos sus descendientes),
 *  para pickers de "mover" que no deben permitir ciclos. */
export function flattenForPicker(
  categories: MenuCategory[],
  excludeSubtreeOf?: string,
): PickerEntry[] {
  const tree = buildCategoryTree(categories, [])
  const out: PickerEntry[] = []
  const walk = (nodes: MenuTreeNode[], depth: number, ancestors: string[]) => {
    for (const n of nodes) {
      if (n.id === excludeSubtreeOf) continue
      const path = [...ancestors, n.name].join(' › ')
      out.push({ id: n.id, name: n.name, depth, path })
      walk(n.children, depth + 1, [...ancestors, n.name])
    }
  }
  walk(tree, 0, [])
  return out
}
