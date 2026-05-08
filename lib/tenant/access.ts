import { createClient } from '@/lib/supabase/server'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from './errors'
import type { Tenant, TenantRole } from './types'

export async function requireTenantAccess(
  slug: string,
): Promise<{ tenant: Tenant; role: TenantRole }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new UnauthenticatedError()

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
}

export function requireRole(currentRole: TenantRole, allowed: ReadonlyArray<TenantRole>): void {
  if (!allowed.includes(currentRole)) {
    throw new RoleRequiredError()
  }
}
