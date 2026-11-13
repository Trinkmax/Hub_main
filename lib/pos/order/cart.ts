/**
 * La tanda que el mozo está armando — PURO.
 *
 * Un borrador es una lista de renglones (producto + aclaraciones + nota + cantidad) y una clave que
 * nace con el primer renglón y viaja con la tanda hasta que el servidor la confirma: reintentar sin
 * señal nunca duplica.
 *
 * Dos renglones son el mismo si piden lo mismo de la misma forma (producto, aclaraciones y nota): se
 * juntan sumando cantidades. Todo lo que hace falta inventar (claves) llega en la acción, así el
 * reductor no tiene azar adentro.
 */
import type { OrderLineInput } from '@/lib/pos/types'
import type { MenuIndex } from './menu-index'

export const MAX_QUANTITY = 99
export const MAX_LINES = 80
export const MAX_OPTIONS = 12
export const MAX_NOTE = 200

export type DraftLine = {
  /** Identidad local del renglón (para editarlo); no viaja al servidor. */
  key: string
  menu_item_id: string
  quantity: number
  option_ids: string[]
  notes: string | null
}

export type Draft = {
  /** Clave de idempotencia de la tanda. Vacía mientras no hay renglones. */
  key: string | null
  lines: DraftLine[]
}

export const EMPTY_DRAFT: Draft = { key: null, lines: [] }

export type NewLine = {
  menu_item_id: string
  quantity?: number
  option_ids?: readonly string[]
  notes?: string | null
  /** Clave para el renglón si hace falta crear uno. */
  lineKey: string
}

export type CartAction =
  | ({ type: 'add'; draftKey: string } & NewLine)
  | { type: 'add_many'; draftKey: string; lines: readonly NewLine[] }
  | { type: 'inc'; lineKey: string }
  | { type: 'dec'; lineKey: string }
  /** El «−» de la carta: saca uno del último renglón cargado de ese producto. */
  | { type: 'dec_item'; menu_item_id: string }
  | { type: 'set_quantity'; lineKey: string; quantity: number }
  | { type: 'set_options'; lineKey: string; option_ids: readonly string[] }
  | { type: 'set_note'; lineKey: string; notes: string | null }
  /** Lo que confirma la hoja de aclaraciones, de una. */
  | {
      type: 'edit'
      lineKey: string
      quantity?: number
      option_ids?: readonly string[]
      notes?: string | null
    }
  | { type: 'remove'; lineKey: string }
  | { type: 'clear' }
  | { type: 'restore'; draft: Draft }

export function cleanNote(notes: string | null | undefined): string | null {
  const text = (notes ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE).trim()
  return text || null
}

export function cleanOptions(optionIds: readonly string[] | undefined): string[] {
  return [...new Set(optionIds ?? [])].slice(0, MAX_OPTIONS)
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1
  return Math.min(MAX_QUANTITY, Math.max(0, Math.trunc(quantity)))
}

/** Lo que hace que dos renglones sean el mismo pedido. */
export function lineSignature(
  line: Pick<DraftLine, 'menu_item_id' | 'option_ids' | 'notes'>,
): string {
  const options = [...new Set(line.option_ids)].sort().join(',')
  const note = (cleanNote(line.notes) ?? '').toLowerCase()
  return `${line.menu_item_id}|${options}|${note}`
}

function finish(key: string | null, lines: DraftLine[]): Draft {
  // Sin renglones no hay tanda: la próxima nace con su propia clave.
  return lines.length === 0 ? EMPTY_DRAFT : { key, lines }
}

function addLine(lines: DraftLine[], incoming: NewLine): DraftLine[] {
  const quantity = clampQuantity(incoming.quantity ?? 1)
  if (quantity < 1) return lines
  const candidate: DraftLine = {
    key: incoming.lineKey,
    menu_item_id: incoming.menu_item_id,
    quantity,
    option_ids: cleanOptions(incoming.option_ids),
    notes: cleanNote(incoming.notes),
  }
  const signature = lineSignature(candidate)
  // Se suma al renglón igual si todavía le entra; si no, va aparte (nunca se pierde una unidad).
  const twin = lines.findIndex(
    (line) => lineSignature(line) === signature && line.quantity + quantity <= MAX_QUANTITY,
  )
  if (twin >= 0) {
    return lines.map((line, i) =>
      i === twin ? { ...line, quantity: line.quantity + quantity } : line,
    )
  }
  if (lines.length >= MAX_LINES) return lines
  return [...lines, candidate]
}

/** Después de editar un renglón: si quedó igual a otro, se juntan (en el lugar del que estaba antes). */
function mergeTwin(lines: DraftLine[], lineKey: string): DraftLine[] {
  const at = lines.findIndex((line) => line.key === lineKey)
  const edited = lines[at]
  if (!edited) return lines
  const signature = lineSignature(edited)
  const twinAt = lines.findIndex(
    (line, i) =>
      i !== at &&
      lineSignature(line) === signature &&
      line.quantity + edited.quantity <= MAX_QUANTITY,
  )
  const twin = lines[twinAt]
  if (!twin) return lines
  const keep = Math.min(at, twinAt)
  const drop = Math.max(at, twinAt)
  const kept = lines[keep]
  if (!kept) return lines
  return lines
    .map((line, i) => (i === keep ? { ...kept, quantity: edited.quantity + twin.quantity } : line))
    .filter((_, i) => i !== drop)
}

