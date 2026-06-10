/**
 * Mapea códigos de error del SQL/RPC a mensajes amigables en español rioplatense.
 */
export function humanizeSalonError(message: string): string {
  if (!message) return 'No pudimos completar la acción.'
  const m = message.toLowerCase()
  if (m.includes('forbidden')) return 'No tenés permiso para esa acción.'
  if (m.includes('unauthenticated')) return 'Iniciá sesión de nuevo.'
  if (m.includes('reservation_not_found')) return 'La reserva no existe.'
  if (m.includes('illegal_transition')) return 'No se puede cambiar a ese estado desde el actual.'
  if (m.includes('invalid_guests')) return 'La cantidad de personas es inválida.'
  if (m.includes('customer_invalid')) return 'El cliente no pertenece a este bar.'
  if (m.includes('duplicate key') && m.includes('display_name'))
    return 'Ya existe un gestor con ese nombre.'
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
