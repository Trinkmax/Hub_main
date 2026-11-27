import 'server-only'

import { collectPages } from '@/lib/salon/segment-rows'
import { createClient } from '@/lib/supabase/server'
import type { TexToolContext } from '../types'
import type { LoadedReservationRow } from './_read-data'

/**
 * Lo que lee `ver_carga_reservas`, con la sesión de la persona (la RLS de las reservas decide).
 *
 * Cada reserva guarda sola cuándo se cargó (`created_at`): nadie lo escribe. Acá se leen las reservas
 * en pie de unos eventos con ese dato, y los títulos de las películas, para que «Coraline» encuentre
 * sus funciones aunque el formato del calendario se llame distinto.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas sin tipos generados, como lib/ticketing/queries
type SBAny = any

export async function readLoadedReservations(
  ctx: TexToolContext,
  eventIds: readonly string[],
): Promise<LoadedReservationRow[]> {
  if (eventIds.length === 0) return []
  const supabase = (await createClient()) as SBAny
  return collectPages<LoadedReservationRow>((from, to) =>
    supabase
      .from('salon_reservations')
      .select('scheduled_event_id, estimated_guests, actual_guests, created_at, origin')
      .eq('tenant_id', ctx.tenantId)
      .in('scheduled_event_id', eventIds)
      .not('status', 'in', '(cancelled,no_show)')
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/**
 * El título de la película de cada formato. Las películas son del dueño por RLS: a quien no las puede
 * leer le vuelve vacío, y los eventos se buscan solo por el nombre del calendario.
 */
export async function readFilmTitles(ctx: TexToolContext): Promise<Map<string, string>> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('event_experiences')
    .select('template_id, title')
    .eq('tenant_id', ctx.tenantId)
  if (error) return new Map()
  const titles = new Map<string, string>()
  for (const row of (data as Array<{ template_id: string; title: string }> | null) ?? []) {
    if (!titles.has(row.template_id)) titles.set(row.template_id, row.title)
  }
  return titles
}
