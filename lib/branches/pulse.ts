import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceDayInCordoba } from '@/lib/dates/zone'
import { createClient } from '@/lib/supabase/server'
import type { BranchPulses } from './pulse-line'

export type { BranchPulse, BranchPulses } from './pulse-line'

/**
 * Cómo viene hoy cada sucursal: lo que muestran la entrada («¿A dónde entrás hoy?») y el selector de arriba al
 * abrirlo. Dos lecturas chicas con la sesión de quien mira (RLS); si su rol no ve las reservas, no se muestra nada.
 * «Hoy» es el día de servicio: hasta las 5 de la mañana sigue siendo la noche anterior.
 */

const LIMIT = 2_000

export async function getBranchPulses(
  tenantId: string,
  branchIds: ReadonlyArray<string>,
): Promise<BranchPulses | null> {
  if (branchIds.length === 0) return {}
  const supabase = (await createClient()) as unknown as SupabaseClient
  const day = serviceDayInCordoba()
  const [reservations, events] = await Promise.all([
    supabase
      .from('salon_reservations')
      .select('branch_id, estimated_guests')
      .eq('tenant_id', tenantId)
      .eq('reservation_date', day)
      .in('branch_id', [...branchIds])
      .not('status', 'in', '(cancelled,no_show)')
      .limit(LIMIT),
    supabase
      .from('scheduled_events')
      .select('branch_id')
      .eq('tenant_id', tenantId)
      .eq('event_date', day)
      .in('branch_id', [...branchIds])
      .limit(LIMIT),
  ])
  if (reservations.error || events.error) {
    const error = reservations.error ?? events.error
    // Un rol que no ve reservas (cocina, contenido) no tiene números para mostrar: no es una falla.
    if (error?.code !== '42501') console.error('[branches.pulse]', error?.code, error?.message)
    return null
  }

  const pulses: BranchPulses = Object.fromEntries(
    branchIds.map((id) => [id, { reservations: 0, guests: 0, events: 0 }]),
  )
  for (const row of (reservations.data ?? []) as Array<{
    branch_id: string
    estimated_guests: number | null
  }>) {
    const pulse = pulses[row.branch_id]
    if (!pulse) continue
    pulse.reservations += 1
    pulse.guests += row.estimated_guests ?? 0
  }
  for (const row of (events.data ?? []) as Array<{ branch_id: string }>) {
    const pulse = pulses[row.branch_id]
    if (pulse) pulse.events += 1
  }
  return pulses
}
