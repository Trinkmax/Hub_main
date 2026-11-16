import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getSupabaseClientEnv } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'
import { parseMenuRev } from './freshness'

/**
 * La versión de la carta de cada bar (`public.menu_revisions`, migración
 * 20261115225854_menu_revisions). Sube sola con cualquier cambio del menú o a mano con
 * `menu_force_refresh`. Ver docs/features/carta-al-dia.md.
 */

/** Lo que muestra el editor de la carta junto al botón «Actualizar en los celulares». */
export type MenuRevisionStatus = {
  rev: number
  /** Último cambio de la carta (ISO). */
  changedAt: string
  /** Última vez que alguien tocó «Actualizar ahora» (ISO), o `null`. */
  forcedAt: string | null
}

/**
 * Cliente sin sesión (rol `anon`), solo para `carta_menu_rev`.
 *
 * No el de servicio: la tabla no tiene GRANT para `service_role` y Supabase retira los default
 * privileges desde el 30/10/2026 (ver 20261026120100_ticketing_tables), así que leerla con service
 * podría dar 42501. La función sí tiene EXECUTE explícito para `anon` y es la MISMA que pregunta el
 * celular: el número del render y el del chequeo salen del mismo lugar (0 si el bar no tiene fila).
 */
function createAnonClient() {
  const { url, anonKey } = getSupabaseClientEnv()
  return createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Versión con la que se arma la carta pública. Nunca rompe la carta: si falla devuelve 0 y lo
 * loguea; el celular, al preguntar, se refresca una sola vez (el número nuevo le queda de base).
 */
export async function getMenuRev(tenantId: string): Promise<number> {
  try {
    const { data, error } = await createAnonClient().rpc('carta_menu_rev', { p_tenant: tenantId })
    if (error) {
      console.error('[menu.getMenuRev]', error.code, error.message)
      return 0
    }
    const rev = parseMenuRev(data)
    if (rev === null) {
      console.error('[menu.getMenuRev] respuesta inesperada', typeof data)
      return 0
    }
    return rev
  } catch (error) {
    console.error('[menu.getMenuRev]', error instanceof Error ? error.message : 'error desconocido')
    return 0
  }
}

const statusRowSchema = z.object({
  rev: z.coerce.number().int().nonnegative(),
  changed_at: z.string().min(1),
  forced_at: z.string().min(1).nullable(),
})

/**
 * Estado para el editor, con la sesión de quien mira (la RLS deja leer a dueño y Contenido).
 * `null` si el bar todavía no tiene fila o no se pudo leer: el botón sigue andando igual.
 */
export async function getMenuRevisionStatus(tenantId: string): Promise<MenuRevisionStatus | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_revisions')
    .select('rev, changed_at, forced_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('[menu.getMenuRevisionStatus]', error.code, error.message)
    return null
  }
  if (!data) return null
  const parsed = statusRowSchema.safeParse(data)
  if (!parsed.success) {
    console.error('[menu.getMenuRevisionStatus] fila inesperada', parsed.error.issues[0]?.path)
    return null
  }
  return {
    rev: parsed.data.rev,
    changedAt: parsed.data.changed_at,
    forcedAt: parsed.data.forced_at,
  }
}
