/**
 * Las categorías de «¿En qué se gastó?», puras: qué cuentas del plan se ofrecen
 * como categoría, con qué nombre corto y en qué grupo va cada una. Lo usan el
 * selector (`CategoryPicker`) y «Tus categorías» del Plan de cuentas, para que
 * los dos muestren los MISMOS grupos, en el mismo orden y con los mismos
 * nombres.
 *
 * - El grupo de una categoría es su cuenta madre («Gastos del local»,
 *   «Personal», «Honorarios»). Sale de `parentId` o, si la lista no lo trae (las
 *   hojas de carga), del código: sin lecturas nuevas.
 * - Lo que no es un gasto del mes sino algo que queda en el bar (equipos,
 *   muebles, instalaciones, software: las cuentas de activo) va todo junto en un
 *   último grupo, «Equipos y muebles».
 * - El nombre corto saca el prefijo «Compras: » y pone mayúscula.
 *
 * Qué cuentas se pueden elegir lo decide quien la usa (`selectable`): el kit no
 * sabe nada de compras.
 *
 * Cuándo NO: para una contrapartida que no es un gasto (un aporte de un socio,
 * un impuesto desconocido, una cuenta del asiento manual): ahí va el plan
 * entero con `AccountCombobox`.
 */

import { compareAccountCode, treeEntries } from '@/components/administracion/account-paths'

/** Lo que hace falta de una cuenta del plan. Las filas del plan y las de las hojas lo cumplen. */
export type CategoryAccount = {
  id: string
  code: string
  name: string
  type: string
  postable: boolean
  active?: boolean
  /** `null` = cuenta principal; sin el campo, la madre se saca del código. */
  parentId?: string | null
  systemKey?: string | null
}

export type CategoryOption = {
  id: string
  /** El nombre contable, tal cual está en el plan («Compras: bebidas con alcohol»). */
  name: string
  /** El que se muestra en el chip («Bebidas con alcohol»). */
  shortName: string
  code: string
  groupId: string
  groupName: string
}

export type CategoryGroup = { id: string; name: string; options: CategoryOption[] }

/** El grupo donde van juntas todas las cuentas de activo. No es el id de ninguna cuenta. */
export const FIXED_ASSETS_GROUP_ID = 'equipos-y-muebles'
export const FIXED_ASSETS_GROUP_NAME = 'Equipos y muebles'
/** La aclaración de ese grupo, la misma en el selector y en «Tus categorías». */
export const FIXED_ASSETS_GROUP_NOTE = 'Quedan en el bar: no son gasto del mes.'

const PURCHASES_KEY_PREFIX = 'purchases_'

function capitalize(text: string): string {
  const first = text.charAt(0)
  return first === '' ? text : first.toUpperCase() + text.slice(1)
}

/** «Compras: bebidas con alcohol» → «Bebidas con alcohol». Lo demás, igual y con mayúscula. */
export function categoryShortName(name: string): string {
  const trimmed = name.trim()
  const short = trimmed.replace(/^compras\s*:\s*/i, '')
  return capitalize(short === '' ? trimmed : short)
}

function isOffered(account: CategoryAccount): boolean {
  return account.postable && account.active !== false
}

/**
 * Las categorías que se pueden elegir, en el orden del plan y con los equipos
 * y muebles al final. Solo entran las cuentas imputables, activas y que
 * `selectable` acepta: lo que no pasa por ahí queda para «Ver el plan completo».
 */
export function categoryOptions(
  accounts: readonly CategoryAccount[],
  selectable: (id: string) => boolean,
): CategoryOption[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const expenses: CategoryOption[] = []
  const assets: CategoryOption[] = []

  for (const { account, parentId } of treeEntries(accounts)) {
    if (!isOffered(account) || !selectable(account.id)) continue
    const shortName = categoryShortName(account.name)
    const base = { id: account.id, name: account.name, shortName, code: account.code }
    if (account.type === 'asset') {
      assets.push({ ...base, groupId: FIXED_ASSETS_GROUP_ID, groupName: FIXED_ASSETS_GROUP_NAME })
      continue
    }
    // Sin madre a la vista (una lista que trae solo las hojas), la categoría
    // es su propio grupo: en el selector queda como un chip suelto.
    const parent = parentId === null ? undefined : byId.get(parentId)
    expenses.push({
      ...base,
      groupId: parent ? parent.id : account.id,
      groupName: parent ? parent.name.trim() : shortName,
    })
  }
  return [...expenses, ...assets]
}

/**
 * Las categorías agrupadas, en el orden en que aparece cada grupo y con
 * «Equipos y muebles» siempre al final. No agrega grupos vacíos.
 */
export function categoryGroups(options: readonly CategoryOption[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>()
  for (const option of options) {
    const group = groups.get(option.groupId)
    if (group) group.options.push(option)
    else
      groups.set(option.groupId, { id: option.groupId, name: option.groupName, options: [option] })
  }
  const all = [...groups.values()]
  return [
    ...all.filter((g) => g.id !== FIXED_ASSETS_GROUP_ID),
    ...all.filter((g) => g.id === FIXED_ASSETS_GROUP_ID),
  ]
}

/**
 * La «Mercadería»: los ids de las cuentas con clave `purchases_*` (alimentos,
 * bebidas, descartables…), en el orden del plan. Es lo que le compra un bar a
 * casi todos sus proveedores, por eso va siempre a la vista. En un plan sin esas
 * claves devuelve una lista vacía y esa fila no se dibuja.
 */
export function featuredCategories(accounts: readonly CategoryAccount[]): string[] {
  return accounts
    .filter((a) => isOffered(a) && (a.systemKey ?? '').startsWith(PURCHASES_KEY_PREFIX))
    .sort((a, b) => compareAccountCode(a.code, b.code))
    .map((a) => a.id)
}

/**
 * «Las que más usás»: los ids con más uso, de mayor a menor (a igual uso, en
 * el orden en que llegaron). `exclude` saca las que ya se muestran en otra fila
 * (la «Mercadería»). Lo que tiene uso cero no entra.
 */
export function topCategories(
  usage: ReadonlyMap<string, number>,
  max = 6,
  exclude?: ReadonlySet<string>,
): string[] {
  if (max <= 0) return []
  return [...usage.entries()]
    .filter(([id, count]) => count > 0 && !(exclude?.has(id) ?? false))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id]) => id)
}
