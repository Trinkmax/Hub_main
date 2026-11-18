import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { SetupStatus } from './steps'

/**
 * Qué primeros pasos ya dio el bar (`steps.ts`). Una sola lectura para el Resumen y para Tex: antes
 * cada uno contaba lo suyo y con reglas distintas.
 *
 * Son ocho conteos «¿hay al menos uno?» en paralelo, con la sesión de la persona (las políticas de
 * cada tabla deciden qué ve). Un conteo que falla cuenta como «falta»: prefiere mostrar un paso de
 * más antes que dar por hecho algo que no se pudo leer.
 */
export async function getSetupStatus(opts: {
  tenantId: string
  /** Hoy en la zona del bar, `AAAA-MM-DD`: un evento «por venir» es de hoy en adelante. */
  today: string
  /** `tenants.settings` del bar (ya viene con el acceso). */
  settings: Record<string, unknown> | null
}): Promise<SetupStatus> {
  // Varias de estas tablas no están en los tipos generados: se cuenta sin tipar.
  const supabase = (await createClient()) as unknown as SupabaseClient
  const some = (table: string) =>
    supabase
      .from(table)
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', opts.tenantId)
      .limit(1)

  const [menu, rules, members, segmentCaps, templates, scheduled, reservations, arrived] =
    await Promise.all([
      some('menu_items'),
      some('points_rules').eq('active', true),
      // Sin `limit`: acá importa cuántos son (más de uno), no solo si hay alguno.
      supabase
        .from('memberships')
        .select('id', { head: true, count: 'exact' })
        .eq('tenant_id', opts.tenantId),
      some('salon_segment_capacities'),
      some('scheduled_event_templates').eq('active', true),
      some('scheduled_events').gte('event_date', opts.today),
      some('salon_reservations'),
      some('salon_reservations').in('status', ['arrived', 'seated', 'closed']),
    ])

  const caps = (opts.settings?.salon_capacities ?? null) as {
    planta_alta?: number
    planta_baja?: number
  } | null
  // El cupo se carga por servicio; el cupo general por planta es el respaldo de antes. Cualquiera de
  // los dos alcanza (un bar de una sola planta nunca iba a tener las dos cargadas).
  const generalCap = Number(caps?.planta_alta ?? 0) + Number(caps?.planta_baja ?? 0) > 0

  const has = (result: { count: number | null; error: unknown }) =>
    !result.error && (result.count ?? 0) > 0

  return {
    menuReady: has(menu),
    clubReady: has(rules),
    // Más de uno: el dueño siempre cuenta.
    teamReady: !members.error && (members.count ?? 0) > 1,
    capacitiesReady: generalCap || has(segmentCaps),
    templatesReady: has(templates),
    eventScheduledReady: has(scheduled),
    firstReservationReady: has(reservations),
    firstArrivalReady: has(arrived),
  }
}
