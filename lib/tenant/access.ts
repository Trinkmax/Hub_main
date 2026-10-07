import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { type CurrentUser, getCurrentUser } from './current'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from './errors'
import {
  type AccountingAccess,
  isTenantRole,
  type MembershipWithTenant,
  type Tenant,
  type TenantRole,
} from './types'

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
  /** Administración para este usuario en este bar. Todo en `false` si la base no lo manda. */
  accounting: AccountingAccess
  user: CurrentUser
}

type RpcPayload = {
  tenant: Tenant
  role: TenantRole
  is_platform_admin: boolean
  memberships: MembershipWithTenant[]
  accounting: AccountingAccess
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Clave `accounting` de `get_tenant_access` → `AccountingAccess`.
 *
 * Falla cerrado: si la clave falta (el código puede salir antes que la
 * migración que la agrega), viene rara o trae algo que no es un `true`
 * literal, todo queda en `false` y Administración cerrada. Además no confía en
 * combinaciones que la base nunca arma: leer o escribir exige el módulo
 * prendido y configurado, escribir exige leer, y la puesta en marcha exige el
 * módulo prendido y sin configurar. `admin` va suelto a propósito: es gobierno
 * de accesos y la base lo respeta aunque el flag esté apagado.
 */
export function parseAccountingAccess(raw: unknown): AccountingAccess {
  if (!isRecord(raw)) {
    return {
      enabled: false,
      setUp: false,
      read: false,
      write: false,
      admin: false,
      canSetUp: false,
    }
  }
  const enabled = raw.enabled === true
  const setUp = raw.set_up === true
  const read = enabled && setUp && raw.read === true
  return {
    enabled,
    setUp,
    read,
    write: read && raw.write === true,
    admin: raw.admin === true,
    canSetUp: enabled && !setUp && raw.can_set_up === true,
  }
}

function parseMemberships(raw: unknown): MembershipWithTenant[] {
  if (!Array.isArray(raw)) return []
  const out: MembershipWithTenant[] = []
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item.tenant)) continue
    const { role, tenant } = item
    if (!isTenantRole(role)) continue
    if (typeof tenant.id !== 'string' || typeof tenant.slug !== 'string') continue
    out.push({
      role,
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
  if (!isTenantRole(role)) return null
  if (typeof raw.tenant.id !== 'string' || typeof raw.tenant.slug !== 'string') return null
  return {
    tenant: raw.tenant as unknown as Tenant,
    role,
    is_platform_admin: raw.is_platform_admin === true,
    memberships: parseMemberships(raw.memberships),
    accounting: parseAccountingAccess(raw.accounting),
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
    accounting: parsed.accounting,
    user,
  }
})

export function requireRole(currentRole: TenantRole, allowed: ReadonlyArray<TenantRole>): void {
  if (!allowed.includes(currentRole)) {
    throw new RoleRequiredError()
  }
}
