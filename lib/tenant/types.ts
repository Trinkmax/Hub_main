export type TenantRole =
  | 'owner'
  | 'cashier'
  | 'waiter'
  | 'kitchen'
  | 'editor'
  | 'host'
  | 'accountant'

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

// El compilador obliga a completar el registro: un rol que se suma al union y
// falta acá no compila. Antes la lista se escribía a mano y un rol olvidado
// hacía que `requireTenantAccess` lo descartara (TenantNotFoundError) y el
// layout del panel rebotara en loop.
const ROLE_REGISTRY = {
  owner: true,
  cashier: true,
  waiter: true,
  kitchen: true,
  editor: true,
  host: true,
  accountant: true,
} as const satisfies Record<TenantRole, true>

export const TENANT_ROLES = Object.keys(ROLE_REGISTRY) as ReadonlyArray<TenantRole>

const ROLE_SET: ReadonlySet<string> = new Set(TENANT_ROLES)

/** ¿Es un rol que conocemos? Para lo que llega de la base o del JWT como texto. */
export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && ROLE_SET.has(value)
}

/**
 * Lo que el shell y las páginas saben de Administración para este usuario y
 * este bar (clave `accounting` de `get_tenant_access`, que la arma
 * `acc_my_access`). La base vuelve a decidir todo en cada RLS y RPC: esto
 * solo rutea, muestra y esconde.
 */
export type AccountingAccess = {
  /** El bar tiene prendido el flag `accounting`. */
  enabled: boolean
  /** Alguien ya hizo la puesta en marcha (existe `acc_settings`). */
  setUp: boolean
  /** Ve Administración: contadora, o dueño con acceso vigente. */
  read: boolean
  /** Carga, anula y cierra meses: solo dueño con acceso vigente. */
  write: boolean
  /** Da y quita accesos y suma a la contadora. No depende del flag (gobierno). */
  admin: boolean
  /** Puede hacer la puesta en marcha (flag prendido y todavía sin configurar). */
  canSetUp: boolean
}

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
  'v', // QR de canje (/v/[redeem_token])
  'l', // link público del bar para la bio de Instagram (/l/[tenantSlug])
  'p', // páginas HTML que publica el bar (/p/[slug])
  '_next',
  'static',
  'public',
  'assets',
])
