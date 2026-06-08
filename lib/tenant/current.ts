import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { MembershipWithTenant, Tenant, TenantRole } from './types'

type RawJoinedRow = {
  role: TenantRole
  tenant: MembershipWithTenant['tenant'] | MembershipWithTenant['tenant'][] | null
}

function pickTenant(raw: RawJoinedRow['tenant']): MembershipWithTenant['tenant'] | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

// cache() deduplica el getUser() (round-trip a Supabase Auth) entre el layout, la
// page y los demás helpers de tenant dentro de un mismo render de request.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

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

export async function getActiveTenant(): Promise<{
  tenant: Tenant
  role: TenantRole
} | null> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null

  const claim = session.user?.app_metadata?.active_tenant_id as string | undefined
  if (!claim) return null

  // user_id explícito: hay un row por user en (tenant_id, user_id) único, pero
  // la RLS expone también miembros del mismo tenant — filtramos para single.
  const { data, error } = await supabase
    .from('memberships')
    .select('role, tenant:tenants(*)')
    .eq('user_id', session.user.id)
    .eq('tenant_id', claim)
    .maybeSingle()

  if (error) {
    console.error('[tenant.getActiveTenant]', error.code, error.message)
    return null
  }
  if (!data) return null
  const raw = data as unknown as { role: TenantRole; tenant: Tenant | Tenant[] | null }
  const tenant = Array.isArray(raw.tenant) ? raw.tenant[0] : raw.tenant
  if (!tenant) return null
  return { tenant, role: raw.role }
}
