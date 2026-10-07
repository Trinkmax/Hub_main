/**
 * El árbol del plan de cuentas, puro (lo usan el selector de cuentas y la pantalla del plan): de qué
 * grupo es cada cuenta, el orden de árbol y el camino «ACTIVO › Activo corriente › …».
 *
 * Desde la #16 el código es una etiqueta libre: una cuenta que se mueve a otro grupo conserva su
 * código. Por eso la madre sale de `parentId` cuando la lista lo trae; si no, se infiere por el código
 * igual que `acc_import_accounts`: la cuenta cuyo código significativo (sin los segmentos finales en
 * cero) es el prefijo más largo, por segmentos, del de la cuenta. Así `1.1.01.01.001` cuelga de
 * `1.1.01.01.000`, y `1.1.01.04` de `1.1.01`.
 */

export type TreeAccount = {
  id: string
  code: string
  name: string
  /** `null` = cuenta principal; `undefined` = la lista no lo trae (se infiere por el código). */
  parentId?: string | null
}

export type TreeEntry<T extends TreeAccount> = {
  account: T
  /** 0 para las cuentas principales. */
  depth: number
  parentId: string | null
  /** Ids de la raíz a la madre. */
  ancestors: string[]
}

/** Sin los segmentos finales en cero (`'1.1.01.01.000'` → `'1.1.01.01'`). Igual que `significantCode`. */
export function significantAccountCode(code: string): string {
  return code.replace(/(\.0+)+$/, '')
}

/** Orden por código segmento a segmento («1.1.2» antes que «1.1.10»; el grupo `.000` antes que sus hijas). */
export function compareAccountCode(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i += 1) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x) ? Number(x) : Number.NaN
    const ny = /^\d+$/.test(y) ? Number(y) : Number.NaN
    const diff = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x < y ? -1 : x > y ? 1 : 0
    if (diff !== 0) return diff
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Lo que se tipea para buscar una cuenta por código, sin los ceros finales: «1.1.01.00.000» busca
 * todo lo que está adentro de ese grupo. Un texto que no es un código pasa igual.
 */
export function normalizeCodeQuery(query: string): string {
  const q = query.trim()
  if (!/^\d+(\.\d+)+\.?$/.test(q)) return q
  const sig = significantAccountCode(q.replace(/\.$/, ''))
  return sig === '' ? q : sig
}

function segmentsOf(code: string): string[] {
  return significantAccountCode(code).split('.')
}

/**
 * La madre de cada cuenta (id → id o `null`): la de `parentId`; sin `parentId`, o si esa madre no
 * vino en la lista (una lista acotada), la que dice el código.
 */
export function resolveParents(accounts: readonly TreeAccount[]): Map<string, string | null> {
  const ids = new Set(accounts.map((a) => a.id))
  const bySig = new Map<string, TreeAccount[]>()
  for (const a of accounts) {
    const sig = significantAccountCode(a.code)
    const list = bySig.get(sig)
    if (list) list.push(a)
    else bySig.set(sig, [a])
  }

  const inferred = (a: TreeAccount): string | null => {
    const segs = segmentsOf(a.code)
    const rawSegments = a.code.split('.').length
    for (let k = segs.length - 1; k >= 1; k -= 1) {
      const candidates = (bySig.get(segs.slice(0, k).join('.')) ?? []).filter((c) => c.id !== a.id)
      if (candidates.length === 0) continue
      // Como la base: primero el del mismo estilo (misma cantidad de segmentos), después por código.
      const best = candidates.slice().sort((x, y) => {
        const sx = x.code.split('.').length === rawSegments ? 0 : 1
        const sy = y.code.split('.').length === rawSegments ? 0 : 1
        return sx - sy || compareAccountCode(x.code, y.code)
      })[0]
      if (best) return best.id
    }
    return null
  }

  const parents = new Map<string, string | null>()
  for (const a of accounts) {
    if (a.parentId === null) parents.set(a.id, null)
    else if (a.parentId !== undefined && ids.has(a.parentId)) parents.set(a.id, a.parentId)
    else parents.set(a.id, inferred(a))
  }
  return parents
}

/**
 * Las cuentas en orden de árbol (cada madre antes que sus hijas; hermanas por código), con su
 * profundidad y su camino. Una cuenta que no se alcanza desde una raíz (dato roto) sale como raíz al
 * final, nunca se pierde.
 */
export function treeEntries<T extends TreeAccount>(accounts: readonly T[]): TreeEntry<T>[] {
  const parents = resolveParents(accounts)
  const children = new Map<string | null, T[]>()
  for (const a of accounts) {
    const parent = parents.get(a.id) ?? null
    const list = children.get(parent)
    if (list) list.push(a)
    else children.set(parent, [a])
  }
  const byCode = (x: T, y: T) => compareAccountCode(x.code, y.code) || x.name.localeCompare(y.name)
  for (const list of children.values()) list.sort(byCode)

  const out: TreeEntry<T>[] = []
  const seen = new Set<string>()
  const visit = (account: T, depth: number, ancestors: string[]) => {
    if (seen.has(account.id)) return
    seen.add(account.id)
    out.push({ account, depth, parentId: ancestors[ancestors.length - 1] ?? null, ancestors })
    const path = [...ancestors, account.id]
    for (const child of children.get(account.id) ?? []) visit(child, depth + 1, path)
  }
  for (const root of children.get(null) ?? []) visit(root, 0, [])
  for (const a of accounts.slice().sort(byCode)) visit(a, 0, [])
  return out
}

/** «ACTIVO › Activo corriente › Caja y bancos» de cada cuenta (vacío para las principales). */
export function accountPaths<T extends TreeAccount>(
  entries: readonly TreeEntry<T>[],
  separator = ' › ',
): Map<string, string> {
  const names = new Map(entries.map((e) => [e.account.id, e.account.name]))
  return new Map(
    entries.map((e) => [
      e.account.id,
      e.ancestors
        .map((id) => names.get(id) ?? '')
        .filter((name) => name !== '')
        .join(separator),
    ]),
  )
}
