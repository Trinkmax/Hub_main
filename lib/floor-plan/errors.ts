// Mapa de errores Postgres (raise exception de los RPC fp_* + violaciones de
// constraint) → mensajes accionables en es-AR. Se usa en lib/floor-plan/actions.ts
// tras cada RPC/write fallido. No expone PII ni el message crudo al usuario.
//
// En pantalla un área es un «sector» (un piso y un sector son lo mismo para el
// sistema: «Planta alta», «Terraza», «Salón»).

export const PG_ERROR_MESSAGES: Record<string, string> = {
  table_has_open_session:
    'La mesa tiene una sesión abierta. Cerrá o cobrá la sesión antes de continuar.',
  table_has_history: 'La mesa tiene historial. Desactivala en vez de borrarla.',
  area_has_active_tables:
    'El sector tiene mesas. Quitalas del plano o pasalas a otro sector antes de borrarlo.',
  cannot_delete_last_area: 'No podés borrar el único sector. Creá otro antes.',
  cross_tenant_merge: 'No se pueden combinar mesas de locales distintos.',
  fp_table_inactive: 'La mesa está inactiva.',
  owner_required: 'No tenés permiso para esta acción.',
}

/** Dos sectores de la misma sucursal no pueden llamarse igual. */
export const SECTOR_NAME_TAKEN = 'Ya existe un sector con ese nombre. Probá con otro.'

// El nombre de un sector es único por sucursal (`floor_plan_areas_branch_name_uidx`,
// migración pos_sucursales). Antes lo era por bar (`…_tenant_name_uidx`): se
// reconocen los dos por si queda alguna base sin migrar.
const SECTOR_NAME_INDEXES = [
  'floor_plan_areas_branch_name_uidx',
  'floor_plan_areas_tenant_name_uidx',
] as const

const GENERIC = 'No se pudo completar la acción. Probá de nuevo.'

export function mapPgError(error: { message?: string } | null | undefined): string {
  const message = error?.message
  if (!message) return GENERIC

  // Caso especial: una mesa solo puede tener un elemento (índice 1:1).
  if (message.includes('floor_plan_elements_pt_uidx')) {
    return 'La mesa ya está ubicada en el plano.'
  }

  if (SECTOR_NAME_INDEXES.some((index) => message.includes(index))) {
    return SECTOR_NAME_TAKEN
  }

  for (const key of Object.keys(PG_ERROR_MESSAGES)) {
    if (message.includes(key)) {
      return PG_ERROR_MESSAGES[key] as string
    }
  }

  return GENERIC
}
