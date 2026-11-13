import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { type PosError, toPosError } from './errors'
import type { FloorSnapshot, KitchenQueue, PosBranch, PosMenu, SessionDetail } from './types'

/**
 * Lecturas del punto de venta. Cada pantalla hace UNA ida a la base: las RPC
 * `pos_*` devuelven todo lo que la pantalla necesita ya armado (y chequean el
 * rol adentro).
 *
 * Las tablas y funciones nuevas todavía no están en `types/database.ts` (se
 * regenera aparte), así que se llaman por un cliente sin tipar y se tipa acá.
 */
async function untyped(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export type PosRead<T> = { ok: true; data: T } | { ok: false; error: PosError }

async function read<T>(fn: string, args: Record<string, unknown>): Promise<PosRead<T>> {
  const supabase = await untyped()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const parsed = toPosError(error)
    if (parsed.code === 'unknown') console.error(`[pos.${fn}]`, error.code, error.message)
    return { ok: false, error: parsed }
  }
  return { ok: true, data: data as T }
}

export type BranchRow = PosBranch & { address: string | null; position: number; active: boolean }

/** Las sucursales del bar, la principal primero. */
export const listBranches = cache(async (tenantId: string): Promise<BranchRow[]> => {
  const supabase = await untyped()
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, short_name, slug, color, is_default, address, position, active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (error) {
    console.error('[pos.listBranches]', error.code, error.message)
    return []
  }
  return (data ?? []) as BranchRow[]
})

/** Dónde se guarda en qué sucursal trabaja este dispositivo. */
export function branchCookieName(tenantId: string): string {
  return `hub_branch_${tenantId}`
}

/**
 * La sucursal en la que está trabajando este dispositivo: la que eligió (queda
 * guardada en el dispositivo, así la caja y la tele nunca preguntan), o la
 * principal. `chosen` dice si alguna vez eligió: con más de una sucursal y sin
 * elegir, la pantalla pregunta «¿dónde trabajás hoy?».
 */
export async function getActiveBranch(
  tenantId: string,
  preferSlug?: string | null,
): Promise<{ branches: BranchRow[]; active: BranchRow | null; chosen: boolean }> {
  const branches = await listBranches(tenantId)
  if (branches.length === 0) return { branches, active: null, chosen: false }
  const bySlug = preferSlug ? branches.find((b) => b.slug === preferSlug) : undefined
  if (bySlug) return { branches, active: bySlug, chosen: true }
  const stored = (await cookies()).get(branchCookieName(tenantId))?.value
  const byCookie = stored ? branches.find((b) => b.id === stored) : undefined
  if (byCookie) return { branches, active: byCookie, chosen: true }
  const fallback = branches.find((b) => b.is_default) ?? branches[0] ?? null
  return { branches, active: fallback, chosen: branches.length === 1 }
}

export function getFloorSnapshot(branchId: string): Promise<PosRead<FloorSnapshot>> {
  return read<FloorSnapshot>('pos_floor_snapshot', { p_branch_id: branchId })
}

export function getSessionDetail(sessionId: string): Promise<PosRead<SessionDetail>> {
  return read<SessionDetail>('pos_session_detail', { p_session_id: sessionId })
}

export function getPosMenu(branchId: string): Promise<PosRead<PosMenu>> {
  return read<PosMenu>('pos_menu', { p_branch_id: branchId })
}

export function getKitchenQueue(branchId: string): Promise<PosRead<KitchenQueue>> {
  return read<KitchenQueue>('pos_kitchen_queue', { p_branch_id: branchId })
}
