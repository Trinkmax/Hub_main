/**
 * «Aumentar precios», puro: a qué productos (toda la carta o categorías, donde elegir una
 * madre incluye a sus hijas), cuánto (un porcentaje, también para bajar) y con qué redondeo.
 * De acá sale la vista previa que se ve ANTES de aplicar y la lista exacta de lo que se manda
 * a guardar: lo que se muestra y lo que se escribe son la misma cuenta.
 *
 * La cuenta va en enteros (`BigInt`): ni un centavo de coma flotante.
 */

import { NBSP } from '@/lib/money'
import { type CategoryTree, descendantsOf, itemCategoryId, NO_CATEGORY_ID } from './tree'
import type { BranchOverride, PriceChange, PriceItem, ViewId } from './types'
import { pointKey } from './types'

// ─── A qué productos ─────────────────────────────────────────────────────────

/**
 * `categories`: las categorías cuyos productos PROPIOS entran. Elegir una madre anota a la
 * madre y a todo lo que cuelga de ella; después se puede sacar una hija sola sin perder los
 * productos que la madre tiene directamente.
 */
export type BulkScope = { kind: 'all' } | { kind: 'categories'; ids: readonly string[] }

export const SCOPE_ALL: BulkScope = { kind: 'all' }

/** En el orden de la carta, para que la misma elección se escriba siempre igual. */
function inTreeOrder(tree: CategoryTree, ids: Iterable<string>): string[] {
  const rank = new Map(tree.order.map((id, index) => [id, index]))
  return [...new Set(ids)].sort(
    (a, b) =>
      (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      (a < b ? -1 : a > b ? 1 : 0),
  )
}

/** La categoría y todo lo que cuelga de ella («sin categoría» no tiene nada colgando). */
function familyOf(tree: CategoryTree, id: string): string[] {
  return id === NO_CATEGORY_ID ? [id] : descendantsOf(tree, id)
}

/** Las categorías cuyos productos entran. `null` = toda la carta. */
export function scopeCategoryIds(scope: BulkScope): Set<string> | null {
  return scope.kind === 'all' ? null : new Set(scope.ids)
}

/** De una categoría (contando lo que cuelga): cuántos productos tiene y cuántos están elegidos. */
export type ScopeCount = { total: number; picked: number }

/** Cómo se ve su píldora: entera, en parte (alguna hija afuera) o nada. */
export type ScopeMark = 'on' | 'partial' | 'off'

export function scopeMark(count: ScopeCount | undefined): ScopeMark {
  if (!count || count.picked === 0) return 'off'
  return count.picked === count.total ? 'on' : 'partial'
}

/**
 * Los productos de cada categoría y los elegidos, contando lo que cuelga de ella. La marca de
 * cada píldora sale de acá: de los productos, no de qué casillero se tocó.
 */
export function scopeCounts(
  tree: CategoryTree,
  scope: BulkScope,
  items: ReadonlyArray<Pick<PriceItem, 'categoryId'>>,
): Map<string, ScopeCount> {
  const ids = scopeCategoryIds(scope)
  const direct = new Map<string, number>()
  for (const item of items) {
    const id = itemCategoryId(tree, item)
    direct.set(id, (direct.get(id) ?? 0) + 1)
  }
  const counts = new Map<string, ScopeCount>()
  for (const id of [...tree.order, NO_CATEGORY_ID]) {
    let total = 0
    let picked = 0
    for (const member of familyOf(tree, id)) {
      const own = direct.get(member) ?? 0
      total += own
      if (ids === null || ids.has(member)) picked += own
    }
    counts.set(id, { total, picked })
  }
  return counts
}

/**
 * Tocar una categoría: si ya estaba entera, sale ella y todo lo que cuelga; si no (nada o en
 * parte), entra entera. Desde «Toda la carta», tocar una categoría elige solo esa.
 */
export function toggleScope(
  tree: CategoryTree,
  scope: BulkScope,
  id: string,
  counts: ReadonlyMap<string, ScopeCount>,
): BulkScope {
  const family = familyOf(tree, id)
  if (scope.kind === 'all') return { kind: 'categories', ids: inTreeOrder(tree, family) }
  const picked = new Set(scope.ids)
  if (scopeMark(counts.get(id)) === 'on') for (const member of family) picked.delete(member)
  else for (const member of family) picked.add(member)
  return { kind: 'categories', ids: inTreeOrder(tree, picked) }
}

// ─── Cuánto ──────────────────────────────────────────────────────────────────

/** Los porcentajes de un toque. */
export const PERCENT_PRESETS = [5, 10, 15, 20] as const

/** En puntos básicos (100 = 1 %): de bajar un 90 % a subir un 500 %. */
export const PERCENT_BP_MIN = -9_000
export const PERCENT_BP_MAX = 50_000

/**
 * El porcentaje que se tipea en «Otro» → puntos básicos, sin coma flotante. Acepta «7,5»,
 * «7.5», «12 %», «-5». `null` si no se entiende, es cero o se va de rango.
 */
export function parsePercentInput(text: string): number | null {
  const cleaned = text
    .replace(/[\s %]/g, '')
    .replace(',', '.')
    .replace(/^[−–]/, '-')
  const match = /^([+-]?)(\d{1,3})(?:\.(\d{1,2}))?$/.exec(cleaned)
  if (!match) return null
  const [, sign = '', whole = '0', fraction = ''] = match
  const bp = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (sign === '-' ? -1 : 1)
  if (bp === 0 || bp < PERCENT_BP_MIN || bp > PERCENT_BP_MAX) return null
  return bp
}

/** «10 %», «7,5 %». Sin signo: si sube o baja lo dice el verbo. */
export function percentText(percentBp: number): string {
  const abs = Math.abs(percentBp)
  const whole = Math.floor(abs / 100)
  const fraction = abs % 100
  const decimals = fraction === 0 ? '' : `,${String(fraction).padStart(2, '0').replace(/0$/, '')}`
  return `${whole}${decimals}${NBSP}%`
}

// ─── Redondeo ────────────────────────────────────────────────────────────────

/** En centavos. 0 = sin redondear (queda al peso). */
export const ROUNDING_STEPS = [0, 5_000, 10_000, 50_000, 100_000] as const
export const DEFAULT_ROUNDING = 10_000
/** Sin redondeo, el precio queda al peso: la pantalla no muestra ni pide centavos. */
const ONE_PESO = 100

/**
 * El precio nuevo de UN producto: el porcentaje, redondeado al múltiplo más cercano (la mitad,
 * para arriba). Tres cuidados:
 * - nunca queda en $ 0 (si el redondeo lo lleva a cero, queda en un múltiplo);
 * - un aumento nunca baja un precio y una baja nunca lo sube (pasa cuando el precio de hoy no
 *   es múltiplo del redondeo): en ese caso queda como estaba;
 * - lo que hoy cuesta $ 0 sigue en $ 0.
 */
export function adjustPrice(baseCents: number, percentBp: number, roundingCents: number): number {
  if (baseCents <= 0 || percentBp === 0) return baseCents
  const unit = roundingCents > 0 ? roundingCents : ONE_PESO
  const scaled = BigInt(baseCents) * BigInt(10_000 + percentBp)
  const divisor = 10_000n * BigInt(unit)
  let next = Number(((scaled + divisor / 2n) / divisor) * BigInt(unit))
  if (next <= 0) next = unit
  if (percentBp > 0 && next < baseCents) return baseCents
  if (percentBp < 0 && next > baseCents) return baseCents
  return next
}

// ─── La lista de lo que cambia ───────────────────────────────────────────────

/** Un precio que entra en la cuenta: el de la carta o el propio de una sucursal. */
export type BulkPoint = {
  itemId: string
  name: string
  branchId: string | null
  /** Lo que hoy está escrito ahí. En una sucursal, `null` = sigue el precio de la carta. */
  currentCents: number | null
  /** De dónde parte la cuenta: lo que hoy se cobra ahí. */
  baseCents: number
}

export type BulkLine = BulkPoint & { toCents: number }

export type BulkResult = { changed: BulkLine[]; unchanged: BulkLine[] }

/**
 * Los precios que toca un aumento según dónde se esté parado:
 * - en «Toda la carta»: el precio de la carta de cada producto y, si se pide, también los
 *   precios propios que esos productos tengan en alguna sucursal (si no, quedarían atrasados);
 * - en una sucursal: lo que se cobra ahí, de cada producto que ahí se vende.
 */
export function bulkPoints(args: {
  tree: CategoryTree
  /** Con el precio de la carta al día. */
  items: ReadonlyArray<PriceItem>
  overrides: Iterable<BranchOverride>
  scope: BulkScope
  view: ViewId
  includeOwnPrices: boolean
}): BulkPoint[] {
  const { tree, items, scope, view } = args
  const categoryIds = scopeCategoryIds(scope)
  const inScope = items.filter(
    (item) => categoryIds === null || categoryIds.has(itemCategoryId(tree, item)),
  )
  const overrides = new Map<string, BranchOverride>()
  for (const override of args.overrides) {
    overrides.set(pointKey(override.branchId, override.itemId), override)
  }

  if (view !== null) {
    const points: BulkPoint[] = []
    for (const item of inScope) {
      const override = overrides.get(pointKey(view, item.id))
      if (override && !override.available) continue
      const own = override?.priceCents ?? null
      points.push({
        itemId: item.id,
        name: item.name,
        branchId: view,
        currentCents: own,
        baseCents: own ?? item.priceCents,
      })
    }
    return points
  }

  const points: BulkPoint[] = inScope.map((item) => ({
    itemId: item.id,
    name: item.name,
    branchId: null,
    currentCents: item.priceCents,
    baseCents: item.priceCents,
  }))
  if (!args.includeOwnPrices) return points
  const names = new Map(inScope.map((item) => [item.id, item.name]))
  for (const override of overrides.values()) {
    const name = names.get(override.itemId)
    if (name === undefined || override.priceCents === null) continue
    points.push({
      itemId: override.itemId,
      name,
      branchId: override.branchId,
      currentCents: override.priceCents,
      baseCents: override.priceCents,
    })
  }
  return points
}

/** Aplica el porcentaje y el redondeo a cada precio y separa lo que cambia de lo que no. */
export function computeBulk(
  points: ReadonlyArray<BulkPoint>,
  percentBp: number,
  roundingCents: number,
): BulkResult {
  const changed: BulkLine[] = []
  const unchanged: BulkLine[] = []
  for (const point of points) {
    const toCents = adjustPrice(point.baseCents, percentBp, roundingCents)
    if (toCents === point.baseCents) unchanged.push({ ...point, toCents })
    else changed.push({ ...point, toCents })
  }
  return { changed, unchanged }
}

/** Lo que se manda a guardar: de lo escrito hoy a lo nuevo. */
export function bulkChanges(lines: ReadonlyArray<BulkLine>): PriceChange[] {
  return lines.map((line) => ({
    itemId: line.itemId,
    branchId: line.branchId,
    fromCents: line.currentCents,
    toCents: line.toCents,
  }))
}

// ─── La vista previa ─────────────────────────────────────────────────────────

export type BulkSummary = {
  /** Productos distintos que cambian. */
  productCount: number
  /** De los precios que cambian, cuántos son propios de una sucursal (solo en «Toda la carta»). */
  ownPriceCount: number
  /** Productos que quedan igual. */
  unchangedCount: number
  /** Tres o cuatro casos concretos, repartidos entre lo barato y lo caro. */
  examples: BulkLine[]
  /** El que menos cambia y el que más, en pesos. */
  smallest: BulkLine | null
  largest: BulkLine | null
}

const deltaOf = (line: BulkLine) => Math.abs(line.toCents - line.baseCents)

/**
 * El resumen que se lee antes de aplicar. Los ejemplos salen de lo que más se mira (el precio
 * de la carta, o el de la sucursal donde se está): del medio de la lista ordenada por precio,
 * para no repetir al que menos cambia ni al que más.
 */
export function summarizeBulk(result: BulkResult, opts: { examples?: number } = {}): BulkSummary {
  const wanted = opts.examples ?? 4
  // En «Toda la carta» hay precios de la carta (y quizá propios); en una sucursal, solo de ahí.
  const hasMenuPrices = result.changed.some((line) => line.branchId === null)
  const primary = hasMenuPrices
    ? result.changed.filter((line) => line.branchId === null)
    : result.changed
  const byPrice = primary
    .map((line, index) => ({ line, index }))
    .sort((a, b) => a.line.baseCents - b.line.baseCents || a.index - b.index)
    .map((entry) => entry.line)

  let smallest: BulkLine | null = null
  let largest: BulkLine | null = null
  for (const line of byPrice) {
    if (smallest === null || deltaOf(line) < deltaOf(smallest)) smallest = line
    if (largest === null || deltaOf(line) > deltaOf(largest)) largest = line
  }

  // Con pocos, van todos; con muchos, se saltean los dos extremos (ya tienen su renglón).
  const pool =
    byPrice.length > wanted + 2
      ? byPrice.filter((line) => line !== smallest && line !== largest)
      : byPrice
  const examples: BulkLine[] = []
  if (pool.length <= wanted) examples.push(...pool)
  else {
    for (let pick = 0; pick < wanted; pick++) {
      const line = pool[Math.floor(((pick + 0.5) * pool.length) / wanted)]
      if (line && !examples.includes(line)) examples.push(line)
    }
  }

  const changedProducts = new Set(result.changed.map((line) => line.itemId))
  const unchangedProducts = new Set(
    result.unchanged.filter((line) => !changedProducts.has(line.itemId)).map((line) => line.itemId),
  )
  return {
    productCount: changedProducts.size,
    ownPriceCount: hasMenuPrices
      ? result.changed.filter((line) => line.branchId !== null).length
      : 0,
    unchangedCount: unchangedProducts.size,
    examples,
    smallest,
    largest,
  }
}

// ─── Cómo se dice ────────────────────────────────────────────────────────────

const products = (count: number) => (count === 1 ? '1 producto' : `${count} productos`)

/** El botón dice exactamente lo que va a pasar: «Aumentar 46 productos un 10 %». */
export function bulkButtonLabel(args: {
  count: number
  percentBp: number
  branchName?: string | null
}): string {
  const verb = args.percentBp < 0 ? 'Bajar' : 'Aumentar'
  const where = args.branchName ? ` en ${args.branchName}` : ''
  return `${verb} ${products(args.count)} un ${percentText(args.percentBp)}${where}`
}

/** Lo que pasó: «Aumentaste 46 productos un 10 %», o «44 de 46» si alguno no se pudo. */
export function bulkDoneSentence(args: {
  applied: number
  requested: number
  percentBp: number
  branchName?: string | null
}): string {
  const verb = args.percentBp < 0 ? 'Bajaste' : 'Aumentaste'
  const where = args.branchName ? ` en ${args.branchName}` : ''
  const howMany =
    args.applied < args.requested
      ? `${args.applied} de ${products(args.requested)}`
      : products(args.applied)
  return `${verb} ${howMany} un ${percentText(args.percentBp)}${where}`
}
