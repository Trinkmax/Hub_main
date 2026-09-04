/**
 * Mapea códigos de error del SQL/RPC a mensajes amigables en español rioplatense.
 */
export function humanizeSalonError(message: string): string {
  if (!message) return 'No pudimos completar la acción.'
  const m = message.toLowerCase()

  // Coherencia fecha ↔ evento (trigger trg_validate_reservation_event_date).
  // Van ANTES de los `event_not_found` / `tenant_mismatch` genéricos de abajo,
  // que si no se los comen por substring. La fecha viaja pegada al código como
  // `reservation_event_date_mismatch:DD/MM/YYYY` — mostramos DD/MM, que es como
  // habla el bar.
  if (m.includes('reservation_event_date_mismatch')) {
    const eventDate = parseMismatchDate(message)
    return eventDate
      ? `La fecha no coincide con el evento (el evento es del ${eventDate}).`
      : 'La fecha no coincide con la del evento programado.'
  }
  if (m.includes('reservation_event_not_found'))
    return 'El evento programado ya no existe. Elegí otro.'
  if (m.includes('reservation_event_tenant_mismatch')) return 'Ese evento es de otro local.'

  if (m.includes('forbidden')) return 'No tenés permiso para esa acción.'
  if (m.includes('unauthenticated')) return 'Iniciá sesión de nuevo.'
  if (m.includes('reservation_not_found')) return 'La reserva no existe.'
  if (m.includes('illegal_transition')) return 'No se puede cambiar a ese estado desde el actual.'
  if (m.includes('invalid_guests')) return 'La cantidad de personas es inválida.'
  if (m.includes('customer_invalid')) return 'El cliente no pertenece a este bar.'
  if (m.includes('duplicate key') && m.includes('display_name'))
    return 'Ya existe un gestor con ese nombre.'
  if (m.includes('cake_options_name_unique'))
    return 'Ya tenés una torta con ese nombre. Poné otro (ej. "Opción 4").'
  // FK `restrict`: la opción ya está elegida en alguna reserva. Borrarla dejaría
  // a la cocina sin saber qué torta hacer, así que se desactiva en vez de borrar.
  if (m.includes('salon_reservations_cake_option_id_fkey'))
    return 'Esa torta ya está elegida en reservas cargadas. Desactivala en vez de borrarla.'
  if (m.includes('cake_options_fillings_len')) return 'Cada torta lleva entre 1 y 4 rellenos.'
  // La action ya limpia la opción cuando bajan las tortas a 0; esto cubre el
  // payload viejo de una pestaña que quedó abierta.
  if (m.includes('salon_reservations_cake_option_needs_cake'))
    return 'Elegiste una torta pero la reserva quedó en 0 tortas. Volvé a marcar que lleva torta.'
  if (m.includes('duplicate key') && m.includes('template_id, event_date'))
    return 'Ya hay un evento programado de ese tipo para ese día.'
  if (m.includes('exclusion violation') && m.includes('commission_rate_tiers_no_overlap'))
    return 'El rango de personas se solapa con otro tier activo.'
  if (m.includes('check constraint') || m.includes('violates check'))
    return 'Algún campo tiene un valor fuera de rango.'
  if (m.includes('event_not_found')) return 'El evento no existe.'
  if (m.includes('event_not_open')) return 'El evento no está publicado.'
  if (m.includes('tenant_mismatch')) return 'El evento es de otro local.'
  if (m.includes('guests_exceed_capacity'))
    return 'La cantidad de personas supera el cupo del evento.'
  if (m.includes('capacity_reached')) return 'El evento está lleno y no admite lista de espera.'
  if (m.includes('relink_requires_unlink')) return 'No se pudo reasignar el evento. Probá de nuevo.'
  if (m.includes('foreign key')) return 'Referencia inválida (gestor o evento inexistente).'
  return 'No pudimos completar la acción.'
}

/**
 * Saca el `DD/MM` de un `reservation_event_date_mismatch:DD/MM/YYYY`. El
 * mensaje real de Postgres llega envuelto en más texto, así que buscamos el
 * patrón en vez de cortar por el `:`.
 */
function parseMismatchDate(message: string): string | null {
  const match = /reservation_event_date_mismatch:(\d{2})\/(\d{2})\/(\d{4})/.exec(message)
  if (!match) return null
  return `${match[1]}/${match[2]}`
}

/**
 * Arma el código que entiende `humanizeSalonError` para el mismatch de fecha,
 * a partir de un `event_date` en formato `yyyy-MM-dd`. Lo usa la Server Action
 * para adelantar el error ANTES de llegar al trigger — mismo texto, sin gastar
 * un round-trip de excepción.
 */
export function eventDateMismatchCode(eventDateIso: string): string {
  const [y, m, d] = eventDateIso.split('-')
  return `reservation_event_date_mismatch:${d}/${m}/${y}`
}
