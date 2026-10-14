import {
  type CategoryAccount,
  type CategoryOption,
  categoryGroups,
  categoryOptions,
  FIXED_ASSETS_GROUP_ID,
  FIXED_ASSETS_GROUP_NOTE,
} from '@/components/administracion/kit/category'
import { normalizeText } from '@/components/administracion/search'
import { formatCentsShort } from '@/lib/money'

/**
 * «Tus categorías»: la lista de «¿En qué se gastó?» que ve el dueño en el Plan
 * de cuentas. Puro (lo prueban los tests).
 *
 * Los grupos, su orden y los nombres cortos salen de `categoryOptions()` +
 * `categoryGroups()` del kit: son EXACTAMENTE los del selector `CategoryPicker`
 * que se usa al cargar un gasto. Acá solo se suma lo propio de la lista: el
 * «para qué se usa», lo anotado en el ejercicio y el buscador.
 */

/** Lo que hace falta de una cuenta del plan (`ChartAccount` lo cumple). */
export type CategoryListAccount = CategoryAccount & {
  purchaseSelectable: boolean
  description: string | null
  /** Debe − Haber al día (un gasto acumula del lado del Debe); `null` sin saldos. */
  balanceCents: number | null
}

export type CategoryListItem = CategoryOption & {
  /** «Para qué se usa», como lo escribió quien armó el plan. */
  description: string | null
  /** Lo anotado en la categoría; `null` si no hay saldos o no tuvo uso. Nunca cero. */
  usedCents: number | null
}

export type CategoryListGroup = {
  id: string
  name: string
  /** La aclaración gris del grupo (solo «Equipos y muebles»). */
  note: string | null
  /** Es un grupo del plan: se le puede agregar una categoría adentro. */
  parentId: string | null
  items: CategoryListItem[]
}

/** Las categorías de «¿En qué se gastó?», agrupadas como en el selector. */
export function categoryListGroups(accounts: readonly CategoryListAccount[]): CategoryListGroup[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const options = categoryOptions(accounts, (id) => byId.get(id)?.purchaseSelectable === true)
  return categoryGroups(options).map((group) => {
    const isAssets = group.id === FIXED_ASSETS_GROUP_ID
    const parent = isAssets ? undefined : byId.get(group.id)
    return {
      id: group.id,
      name: group.name,
      note: isAssets ? FIXED_ASSETS_GROUP_NOTE : null,
      // Solo un grupo de verdad (no imputable y activo) admite «Agregar en …».
      parentId: parent && !parent.postable && parent.active !== false ? parent.id : null,
      items: group.options.map((option) => {
        const account = byId.get(option.id)
        const balance = account?.balanceCents ?? null
        return {
          ...option,
          description: account?.description?.trim() || null,
          usedCents: balance !== null && balance > 0 ? balance : null,
        }
      }),
    }
  })
}

/** Cuántas categorías hay en total. */
export function categoryCount(groups: readonly CategoryListGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0)
}

/** Cuántas tienen algo anotado. */
export function usedCategoryCount(groups: readonly CategoryListGroup[]): number {
  return groups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.usedCents !== null).length,
    0,
  )
}

/**
 * El buscador: por nombre (el corto y el contable), por «para qué se usa» y por
 * el nombre del grupo, sin tildes ni mayúsculas. Los grupos que quedan vacíos
 * no se devuelven. Sin texto, todo.
 */
export function filterCategoryGroups(
  groups: readonly CategoryListGroup[],
  query: string,
): CategoryListGroup[] {
  const needle = normalizeText(query)
  if (!needle) return [...groups]
  const out: CategoryListGroup[] = []
  for (const group of groups) {
    const groupHit = normalizeText(group.name).includes(needle)
    const items = groupHit
      ? group.items
      : group.items.filter((item) =>
          [item.shortName, item.name, item.description ?? ''].some((text) =>
            normalizeText(text).includes(needle),
          ),
        )
    if (items.length > 0) out.push({ ...group, items })
  }
  return out
}

/** «$ 856.500 en el año» · «sin uso». Nunca «$ 0». */
export function categoryUsedText(usedCents: number | null): string {
  return usedCents !== null && usedCents > 0
    ? `${formatCentsShort(usedCents)} en el año`
    : 'sin uso'
}
