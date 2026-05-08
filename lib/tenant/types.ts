export type TenantRole = 'owner' | 'cashier' | 'waiter' | 'kitchen'

export type Tenant = {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  logo_url: string | null
  settings: Record<string, unknown>
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

export const TENANT_ROLES: ReadonlyArray<TenantRole> = ['owner', 'cashier', 'waiter', 'kitchen']

export const RESERVED_SLUGS = new Set([
  'login',
  'auth',
  'accept-invite',
  'onboarding',
  'api',
  'capture',
  'admin',
  '_next',
  'static',
  'public',
  'assets',
])
