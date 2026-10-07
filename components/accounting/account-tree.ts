/**
 * El plan de cuentas como árbol, para `AccountPicker` (kit §3.8) y para quien
 * necesite el camino o la etiqueta de una cuenta. Puro y sin React.
 *
 * - El árbol se arma de una lista plana: por `parentId` si viene (es lo que
 *   guarda `acc_accounts.parent_id`) y, si no, por el código (`1.1.03.01` →
 *   `1.1.03`), así sirve igual para el plan estándar de `lib/accounting/chart.ts`.
 * - El orden es el del código, segmento por segmento y como número
 *   (`1.1.02` antes que `1.1.10`): el del plan.
 */

import type { EntityOption } from '@/components/ui/combobox'
import type { AccountRef, AccountType, Side } from '@/lib/accounting/types'

/**
 * Una cuenta del plan, como la lee el selector. Mismos nombres que el motor
 * (`AccountRef`): `postable` es «imputable» y `normalSide` el lado normal.
 */
export type AccountNode = Pick<AccountRef, 'id' | 'code' | 'name' | 'postable' | 'active'> & {
  /** `acc_accounts.parent_id`. Sin la clave, el padre sale del código; `null` es una raíz. */
  parentId?: string | null
  /** «Para qué se usa» (`acc_accounts.description`): la ayuda en lenguaje de dueño. */
  description?: string | null
  normalSide?: Side
  type?: AccountType
  /** Cuenta de control: sus líneas llevan partícipe (proveedor, cliente, organismo). */
  requiresParty?: boolean
}

export type AccountTreeEntry = {
  account: AccountNode
  /** 0 = rubro raíz («1 ACTIVO»). */
  depth: number
  parent: AccountNode | null
  /** De la raíz al padre. */
  ancestors: AccountNode[]
}

/** `'1.1.03.01'` → `'1.1.03'`; la raíz no tiene padre. */
export function parentCodeOf(code: string): string | null {
  const at = code.lastIndexOf('.')
  return at === -1 ? null : code.slice(0, at)
}

