/**
 * El marco de selección — PURO y testeado.
 *
 * La cocina tiene dos botones: «Siguiente» mueve el marco y «Avanzar» actúa
 * sobre lo que está enmarcado. El marco existe siempre que haya comandas, y
 * descansa en la más vieja sin terminar: es lo próximo que tiene que salir.
 *
 * El recorrido tiene tres tramos, siempre en orden de llegada dentro de cada uno:
 *   1. las comandas a la carta sin terminar (el riel);
 *   2. las listas (para deshacer);
 *   3. las mesas del evento, si hay uno.
 */
import type { KitchenCard } from './cards'

export type SelectionModel = {
  /** El recorrido completo de «Siguiente». */
  order: string[]
  /** A la carta, sin terminar: lo que cuelga del riel. */
  active: string[]
  /** A la carta, listas. */
  done: string[]
  /** Mesas del evento, todas (las listas se quedan en su lugar). */
  event: string[]
  /** Mesas del evento sin terminar. */
  eventOpen: string[]
}

export function selectionModel(
  alaCarte: readonly KitchenCard[],
  eventCards: readonly KitchenCard[],
): SelectionModel {
  const active = alaCarte.filter((card) => card.status !== 'ready').map((card) => card.id)
  const done = alaCarte.filter((card) => card.status === 'ready').map((card) => card.id)
  const event = eventCards.map((card) => card.id)
  const eventOpen = eventCards.filter((card) => card.status !== 'ready').map((card) => card.id)
  return { order: [...active, ...done, ...event], active, done, event, eventOpen }
}

/** «Siguiente»: la que sigue en el recorrido; después de la última vuelve a la primera. */
export function nextSelection(order: readonly string[], current: string | null): string | null {
  if (order.length === 0) return null
  const at = current === null ? -1 : order.indexOf(current)
  return order[(at + 1) % order.length] ?? null
}

/**
 * Dónde descansa el marco: la comanda más vieja sin terminar. Primero las de la
 * carta (salvo que se venga trabajando en el evento); si no queda nada sin
 * terminar, la primera del recorrido, para que el marco no desaparezca.
 */
export function restingSelection(
  model: SelectionModel,
  options: { prefer?: 'carta' | 'event'; except?: string | null } = {},
): string | null {
  const skip = (id: string) => id !== options.except
  const carta = model.active.find(skip)
  const event = model.eventOpen.find(skip)
  const first = options.prefer === 'event' ? (event ?? carta) : (carta ?? event)
  return first ?? model.order.find(skip) ?? model.order[0] ?? null
}

/**
 * A dónde va el marco después de marcar una comanda como lista: vuelve solo a
 * la más vieja sin terminar del mismo lado (carta o evento). Si era la última,
 * se queda en ella.
 */
export function selectionAfterReady(model: SelectionModel, finished: string): string | null {
  const prefer = model.event.includes(finished) ? 'event' : 'carta'
  const carta = model.active.find((id) => id !== finished)
  const event = model.eventOpen.find((id) => id !== finished)
  const next = prefer === 'event' ? (event ?? carta) : (carta ?? event)
  return next ?? (model.order.includes(finished) ? finished : (model.order[0] ?? null))
}

/**
 * El marco cuando la cola cambia sola. Si la comanda enmarcada sigue, no se
 * mueve (aunque haya cambiado de estado o hayan entrado otras). Si se fue
 * (la sirvieron, la anularon, venció), pasa a la que venía después; y si no
 * había ninguna después, a donde descansa.
 */
export function reconcileSelection(
  previousOrder: readonly string[],
  model: SelectionModel,
  current: string | null,
): string | null {
  if (model.order.length === 0) return null
  if (current !== null && model.order.includes(current)) return current
  if (current !== null) {
    const was = previousOrder.indexOf(current)
    if (was >= 0) {
      const alive = new Set(model.order)
      for (let i = was + 1; i < previousOrder.length; i++) {
        const id = previousOrder[i]
        if (id !== undefined && alive.has(id)) return id
      }
    }
  }
  return restingSelection(model)
}

/**
 * Qué tramo del riel se ve cuando hay más comandas que lugares. El riel tiene
 * `slots` lugares; una comanda muy larga ocupa dos (`spanOf`). Devuelve desde
 * cuál se muestra y cuántas entran.
 *
 * Arranca en la más vieja y solo se corre lo justo para que la comanda enmarcada
 * quede a la vista. Cuando el marco se va del riel (a una lista, al evento), el
 * riel vuelve a la más vieja: lo que hay que sacar primero nunca queda escondido
 * por haber pasado de largo.
 */
export function railView(
  active: readonly string[],
  slots: number,
  previousStart: number,
  selected: string | null,
  spanOf: (id: string) => number = () => 1,
): { start: number; count: number } {
  const size = Math.max(1, Math.floor(slots))
  const span = (index: number) => {
    const id = active[index]
    const wanted = id === undefined ? 1 : Math.floor(spanOf(id))
    return Math.min(size, Math.max(1, wanted || 1))
  }
  /** Cuántas entran empezando en `from` (siempre al menos una). */
  const countFrom = (from: number) => {
    let used = 0
    let count = 0
    for (let i = from; i < active.length; i++) {
      if (count > 0 && used + span(i) > size) break
      used += span(i)
      count += 1
    }
    return count
  }
  // Lo más a la derecha que tiene sentido arrancar: desde ahí ya se ve hasta la última.
  let last = Math.max(0, active.length - 1)
  while (last > 0 && last - 1 + countFrom(last - 1) >= active.length) last -= 1

  const at = selected === null ? -1 : active.indexOf(selected)
  if (at < 0) return { start: 0, count: countFrom(0) }
  let start = Math.min(Math.max(0, Math.floor(previousStart) || 0), last)
  if (at < start) start = at
  else while (at >= start + countFrom(start)) start += 1
  return { start, count: countFrom(start) }
}
