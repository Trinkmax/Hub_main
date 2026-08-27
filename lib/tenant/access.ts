import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { type CurrentUser, getCurrentUser } from './current'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from './errors'
import { type MembershipWithTenant, TENANT_ROLES, type Tenant, type TenantRole } from './types'

/**
 * Todo lo que el layout, el shell y la page necesitan para un tenant, resuelto
 * en UN solo round-trip (`get_tenant_access`, SECURITY INVOKER → RLS del
 * usuario). Antes eran 4–5 hops secuenciales por navegación.
 */
export type TenantAccess = {
  tenant: Tenant
  role: TenantRole
  /** Superadmin de la plataforma (platform_admins por email). */
  isPlatformAdmin: boolean
  /** Memberships del usuario, en orden de alta (para el switcher de bares). */
  memberships: MembershipWithTenant[]
  user: CurrentUser
}

type RpcPayload = {
  tenant: Tenant
  role: TenantRole
  is_platform_admin: boolean
  memberships: MembershipWithTenant[]
}

const ROLE_SET = new Set<string>(TENANT_ROLES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMemberships(raw: unknown): MembershipWithTenant[] {
  if (!Array.isArray(raw)) return []
  const out: MembershipWithTenant[] = []
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item.tenant)) continue
    const { role, tenant } = item
    if (typeof role !== 'string' || !ROLE_SET.has(role)) continue
    if (typeof tenant.id !== 'string' || typeof tenant.slug !== 'string') continue
    out.push({
      role: role as TenantRole,
      tenant: {
        id: tenant.id,
        name: typeof tenant.name === 'string' ? tenant.name : '',
        slug: tenant.slug,
        logo_url: typeof tenant.logo_url === 'string' ? tenant.logo_url : null,
      },
    })
  }
  return out
}

function parseAccess(raw: unknown): RpcPayload | null {
  if (!isRecord(raw) || !isRecord(raw.tenant)) return null
  const { role } = raw
  if (typeof role !== 'string' || !ROLE_SET.has(role)) return null
  if (typeof raw.tenant.id !== 'string' || typeof raw.tenant.slug !== 'string') return null
  return {
    tenant: raw.tenant as unknown as Tenant,
    role: role as TenantRole,
    is_platform_admin: raw.is_platform_admin === true,
    memberships: parseMemberships(raw.memberships),
  }
}

// cache() por (slug): layout, page, shell y helpers del mismo request comparten
// una sola resolución. `getCurrentUser` es local (JWT verificado en proceso), así
// que el único hop de esta función es el RPC.
export const requireTenantAccess = cache(async (slug: string): Promise<TenantAccess> => {
  const user = await getCurrentUser()
  if (!user) throw new UnauthenticatedError()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_tenant_access', { p_slug: slug })

  if (error) {
    // PGRST301 = JWT inválido/vencido para PostgREST → tratar como sin sesión.
    if (error.code === 'PGRST301') throw new UnauthenticatedError()
    console.error('[tenant.requireTenantAccess]', error.code, error.message)
    throw new Error('tenant_access_failed')
  }

  const parsed = parseAccess(data)
  if (!parsed) throw new TenantNotFoundError()

  return {
    tenant: parsed.tenant,
    role: parsed.role,
    isPlatformAdmin: parsed.is_platform_admin,
    memberships: parsed.memberships,
    user,
  }
})

export function requireRole(currentRole: TenantRole, allowed: ReadonlyArray<TenantRole>): void {
  if (!allowed.includes(currentRole)) {
    throw new RoleRequiredError()
  }
}
