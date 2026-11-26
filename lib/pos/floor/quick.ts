/**
 * La ficha de una mesa en el mapa: lo que se puede hacer YA, sin entrar a la mesa — PURO y testeado
 * (`tests/lib/pos-floor-quick.test.ts`).
 *
 * Por qué (25/11/2026, Nacho): «si yo toco en una mesa, poder tener la acción rápida, para que no se me abra
 * un menú completo o cambiar de pantalla para marcar servida una comida». Tocar una mesa ocupada ya no entra
 * a la comanda: la elige, y abajo aparece una ficha chica con lo mismo que manda en la barra de la comanda
 * (`barPrimary` en `lib/pos/order/tickets.ts`), con las mismas palabras y en el mismo orden:
 *   hay comida para retirar            → «Servido»
 *   pidieron la cuenta                 → «Cobrar»
 *   hay una tanda esperando y cocina libre → «Marchar tanda»
 *   nada pendiente                     → «Agregar»
 * «Cuenta» y «Agregar» están siempre. Entrar a la comanda es tocar la mesa otra vez (o el encabezado).
 *
 * Dos fuentes, con papeles distintos:
 *   · el MAPA (en vivo) decide QUÉ se ofrece: es lo que se ve pintado en la mesa, y nunca se contradicen;
 *   · el DETALLE de la mesa (se lee al elegirla) solo lo completa: cuántas unidades, qué productos, qué
 *     tanda. Si todavía no llegó o ya no coincide con el mapa, la ficha anda igual, sin esos datos.
 */
import { summarizeSession, tandaNumbers, unitsLabel } from '@/lib/pos/order/tickets'
import type { TableState } from '@/lib/pos/table-state'
import type { FloorSession, SessionDetail, SessionTicket } from '@/lib/pos/types'

export type QuickPrimary =
  /** Hay comida para retirar. `units` es `null` hasta que llega el detalle (el mapa cuenta renglones). */
  | { kind: 'serve'; units: number | null; label: string }
  /** Una tanda esperando con la cocina libre. Sin detalle todavía no se sabe cuál (`ticketId: null`). */
  | { kind: 'fire'; ticketId: string | null; number: number | null; label: string }
  /** Pidieron la cuenta: lo que sigue es cobrar. */
  | { kind: 'bill' }
  /** Nada pendiente: lo que sigue es cargar. */
  | { kind: 'add' }

export type QuickCard = {
  primary: QuickPrimary
  /** Ya pidieron la cuenta: el botón de siempre dice «Ver cuenta». */
  billOn: boolean
}

/** «2 Lomo · 1 Papas»: lo que lleva una tanda, sin lo dado de baja. */
function ticketLabel(ticket: Pick<SessionTicket, 'items'>): string {
  return unitsLabel(ticket.items.filter((item) => item.cancelled_at === null))
}

/** La tanda que se marcharía y su número, según el detalle de la mesa. */
export function nextHeld(
  detail: Pick<SessionDetail, 'tickets'>,
): { ticketId: string; number: number | null; label: string } | null {
  const held = summarizeSession(detail.tickets).held[0]
  if (!held) return null
  const numbers = tandaNumbers(detail.tickets.map((ticket) => ticket.course))
  const index = detail.tickets.findIndex((ticket) => ticket.id === held.id)
  return { ticketId: held.id, number: numbers[index] ?? null, label: ticketLabel(held) }
}

export function quickCard(
  session: Pick<FloorSession, 'id' | 'bill_requested_at'>,
  state: Pick<TableState, 'key' | 'nextCourseDue'>,
  detail: Pick<SessionDetail, 'session' | 'tickets'> | null,
): QuickCard {
  const billOn = session.bill_requested_at !== null
  // El detalle de otra mesa (se cambió de mesa mientras llegaba) no completa nada.
  const mine = detail !== null && detail.session.id === session.id ? detail : null

  if (state.key === 'ready') {
    const summary = mine ? summarizeSession(mine.tickets) : null
    const known = summary !== null && summary.readyUnits > 0
    return {
      billOn,
      primary: {
        kind: 'serve',
        units: known ? summary.readyUnits : null,
        label: known ? summary.readyLabel : '',
      },
    }
  }
  if (state.key === 'bill') return { billOn, primary: { kind: 'bill' } }
  if (state.nextCourseDue) {
    const held = mine ? nextHeld(mine) : null
    return {
      billOn,
      primary: {
        kind: 'fire',
        ticketId: held?.ticketId ?? null,
        number: held?.number ?? null,
        label: held?.label ?? '',
      },
    }
  }
  return { billOn, primary: { kind: 'add' } }
}

// ─── Lo que se acaba de tocar ────────────────────────────────────────────────

/** Lo que el mozo tocó en la ficha y la base todavía no confirmó. */
export type QuickPending = 'serve' | 'fire'

/**
 * La mesa como va a quedar: se ve al instante en el mapa, sin esperar a la base. Si la base dice que no,
 * la lectura siguiente la devuelve a como estaba.
 */
export function withPending(
  session: FloorSession,
  pending: QuickPending | undefined,
  nowIso: string,
): FloorSession {
  if (pending === 'serve') {
    if (session.items_ready === 0) return session
    return {
      ...session,
      items_served: session.items_served + session.items_ready,
      items_ready: 0,
      ready_since: null,
      last_served_at: nowIso,
    }
  }
  if (pending === 'fire') {
    if (session.held_tickets === 0) return session
    return {
      ...session,
      held_tickets: session.held_tickets - 1,
      // No se sabe cuántos renglones lleva la tanda; con uno alcanza para que la mesa pase a «en preparación».
      items_queued: session.items_queued + 1,
      waiting_since: session.waiting_since ?? nowIso,
      first_order_at: session.first_order_at ?? nowIso,
    }
  }
  return session
}

/**
 * Cuándo conviene volver a leer el detalle de la mesa elegida: cambia con cualquier cosa que cambie lo que
 * la ficha muestra (algo salió, algo se sirvió, se cargó o se marchó una tanda, se pidió la cuenta).
 */
export function detailKey(session: FloorSession): string {
  return [
    session.id,
    session.items_queued,
    session.items_preparing,
    session.items_ready,
    session.items_served,
    session.held_tickets,
    session.total_cents,
    session.bill_requested_at ?? '',
  ].join('|')
}
