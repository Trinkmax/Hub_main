/**
 * «Repetir la ronda» — PURO.
 *
 * La ronda es lo último que la mesa pidió para tomar. La regla:
 *   1. se recorren las tandas que ya salieron, de la más nueva a la más vieja (las que están en espera
 *      no cuentan: todavía no se tomaron nada);
 *   2. de cada una se miran los renglones en pie que son de la barra (ver `isDrink`);
 *   3. la primera tanda que tenga alguno es la ronda, aunque después hayan pedido comida.
 * Se repite tal cual salió: mismas cantidades, mismas aclaraciones (las que sigan existiendo) y misma
 * nota. Lo que hoy está agotado o ya no está en la carta se saltea; si no queda nada, no hay ronda
 * (no se va a buscar una más vieja: «la ronda» es la última, no cualquiera).
 */
import type { SessionTicket } from '@/lib/pos/types'
import { isDrink, type MenuIndex, validOptionIds } from './menu-index'

export type RoundLine = {
  menu_item_id: string
  name: string
  quantity: number
  option_ids: string[]
  notes: string | null
}

export type Round = {
  ticketId: string
  lines: RoundLine[]
  /** Unidades en total. */
  units: number
  /** Lo que tenía la ronda y hoy no se puede pedir. */
  skipped: string[]
}

export function pickRepeatRound(tickets: readonly SessionTicket[], index: MenuIndex): Round | null {
  const sent = tickets
    .filter((ticket) => ticket.fired_at !== null)
    .sort((a, b) => Date.parse(b.fired_at ?? '') - Date.parse(a.fired_at ?? ''))

  for (const ticket of sent) {
    const drinks = ticket.items.filter((line) => {
      if (line.cancelled_at) return false
      const item = index.items.get(line.menu_item_id)
      // Si el producto ya no está en la carta, vale la estación con la que salió.
      return isDrink(index, item ?? { station_id: line.station_id, category_id: '' })
    })
    if (drinks.length === 0) continue

    const lines: RoundLine[] = []
    const skipped: string[] = []
    for (const line of drinks) {
      const item = index.items.get(line.menu_item_id)
      if (!item || item.sold_out) {
        skipped.push(line.name)
        continue
      }
      lines.push({
        menu_item_id: item.id,
        name: item.name,
        quantity: line.quantity,
        option_ids: validOptionIds(
          index,
          item.id,
          line.modifiers.map((m) => m.id),
        ),
        notes: line.notes,
      })
    }
    if (lines.length === 0) return null
    return {
      ticketId: ticket.id,
      lines,
      units: lines.reduce((sum, line) => sum + line.quantity, 0),
      skipped,
    }
  }
  return null
}

/** «8 Mojito · 2 Fernet»: lo que dice el botón antes de tocarlo. */
export function roundLabel(round: Round): string {
  return round.lines.map((line) => `${line.quantity} ${line.name}`).join(' · ')
}
