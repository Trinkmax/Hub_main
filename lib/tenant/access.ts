import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './current'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from './errors'
import type { Tenant, TenantRole } from './types'

// cache() por (slug): el layout y la page del mismo request comparten una sola
// resolución (un getUser cacheado + una query de membership) en vez de pagar el
// round-trip dos veces en cada navegación del manager.
export const requireTenantAccess = cache(
  async (slug: string): Promise<{ tenant: Tenant; role: TenantRole }> => {
    const user = await getCurrentUser()
    if (!user) throw new UnauthenticatedError()

    const supabase = await createClient()
    // Filtramos por user_id explícitamente: la RLS deja ver memberships
    // de otros miembros del mismo bar, así que sin este eq() un bar con
    // >1 miembro rompería el .maybeSingle() ("more than one row").
    const { data, error } = await supabase
      .from('memberships')
      .select('role, tenant:tenants!inner(*)')
      .eq('user_id', user.id)
      .eq('tenant.slug', slug)
      .maybeSingle()

    if (error || !data) throw new TenantNotFoundError()

    const raw = data as unknown as { role: TenantRole; tenant: Tenant | Tenant[] | null }
    const tenant = Array.isArray(raw.tenant) ? raw.tenant[0] : raw.tenant
    if (!tenant) throw new TenantNotFoundError()

    return { tenant, role: raw.role }
  },
)

export function requireRole(currentRole: TenantRole, allowed: ReadonlyArray<TenantRole>): void {
  if (!allowed.includes(currentRole)) {
    throw new RoleRequiredError()
  }
}
