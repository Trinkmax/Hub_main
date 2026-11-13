/**
 * Los renglones de la cuenta, como se leen en un papel — PURO.
 *
 * La base devuelve un renglón por cada vez que algo se pidió («2 Mojito» en la primera tanda, «2
 * Mojito» en la tercera). La cuenta del bar no se escribe así: dice «4 Mojito». Acá se juntan los
 * renglones que son lo mismo al mismo precio, sin perder de cuál tanda salió cada unidad: dividir por
 * producto y dar de baja siguen trabajando sobre los renglones de verdad.
 *
 * Las aclaraciones sin precio y las notas («sin hielo») son cosa de cocina: no separan renglones ni
 * se imprimen. Las que cambian el precio sí.
 */
import type { ProductPick } from '@/lib/pos/cash/bill'
import type { BillLine } from '@/lib/pos/cash/types'

export type LineGroup = {
  /** Estable entre lecturas mientras el producto y su precio no cambien. */
  key: string
  name: string
  /** Aclaraciones con precio: «Extra cheddar» + $ 1.500. */
  extras: { label: string; delta_cents: number }[]
  quantity: number
  /** Unidades que ya cubrió algún cobro por producto. */
  paidUnits: number
  /** Las que todavía se pueden cobrar por producto. */
  freeUnits: number
  /** Lo que vale una unidad. */
  unitCents: number
  totalCents: number
  /** Los renglones de verdad, en el orden en que se pidieron. */
  lines: BillLine[]
}

function unitOf(line: BillLine): number {
  return line.quantity > 0 ? Math.round(line.line_total_cents / line.quantity) : 0
}

function pricedExtras(line: BillLine): { label: string; delta_cents: number }[] {
  return line.modifiers
    .filter((modifier) => modifier.delta_cents !== 0)
    .map(({ label, delta_cents }) => ({ label, delta_cents }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es') || a.delta_cents - b.delta_cents)
}

/** Junta los renglones iguales, en el orden en que aparecieron por primera vez. */
export function groupLines(lines: ReadonlyArray<BillLine>): LineGroup[] {
  const groups = new Map<string, LineGroup>()
  for (const line of lines) {
    if (line.quantity < 1) continue
    const extras = pricedExtras(line)
    const unitCents = unitOf(line)
    const key = [
      line.menu_item_id,
      unitCents,
      ...extras.map((extra) => `${extra.label}:${extra.delta_cents}`),
    ].join('|')
    const free = Math.max(0, line.quantity - line.paid_units)
    const group = groups.get(key)
    if (group) {
      group.quantity += line.quantity
      group.paidUnits += Math.min(line.paid_units, line.quantity)
      group.freeUnits += free
      group.totalCents += line.line_total_cents
      group.lines.push(line)
    } else {
      groups.set(key, {
        key,
        name: line.name,
        extras,
        quantity: line.quantity,
        paidUnits: Math.min(line.paid_units, line.quantity),
        freeUnits: free,
        unitCents,
        totalCents: line.line_total_cents,
        lines: [line],
      })
    }
  }
  return [...groups.values()]
}

/** Lo elegido para cobrar por producto: cuántas unidades de cada renglón de la cuenta (por `key`). */
export type Chosen = Readonly<Record<string, number>>

function wanted(chosen: Chosen, key: string): number {
  const units = chosen[key]
  return typeof units === 'number' && Number.isFinite(units) ? Math.max(0, Math.floor(units)) : 0
}

/**
 * Reparte las unidades elegidas de un renglón de la cuenta entre sus renglones de verdad, llenando
 * primero los más viejos y salteando lo que ya está cobrado.
 */
export function picksForGroup(group: LineGroup, units: number): ProductPick[] {
  let left = Math.min(Math.max(0, Math.floor(units)), group.freeUnits)
  const picks: ProductPick[] = []
  for (const line of group.lines) {
    if (left <= 0) break
    const take = Math.min(left, Math.max(0, line.quantity - line.paid_units))
    if (take > 0) {
      picks.push({ lineId: line.id, units: take })
      left -= take
    }
  }
  return picks
}

/** Todo lo elegido, como lo espera `byProductAmount` y como viaja con el cobro. */
export function expandChosen(groups: ReadonlyArray<LineGroup>, chosen: Chosen): ProductPick[] {
  return groups.flatMap((group) => picksForGroup(group, wanted(chosen, group.key)))
}

/** Cuántas unidades hay elegidas (contando solo lo que todavía se puede cobrar). */
export function chosenUnits(groups: ReadonlyArray<LineGroup>, chosen: Chosen): number {
  return groups.reduce(
    (sum, group) => sum + Math.min(wanted(chosen, group.key), group.freeUnits),
    0,
  )
}

/** Cuántas unidades de la mesa quedan sin cobrar por producto. */
export function freeUnits(groups: ReadonlyArray<LineGroup>): number {
  return groups.reduce((sum, group) => sum + group.freeUnits, 0)
}

/**
 * Lo elegido, puesto al día con una cuenta nueva: fuera lo que ya no está y lo que otro celular
 * cobró mientras tanto. Devuelve el mismo objeto si no cambió nada.
 */
export function pruneChosen(groups: ReadonlyArray<LineGroup>, chosen: Chosen): Chosen {
  const byKey = new Map(groups.map((group) => [group.key, group]))
  const next: Record<string, number> = {}
  let changed = false
  for (const [key, raw] of Object.entries(chosen)) {
    const group = byKey.get(key)
    const units = Math.min(wanted(chosen, key), group?.freeUnits ?? 0)
    if (units > 0) next[key] = units
    if (units !== raw) changed = true
  }
  return changed ? next : chosen
}

/**
 * Un toque sobre el renglón: uno más. Cuando ya están todas las que quedan, el toque que sigue lo
 * deja en cero (con un solo producto, tocar marca y desmarca).
 */
export function tapChosen(group: LineGroup, chosen: Chosen): Chosen {
  if (group.freeUnits < 1) return chosen
  const current = Math.min(wanted(chosen, group.key), group.freeUnits)
  return setChosen(group, chosen, current >= group.freeUnits ? 0 : current + 1)
}

export function setChosen(group: LineGroup, chosen: Chosen, units: number): Chosen {
  const clamped = Math.min(Math.max(0, Math.floor(units)), group.freeUnits)
  const { [group.key]: _dropped, ...rest } = chosen
  return clamped > 0 ? { ...rest, [group.key]: clamped } : rest
}

/**
 * «2 Mojito + 1 Lomito»: de quién es ese cobro en la lista, cuando se dividió por producto. Entra en
 * los 60 caracteres del rótulo; si no entra, se corta con puntos suspensivos.
 */
export function chosenLabel(groups: ReadonlyArray<LineGroup>, chosen: Chosen, max = 60): string {
  const parts: string[] = []
  for (const group of groups) {
    const units = Math.min(wanted(chosen, group.key), group.freeUnits)
    if (units > 0) parts.push(`${units} ${group.name}`)
  }
  const text = parts.join(' + ')
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
