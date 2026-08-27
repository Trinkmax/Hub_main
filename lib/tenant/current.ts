import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { readActiveTenantId, readTenantClaims, type TenantClaim } from './claims'
import type { MembershipWithTenant, TenantRole } from './types'

type RawJoinedRow = {
  role: TenantRole
  tenant: MembershipWithTenant['tenant'] | MembershipWithTenant['tenant'][] | null
}

function pickTenant(raw: RawJoinedRow['tenant']): MembershipWithTenant['tenant'] | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

/** Identidad del usuario logueado, derivada del JWT verificado localmente. */
export type CurrentUser = {
  id: string
  email: string | null
  /** `app_metadata.active_tenant_id` del JWT (lo inyecta el hook). */
  activeTenantId: string | null
  /**
   * `app_metadata.tenants` del JWT: [{id, slug, role}]. `null` = token emitido
   * antes del hook (hasta 1 h después del deploy) → caer a la DB si hace falta.
   */
  tenants: TenantClaim[] | null
}

// getClaims() verifica el JWT LOCALMENTE (firma ES256 contra el JWKS del
// proyecto, cacheado en memoria del proceso por auth-js) — cero round-trips a
// Supabase Auth. Antes era getUser(): un hop de 100–200 ms desde Vercel, y la
// cola de /auth/v1/user llegó a 60–157 s en producción (27/08/2026).
// cache() lo deduplica entre layout, page y helpers dentro del mismo request.
//
// Para flujos donde importa la revocación inmediata de la sesión (cambio de
// password, aceptar invitación) seguir usando `supabase.auth.getUser()`.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims) return null
  const claims = data.claims
  const id = typeof claims.sub === 'string' ? claims.sub : null
  if (!id) return null
  return {
    id,
    email: typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null,
    activeTenantId: readActiveTenantId(claims.app_metadata),
    tenants: readTenantClaims(claims.app_metadata),
  }
})

/**
 * Memberships del usuario con datos del bar. Es UN round-trip; en el workspace
 * de un tenant no hace falta porque `requireTenantAccess` ya las trae en el
 * mismo RPC (`access.memberships`). Queda para las rutas sin tenant
 * (`/`, `/onboarding`) y como fallback.
 */
export async function getMembershipsForUser(): Promise<MembershipWithTenant[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const supabase = await createClient()

  // Filtramos por user_id: la RLS muestra memberships de otros del mismo bar,
  // sin este filtro listaríamos miembros ajenos como si fueran del usuario.
  const { data, error } = await supabase
    .from('memberships')
    .select('role, tenant:tenants(id, name, slug, logo_url)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[tenant.getMemberships]', error.code, error.message)
    return []
  }
  if (!data) return []

  const result: MembershipWithTenant[] = []
  for (const row of data as unknown as RawJoinedRow[]) {
    const tenant = pickTenant(row.tenant)
    if (tenant) result.push({ role: row.role, tenant })
  }
  return result
}
