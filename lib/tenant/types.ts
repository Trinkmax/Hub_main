export type TenantRole = 'owner' | 'cashier' | 'waiter' | 'kitchen' | 'editor' | 'host'

export type Tenant = {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  logo_url: string | null
  settings: Record<string, unknown>
  /** Panel de visibilidad por bar. Defaults en lib/platform/features.ts; solo overrides acá. */
  feature_flags: Record<string, boolean>
  /** Acento de marca (hex #RRGGBB) para superficies públicas. null = primary por defecto. */
  brand_accent: string | null
  created_at: string
  updated_at: string
}

export type Membership = {
  id: string
  tenant_id: string
  user_id: string
  role: TenantRole
  created_at: string
}

export type MembershipWithTenant = {
  role: TenantRole
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
}

export const TENANT_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'cashier',
  'waiter',
  'kitchen',
  'editor',
  'host',
]

/**
 * Fuente ÚNICA de slugs reservados (paths globales que nunca son un tenant).
 * `lib/supabase/middleware.ts` importa este set — no duplicar.
 */
export const RESERVED_SLUGS = new Set([
  'login',
  'auth',
  'accept-invite',
  'onboarding',
  'api',
  'capture',
  'admin',
  'm',
  'print',
  'c',
  'carta',
  'r',
  '_next',
  'static',
  'public',
  'assets',
])
