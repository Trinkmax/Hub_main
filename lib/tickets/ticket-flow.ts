/**
 * Lógica pura de la máquina de estados de comandas, parametrizada por el flag
 * `kitchen_flow_enabled` del tenant.
 *
 * MANTENER EN PARIDAD con la matriz de `public.update_ticket_status`:
 *   accepted → preparing : flag OFF = waiter+kitchen+owner · flag ON = kitchen+owner
 *   preparing → ready     : flag OFF = waiter+kitchen+owner · flag ON = kitchen+owner
 *   ready → served        : waiter+owner (ambos modos)
 *
 * La UI del mozo usa estos helpers para decidir qué botones mostrar y así no
 * ofrecer una acción que el RPC va a rechazar.
 */

export type TicketStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled'

/**
 * Etiquetas en español (es-AR) para cada estado del enum `TicketStatus`.
 * Usar siempre este mapa en lugar de renderizar el valor crudo del enum.
 */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  preparing: 'Preparando',
  ready: 'Lista para servir',
  served: 'Servida',
  cancelled: 'Cancelada',
}

/**
 * Para el panel del MOZO: dado el estado actual y el flag, ¿a qué estado puede
 * avanzar la comanda con un botón propio? Devuelve el nuevo estado o null si el
 * mozo no tiene ninguna acción de avance en ese estado.
 *
 * - pending: el mozo confirma/rechaza con accept_ticket/reject_ticket (no acá).
 * - accepted/preparing: solo avanza si el flag está OFF (mozo dueño del flujo).
 *   Con flag ON, esos pasos son de la cocina → null.
 * - ready: el mozo entrega siempre → 'served'.
 */
export function waiterAdvanceTarget(
  status: TicketStatus,
  kitchenFlowEnabled: boolean,
): TicketStatus | null {
  switch (status) {
    case 'accepted':
      return kitchenFlowEnabled ? null : 'preparing'
    case 'preparing':
      return kitchenFlowEnabled ? null : 'ready'
    case 'ready':
      return 'served'
    default:
      return null
  }
}

/**
 * ¿La preparación (accepted→preparing→ready) le pertenece a la cocina?
 * Útil para mostrar el chip pasivo "En cocina…" en el panel del mozo.
 */
export function kitchenOwnsPrep(kitchenFlowEnabled: boolean): boolean {
  return kitchenFlowEnabled
}

/** Estados en los que, con flag ON, el mozo solo espera a la cocina. */
export function isWaitingOnKitchen(status: TicketStatus, kitchenFlowEnabled: boolean): boolean {
  return kitchenFlowEnabled && (status === 'accepted' || status === 'preparing')
}
