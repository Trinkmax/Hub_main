// Mapa de errores Postgres (raise exception de los RPC fp_* + violaciones de
// constraint) → mensajes accionables en es-AR. Se usa en lib/floor-plan/actions.ts
// tras cada RPC/write fallido. No expone PII ni el message crudo al usuario.

export const PG_ERROR_MESSAGES: Record<string, string> = {
  table_has_open_session:
    'La mesa tiene una sesión abierta. Cerrá o cobrá la sesión antes de continuar.',
  table_has_history: 'La mesa tiene historial. Desactivala en vez de borrarla.',
  area_has_active_tables:
    'El área tiene mesas activas. Movélas o desactivalas antes de borrar el área.',
  cannot_delete_last_area: 'No podés borrar la única área. Creá otra antes.',
  cross_tenant_merge: 'No se pueden combinar mesas de locales distintos.',
  fp_table_inactive: 'La mesa está inactiva.',
  owner_required: 'No tenés permiso para esta acción.',
}

const GENERIC = 'No se pudo completar la acción. Probá de nuevo.'

export function mapPgError(error: { message?: string } | null | undefined): string {
  const message = error?.message
  if (!message) return GENERIC

  // Caso especial: una mesa solo puede tener un elemento (índice 1:1).
  if (message.includes('floor_plan_elements_pt_uidx')) {
    return 'La mesa ya está ubicada en el plano.'
  }

  for (const key of Object.keys(PG_ERROR_MESSAGES)) {
    if (message.includes(key)) {
      return PG_ERROR_MESSAGES[key] as string
    }
  }

  return GENERIC
}