function patchLine(
  draft: Draft,
  lineKey: string,
  patch: (line: DraftLine) => DraftLine | null,
): Draft {
  if (!draft.lines.some((line) => line.key === lineKey)) return draft
  const lines: DraftLine[] = []
  for (const line of draft.lines) {
    if (line.key !== lineKey) {
      lines.push(line)
      continue
    }
    const next = patch(line)
    if (next && next.quantity >= 1) lines.push(next)
  }
  return finish(draft.key, mergeTwin(lines, lineKey))
}

export function cartReducer(draft: Draft, action: CartAction): Draft {
  switch (action.type) {
    case 'add': {
      const lines = addLine(draft.lines, action)
      if (lines === draft.lines) return draft
      return { key: draft.key ?? action.draftKey, lines }
    }
    case 'add_many': {
      let lines = draft.lines
      for (const line of action.lines) lines = addLine(lines, line)
      if (lines === draft.lines) return draft
      return { key: draft.key ?? action.draftKey, lines }
    }
    case 'inc':
      return patchLine(draft, action.lineKey, (line) => ({
        ...line,
        quantity: Math.min(MAX_QUANTITY, line.quantity + 1),
      }))
    case 'dec':
      return patchLine(draft, action.lineKey, (line) => ({ ...line, quantity: line.quantity - 1 }))
    case 'dec_item': {
      const last = [...draft.lines]
        .reverse()
        .find((line) => line.menu_item_id === action.menu_item_id)
      if (!last) return draft
      return patchLine(draft, last.key, (line) => ({ ...line, quantity: line.quantity - 1 }))
    }
    case 'set_quantity':
      return patchLine(draft, action.lineKey, (line) => ({
        ...line,
        quantity: clampQuantity(action.quantity),
      }))
    case 'set_options':
      return patchLine(draft, action.lineKey, (line) => ({
        ...line,
        option_ids: cleanOptions(action.option_ids),
      }))
    case 'set_note':
      return patchLine(draft, action.lineKey, (line) => ({
        ...line,
        notes: cleanNote(action.notes),
      }))
    case 'edit':
      return patchLine(draft, action.lineKey, (line) => ({
        ...line,
        quantity: action.quantity === undefined ? line.quantity : clampQuantity(action.quantity),
        option_ids:
          action.option_ids === undefined ? line.option_ids : cleanOptions(action.option_ids),
        notes: action.notes === undefined ? line.notes : cleanNote(action.notes),
      }))
    case 'remove':
      return patchLine(draft, action.lineKey, () => null)
    case 'clear':
      return EMPTY_DRAFT
    case 'restore':
      return finish(action.draft.key, action.draft.lines)
  }
}

/** Cuántas unidades de cada producto hay en el borrador (la cantidad que muestra la carta). */
export function quantityByItem(draft: Draft): Map<string, number> {
  const out = new Map<string, number>()
  for (const line of draft.lines) {
    out.set(line.menu_item_id, (out.get(line.menu_item_id) ?? 0) + line.quantity)
  }
  return out
}

export type PricedLine = {
  line: DraftLine
  name: string
  /** Precio de una unidad con sus aclaraciones, en centavos. */
  unit_cents: number
  total_cents: number
  modifiers: { id: string; label: string; delta_cents: number }[]
  /** Ya no está en la carta (lo sacaron mientras se armaba el pedido). */
  missing: boolean
  sold_out: boolean
}

export type DraftTotals = {
  lines: PricedLine[]
  /** Unidades en total: lo que cuenta el botón «Enviar a cocina · N». */
  units: number
  total_cents: number
  /** Hay algo que el servidor va a rebotar: un agotado o un producto que ya no está. */
  blocked: boolean
}

/** El borrador con nombres y precios de la carta de hoy. La plata, siempre en centavos enteros. */
export function priceDraft(draft: Draft, index: MenuIndex): DraftTotals {
  let units = 0
  let total = 0
  let blocked = false
  const lines = draft.lines.map((line): PricedLine => {
    const item = index.items.get(line.menu_item_id)
    const modifiers = line.option_ids.flatMap((id) => {
      const found = index.options.get(id)
      return found ? [{ id, label: found.option.label, delta_cents: found.option.delta_cents }] : []
    })
    const unit = (item?.price_cents ?? 0) + modifiers.reduce((sum, m) => sum + m.delta_cents, 0)
    const lineTotal = unit * line.quantity
    units += line.quantity
    total += lineTotal
    const missing = !item
    const soldOut = item?.sold_out ?? false
    if (missing || soldOut) blocked = true
    return {
      line,
      name: item?.name ?? 'Producto que ya no está en la carta',
      unit_cents: unit,
      total_cents: lineTotal,
      modifiers,
      missing,
      sold_out: soldOut,
    }
  })
  return { lines, units, total_cents: total, blocked }
}

/** Lo que viaja al servidor. */
export function toOrderLines(draft: Draft): OrderLineInput[] {
  return draft.lines.map((line) => ({
    menu_item_id: line.menu_item_id,
    quantity: line.quantity,
    option_ids: [...line.option_ids],
    notes: line.notes,
  }))
}
