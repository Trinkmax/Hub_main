/**
 * Qué parte de la cuenta se cobra ahora — PURO.
 *
 * Cuatro maneras, las que se usan en una mesa de verdad: todo junto, en partes iguales, cada uno lo
 * suyo (por producto) o un monto suelto. De la manera elegida y de la cuenta que manda la base sale
 * cuánto es este cobro, con qué rótulo queda anotado y si con él la mesa se cierra.
 *
 * Lo elegido vive en el celular; la cuenta, en la base. Cuando llega una cuenta nueva (otro celular
 * cobró, se aprobó un descuento) lo elegido se pone al día acá, sin inventar plata.
 */
import { byProductAmount, picksToItemIds } from '@/lib/pos/cash/bill'
import type { Bill } from '@/lib/pos/cash/types'
import {
  type Chosen,
  chosenLabel,
  chosenUnits,
  expandChosen,
  freeUnits,
  type LineGroup,
  pruneChosen,
} from './lines'
import { clampParts, nextPart, resumeParts } from './plan'

export type Split =
  | { kind: 'all' }
  | { kind: 'equal'; parts: number }
  | { kind: 'items'; chosen: Chosen }
  | { kind: 'amount'; cents: number | null }

export type SplitKind = Split['kind']

type BillLike = Pick<Bill, 'bill' | 'payments' | 'lines'>

export type Portion = {
  /** Lo que este cobro baja de la cuenta. 0 = todavía no hay nada elegido. */
  amountCents: number
  /** «Parte 2 de 4», «2 Mojito + 1 Lomito»: viaja con el cobro. `null` = sin rótulo. */
  label: string | null
  /** Cómo se nombra en pantalla: «toda la cuenta», «Parte 2 de 4», «3 productos». */
  title: string
  /** División por producto: el renglón repetido una vez por unidad. */
  itemIds: string[]
  /** Con este cobro no queda nada por cobrar: la mesa se cierra sola. */
  closes: boolean
}

/** Cuánto es este cobro, según cómo se divide. */
export function portionOf(split: Split, bill: BillLike, groups: ReadonlyArray<LineGroup>): Portion {
  const remaining = Math.max(0, bill.bill.remaining_cents)
  const done = (amountCents: number, label: string | null, title: string, itemIds: string[]) => ({
    amountCents,
    label,
    title,
    itemIds,
    closes: amountCents > 0 && amountCents === remaining,
  })

  if (split.kind === 'equal') {
    const part = nextPart(split.parts, bill.payments, remaining)
    return done(part.amountCents, part.label, part.label, [])
  }
  if (split.kind === 'items') {
    const picks = expandChosen(groups, split.chosen)
    const units = chosenUnits(groups, split.chosen)
    const title = units === 0 ? 'por producto' : units === 1 ? '1 producto' : `${units} productos`
    if (units === 0) return done(0, null, title, [])
    return done(
      byProductAmount(bill.lines, picks, bill.bill),
      chosenLabel(groups, split.chosen),
      title,
      picksToItemIds(picks),
    )
  }
  if (split.kind === 'amount') {
    const cents = split.cents !== null && split.cents > 0 ? Math.min(split.cents, remaining) : 0
    return done(cents, null, 'una parte', [])
  }
  return done(
    remaining,
    null,
    bill.bill.paid_cents > 0 ? 'todo lo que falta' : 'toda la cuenta',
    [],
  )
}

/** Con qué división arranca la pantalla: si la mesa ya venía en partes iguales, sigue así. */
export function initialSplit(bill: BillLike): Split {
  const parts = resumeParts(bill.payments, bill.bill.remaining_cents)
  return parts === null ? { kind: 'all' } : { kind: 'equal', parts }
}

/**
 * Lo elegido, puesto al día con una cuenta nueva. Devuelve el mismo objeto si no hay nada que
 * cambiar (así la pantalla no se vuelve a dibujar de gusto).
 */
export function reconcileSplit(
  split: Split,
  bill: BillLike,
  groups: ReadonlyArray<LineGroup>,
): Split {
  const remaining = Math.max(0, bill.bill.remaining_cents)
  if (split.kind === 'all') {
    // Otro celular empezó a cobrar por partes: esta pantalla sigue el mismo plan.
    const parts = resumeParts(bill.payments, remaining)
    return parts === null ? split : { kind: 'equal', parts }
  }
  if (split.kind === 'equal') {
    const parts = clampParts(split.parts, bill.payments)
    return parts === split.parts ? split : { kind: 'equal', parts }
  }
  if (split.kind === 'items') {
    // Ya no queda nada que elegir: lo que falta se cobra junto.
    if (freeUnits(groups) === 0) return { kind: 'all' }
    const chosen = pruneChosen(groups, split.chosen)
    return chosen === split.chosen ? split : { kind: 'items', chosen }
  }
  // Lo que se había escrito ya no entra en lo que falta: se vuelve a preguntar.
  if (split.cents !== null && split.cents > remaining) return { kind: 'amount', cents: null }
  return split
}