/** Orden del plan: por segmentos numéricos (`1.1.02` < `1.1.10` < `1.2`). */
export function compareAccountCodes(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * La lista plana en el orden del árbol (cada padre antes que sus hijas), con
 * la profundidad y los ancestros de cada una. Una cuenta cuyo padre no está en
 * la lista sube al ancestro más cercano que sí está (o queda de raíz).
 */
export function flattenAccountTree(accounts: readonly AccountNode[]): AccountTreeEntry[] {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const byCode = new Map(accounts.map((account) => [account.code, account]))

  const parentOf = (account: AccountNode): AccountNode | null => {
    if (account.parentId === null) return null
    if (account.parentId !== undefined) {
      const parent = byId.get(account.parentId)
      if (parent && parent.id !== account.id) return parent
    }
    for (let code = parentCodeOf(account.code); code !== null; code = parentCodeOf(code)) {
      const parent = byCode.get(code)
      if (parent && parent.id !== account.id) return parent
    }
    return null
  }

  const children = new Map<string | null, AccountNode[]>()
  for (const account of accounts) {
    const parent = parentOf(account)
    const key = parent?.id ?? null
    const list = children.get(key)
    if (list) list.push(account)
    else children.set(key, [account])
  }
  for (const list of children.values()) list.sort((a, b) => compareAccountCodes(a.code, b.code))

  const out: AccountTreeEntry[] = []
  const visited = new Set<string>()
  const walk = (parentKey: string | null, ancestors: AccountNode[]) => {
    for (const account of children.get(parentKey) ?? []) {
      // Un ciclo en los datos (A padre de B padre de A) no cuelga el render.
      if (visited.has(account.id)) continue
      visited.add(account.id)
      out.push({
        account,
        depth: ancestors.length,
        parent: ancestors[ancestors.length - 1] ?? null,
        ancestors,
      })
      walk(account.id, [...ancestors, account])
    }
  }
  walk(null, [])
  // Lo que quedó afuera por un ciclo va al final, como raíz: nunca se pierde una cuenta.
  for (const account of accounts) {
    if (!visited.has(account.id)) {
      visited.add(account.id)
      out.push({ account, depth: 0, parent: null, ancestors: [] })
    }
  }
  return out
}

/** «1.1.01 · Caja»: cómo se ve la cuenta elegida (kit §3.8). */
export function accountLabel(account: Pick<AccountNode, 'code' | 'name'>): string {
  return `${account.code} · ${account.name}`
}

/** «ACTIVO › Activo corriente › Caja y bancos»: el camino de rubros, sin la cuenta. */
export function accountPath(entry: Pick<AccountTreeEntry, 'ancestors'>): string {
  return entry.ancestors.map((ancestor) => ancestor.name).join(' › ')
}

/** El código sin puntos: con esto «1101» encuentra `1.1.01`. */
export function compactCode(code: string): string {
  return code.replace(/\D/g, '')
}

export type AccountOptionsInput = {
  /** Default `true`: los rubros (no imputables) son encabezados, no opciones. */
  postableOnly?: boolean
  includeInactive?: boolean
  filter?: (account: AccountNode) => boolean
  /** Ids que van siempre (la cuenta ya elegida aunque esté inactiva o el filtro la deje afuera). */
  keep?: readonly string[]
}

export type AccountOption = EntityOption<AccountNode>

/**
 * Las opciones del `Combobox` en el orden del plan.
 *
 * - `label`: «1.1.01.01 · Caja»: lo que muestra el disparador, y con lo que la
 *   búsqueda por código con puntos (`1.1`) pone ese subárbol primero (prefijo).
 * - `group`: el rubro padre («1.1.01 Caja y bancos»), que el Combobox dibuja
 *   como encabezado `role="presentation"` (no es una opción: las flechas lo
 *   saltean y el lector no lo anuncia).
 * - `keywords`: el código sin puntos («110101», así «1101» la encuentra) y los
 *   nombres de los rubros de arriba (buscar «créditos fiscales» trae sus
 *   cuentas).
 * - `description`: «Para qué se usa» (también se busca por ahí).
 */
export function accountOptions(
  accounts: readonly AccountNode[],
  input: AccountOptionsInput = {},
): AccountOption[] {
  const { postableOnly = true, includeInactive = false, filter, keep = [] } = input
  const kept = new Set(keep)
  const options: AccountOption[] = []
  for (const entry of flattenAccountTree(accounts)) {
    const { account, parent, ancestors } = entry
    const forced = kept.has(account.id)
    if (!forced) {
      if (postableOnly && !account.postable) continue
      if (!includeInactive && !account.active) continue
      if (filter && !filter(account)) continue
    }
    options.push({
      value: account.id,
      label: accountLabel(account),
      description: account.description?.trim() || undefined,
      keywords: [compactCode(account.code), ...ancestors.map((ancestor) => ancestor.name)],
      group: parent ? `${parent.code} ${parent.name}` : undefined,
      data: account,
    })
  }
  return options
}

/**
 * El rubro donde iría una cuenta nueva («Nueva cuenta» con el padre ya
 * elegido): si lo buscado es un código, el rubro más profundo que lo contiene
 * (`1.1.04.07` → `1.1.04`); si no, `null` (la hoja pregunta el rubro).
 */
export function suggestParentAccount(
  accounts: readonly AccountNode[],
  query: string,
): AccountNode | null {
  const code = query.trim().replace(/\.$/, '')
  if (!/^\d+(\.\d+)*$/.test(code)) return null
  let best: AccountNode | null = null
  for (const account of accounts) {
    if (account.postable || !account.active) continue
    if (code !== account.code && !code.startsWith(`${account.code}.`)) continue
    if (best === null || account.code.length > best.code.length) best = account
  }
  return best
}
