import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SETTINGS_COLUMNS, type SettingsRow, settingsFromRow } from './row'
import type { PosSettings } from './types'

/**
 * Las lecturas de los ajustes del punto de venta. Van con el cliente del usuario (RLS): los
 * lee quien trabaja en el bar y los escribe solo el dueño.
 *
 * `pos_settings` todavía no está en `types/database.ts` (se regenera aparte), así que se lee
 * con un cliente sin tipar y se tipa acá, igual que en `lib/pos/queries.ts`.
 */
export async function untypedClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export class SettingsReadError extends Error {
  constructor() {
    super('pos_settings_read_failed')
    this.name = 'SettingsReadError'
  }
}

/**
 * Los ajustes del bar y la versión de su fila (`null` si el bar todavía no cambió nada y
 * valen los de fábrica).
 */
export async function readPosSettings(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ settings: PosSettings; version: string | null }> {
  const { data, error } = await supabase
    .from('pos_settings')
    .select(SETTINGS_COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('[pos.settings.read]', error.code, error.message)
    throw new SettingsReadError()
  }
  const row = data as SettingsRow | null
  return {
    settings: settingsFromRow(row),
    version: typeof row?.updated_at === 'string' ? row.updated_at : null,
  }
}
