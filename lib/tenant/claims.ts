import { TENANT_ROLES, type TenantRole } from './types'

/**
 * Lectura de los claims que `custom_access_token_hook` inyecta en el JWT.
 *
 * Módulo PURO (sin `server-only`, sin Supabase): lo comparten el proxy (que corre
 * antes del render) y los helpers de tenant del server. El JWT se verifica
 * localmente con `getClaims()` (ES256 + JWKS cacheado en memoria), así que leer
 * de acá cuesta cero round-trips.
 *
 * IMPORTANTE: estos claims son SOLO para rutear (a qué workspace mandar a cada
 * rol). La autorización real sigue en la DB: `get_tenant_access` bajo RLS en
 * cada layout/page y `requireRole` en cada Server Action. Un claim viejo (hasta
 * 1 h, lo que dura el access token) sólo puede rutear mal, nunca exponer datos.
 */
export type TenantClaim = { id: string; slug: string; role: TenantRole }

const ROLE_SET = new Set<string>(TENANT_ROLES)

/**
 * `app_metadata.tenants` → lista de memberships del usuario.
 * - `null`: el claim NO está (token emitido antes del hook, o sesión anónima)
 *   o viene recortado (`tenants_truncated`) → el caller debe caer a la DB.
 * - `[]`: el claim está y el usuario no es miembro de ningún bar.
 */
export function readTenantClaims(appMetadata: unknown): TenantClaim[] | null {
  if (!appMetadata || typeof appMetadata !== 'object') return null
  const meta = appMetadata as { tenants?: unknown; tenants_truncated?: unknown }
  // El hook corta la lista en 20 bares y lo marca: una lista recortada no
  // sirve para rutear (el bar pedido puede ser el 21) → resolver por DB.
  if (meta.tenants_truncated === true) return null
  const raw = meta.tenants
  if (!Array.isArray(raw)) return null
  const out: TenantClaim[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { id, slug, role } = item as { id?: unknown; slug?: unknown; role?: unknown }
    if (typeof id !== 'string' || typeof slug !== 'string' || typeof role !== 'string') continue
    if (!ROLE_SET.has(role)) continue
    out.push({ id, slug, role: role as TenantRole })
  }
  return out
}

/** `app_metadata.active_tenant_id` (lo setea `set_active_tenant` + el hook). */
export function readActiveTenantId(appMetadata: unknown): string | null {
  if (!appMetadata || typeof appMetadata !== 'object') return null
  const value = (appMetadata as { active_tenant_id?: unknown }).active_tenant_id
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function roleForSlug(claims: ReadonlyArray<TenantClaim>, slug: string): TenantRole | null {
  return claims.find((t) => t.slug === slug)?.role ?? null
}

export function claimForTenantId(
  claims: ReadonlyArray<TenantClaim>,
  tenantId: string,
): TenantClaim | null {
  return claims.find((t) => t.id === tenantId) ?? null
}
