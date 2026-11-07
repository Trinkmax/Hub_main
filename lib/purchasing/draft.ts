/**
 * Un borrador con los cambios de quien compra, y el WhatsApp que saldría al mandarlo. Puro.
 *
 * Es la misma cuenta que hace `approveOrder` después de guardar los cambios: las líneas que ya estaban
 * (en su orden), las que se suman al final, la entrega de `effectiveDeliveryDate` y `orderMessage`. Tex
 * la usa para armar el tique y, al confirmar, para verificar que el mensaje que se abrió en WhatsApp es
 * el que queda guardado.
 */
import { effectiveDeliveryDate } from './dates'
import type { PurItem, PurOrder, PurSupplier } from './types'
import { roundQty } from './units'
import { orderMessage } from './whatsapp'

export type DraftEdit = {
  /** Lo nuevo de cada renglón, por id (`null` = a definir). Los que no están quedan como estaban. */
  packs: ReadonlyMap<string, number | null>
  /** Lo que se suma, en este orden: va al final del pedido. */
  added: ReadonlyArray<{
    item: Pick<PurItem, 'id' | 'name' | 'unit' | 'packLabel' | 'packSize'>
    packs: number
  }>
  /** La nota para el proveedor, tal como queda. */
  note: string | null
}

export type DraftLine = {
  /** `null`: se suma recién al guardar. */
  lineId: string | null
  itemId: string | null
  name: string
  unit: string
  packLabel: string | null
  packSize: number | null
  /** Lo que se pide, en presentaciones. `null` = a definir; 0 = no se pide. */
  packs: number | null
}

export type DraftOutcome = {
  lines: DraftLine[]
  /** Lo que va en el WhatsApp: más de 0. */
  toOrder: DraftLine[]
  /** Sin cantidad: así no se puede mandar. */
  undefinedNames: string[]
  expectedDate: string | null
  message: string
}

export const NO_EDIT: DraftEdit = { packs: new Map(), added: [], note: null }

export function draftOutcome(input: {
  order: Pick<PurOrder, 'lines' | 'expectedDate'>
  supplier: Pick<PurSupplier, 'contactName' | 'deliveryWeekdays' | 'leadDays'> | null
  edit: DraftEdit
  /** Quién firma: el nombre de los ajustes de Compras o, si no hay, el del bar. */
  senderName: string
  today: string
}): DraftOutcome {
  const { order, supplier, edit } = input
  const lines: DraftLine[] = [
    ...order.lines.map((l) => ({
      lineId: l.id,
      itemId: l.itemId,
      name: l.name,
      unit: l.unit,
      packLabel: l.packLabel,
      packSize: l.packSize,
      packs: edit.packs.has(l.id) ? (edit.packs.get(l.id) ?? null) : l.orderedPacks,
    })),
    ...edit.added.map((a) => ({
      lineId: null,
      itemId: a.item.id,
      name: a.item.name,
      unit: a.item.unit,
      packLabel: a.item.packLabel,
      packSize: a.item.packSize,
      packs: a.packs,
    })),
  ]
  const toOrder = lines.filter((l) => (l.packs ?? 0) > 0)
  const expectedDate = effectiveDeliveryDate(order.expectedDate, supplier, input.today)
  const message = orderMessage({
    senderName: input.senderName,
    contactName: supplier?.contactName ?? null,
    expectedDate,
    lines: toOrder.map((l) => ({
      name: l.name,
      packs: l.packs ?? 0,
      packLabel: l.packLabel,
      packSize: l.packSize,
      unit: l.unit,
    })),
    note: edit.note,
  })
  return {
    lines,
    toOrder,
    undefinedNames: lines.filter((l) => l.packs == null).map((l) => l.name),
    expectedDate,
    message,
  }
}

/**
 * Una cantidad como la guarda la base (`numeric(12, 3)`): si el tique mostrara más decimales, el
 * mensaje guardado no sería el que se abrió.
 */
export function packsAsStored(packs: number): number {
  return roundQty(packs)
}
