import type { ReservationWithJoins } from './types'

/**
 * Payload completo para `updateSalonReservation` a partir de la fila tal cual
 * está, pisando solo lo editado.
 *
 * La action exige el objeto entero (no hay update parcial), y cada campo que
 * falte se interpreta como "no tocar" o —peor— como "vaciar" según el campo.
 * Copiar la fila fiel es la única forma de que cambiar UNA cosa desde una
 * pantalla chica (personas, hora, zona) no borre otra (avisos, torta, fin).
 *
 * `table_label` se copia también: la mesa la asigna el servicio y una edición
 * de otro dato no tiene por qué perderla.
 */
export function fullUpdatePayload(
  r: ReservationWithJoins,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: r.id,
    customer_id: r.customer_id,
    guest_name: r.guest_name,
    guest_phone: r.guest_phone,
    guest_email: r.guest_email,
    kind: r.kind,
    meal_type: r.meal_type,
    reservation_date: r.reservation_date,
    reservation_time_local: r.reservation_time_local.slice(0, 5),
    reservation_end_time_local: r.reservation_end_time_local
      ? r.reservation_end_time_local.slice(0, 5)
      : null,
    service_alerts: r.service_alerts,
    highlight_comment: r.highlight_comment,
    zone: r.zone,
    scheduled_event_id: r.scheduled_event_id,
    estimated_guests: r.estimated_guests,
    actual_guests: r.actual_guests,
    cake_count: r.cake_count,
    cake_option_id: r.cake_option_id,
    champagne_count: r.champagne_count,
    deposit_cents: r.deposit_cents,
    origin: r.origin,
    primary_manager_id: r.primary_manager_id,
    assistant_manager_id: r.assistant_manager_id,
    comments: r.comments,
    table_label: r.table_label,
    ...patch,
  }
}
