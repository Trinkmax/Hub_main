import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { type DoorFunction, doorFunctionSchema } from './door'

// biome-ignore lint/suspicious/noExplicitAny: funciones nuevas, sin tipos generados todavía
type SBAny = any

/**
 * Las funciones de hoy, con cuántos entraron. Si falla, la puerta sigue andando
 * sin el cartel: lo importante es poder escanear.
 */
export async function getDoorToday(tenantId: string): Promise<DoorFunction[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('ticket_door_today', { p_tenant_id: tenantId })
  if (error) {
    console.error('[ticketing.getDoorToday]', { tenantId, code: error.code })
    return []
  }
  const parsed = z.array(doorFunctionSchema).safeParse(data)
  if (!parsed.success) {
    console.error('[ticketing.getDoorToday] la base devolvió algo inesperado')
    return []
  }
  return parsed.data
}
