import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseClientEnv } from '@/lib/env'
import {
  claimForTenantId,
  readActiveTenantId,
  readTenantClaims,
  roleForSlug,
} from '@/lib/tenant/claims'
import {
  canAccessManagerPath,
  canAccessSalonPath,
  homePathForRole,
  SALON_ROLES,
} from '@/lib/tenant/roles'
// Fuente ÚNICA de slugs reservados (evitamos el set duplicado/divergente de antes).
import { RESERVED_SLUGS } from '@/lib/tenant/types'
import { WORKSPACE_HEADER } from '@/lib/workspace'

const PUBLIC_PATHS = new Set([
  '/login',
  '/auth/callback',
  '/manifest.webmanifest',
  '/sw.js',
  '/apple-touch-icon.png',
  '/robots.txt',
  '/forgot-password',
])
const PUBLIC_PREFIXES = [
  '/capture/',
  '/m/',
  '/c/',
  '/carta/', // carta read-only pública (QR de la carta)
  '/r/', // página pública de reseña
  '/v/', // QR de canje del socio: lo abre sin sesión para mostrárselo al mozo
  '/l/', // link público del bar (bio de Instagram)
  '/p/', // páginas HTML que sube el bar (landings)
  '/api/wallet/', // pulso de la billetera del socio (capability por qr_token, sin sesión)
  '/api/webhooks/',
  '/api/cron/', // jobs de fondo: se auto-protegen con Bearer CRON_SECRET en cada route handler
  '/_next/',
  '/auth/',
  '/accept-invite/',
  '/icons/',
  '/forgot-password',
]

/**
 * Endpoints máquina-a-máquina: nunca traen cookie de sesión de un humano
 * (pg_cron, Meta, el pulso de la billetera). Para estos ni instanciamos el
 * cliente de Supabase — cero trabajo en el proxy.
 */
const MACHINE_PREFIXES = [
  '/api/cron/',
  '/api/webhooks/',
  '/api/wallet/',
  // Las landings del bar son 100% anónimas: no hay sesión que refrescar y el
  // Route Handler no lee cookies. Saltear el cliente de Supabase le saca un
  // hop a cada visita que llega desde Instagram.
  '/p/',
  '/_next/',
  '/icons/',
]

const STAFF_ROLES = new Set<string>(SALON_ROLES)

export function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  if (pathname === '/favicon.ico' || pathname.startsWith('/static/')) return true
  // Cualquier asset estático con extensión común no requiere auth.
  if (
    /\.(?:png|jpg|jpeg|webp|svg|ico|gif|woff2?|ttf|otf|css|js|map|webmanifest)$/i.test(pathname)
  ) {
    return true
  }
  return false
}

export function isMachinePath(pathname: string) {
  return MACHINE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

type RoleLookup = {
  role: string
  slug: string
}

// ── Fallbacks a la DB ───────────────────────────────────────────────────────
// Sólo se usan cuando el JWT todavía no trae `app_metadata.tenants` (token
// emitido antes del deploy del hook; expira en ≤1 h). Después de eso el proxy
// no toca la DB nunca.

async function getRoleForSlug(
  supabase: SupabaseClient,
  userId: string,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, tenants!inner(slug)')
    .eq('user_id', userId)
    .eq('tenants.slug', slug)
    .maybeSingle()

  if (error || !data) return null
  return (data as { role: string }).role
}

async function getActiveRoleAndSlug(
  supabase: SupabaseClient,
  userId: string,
  activeTenantId: string,
): Promise<RoleLookup | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, tenants!inner(slug)')
    .eq('user_id', userId)
    .eq('tenant_id', activeTenantId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as {
    role: string
    tenants: { slug: string } | { slug: string }[]
  }
  const slug = Array.isArray(row.tenants) ? row.tenants[0]?.slug : row.tenants.slug
  if (!slug) return null
  return { role: row.role, slug }
}

/** `/{slug}/salon…` — el workspace mobile del staff, que es light-only. */
const SALON_PATH_RE = /^\/[^/]+\/salon(?:\/|$)/

export function isSalonWorkspacePath(pathname: string): boolean {
  const slug = pathname.split('/').filter(Boolean)[0]
  if (!slug || RESERVED_SLUGS.has(slug)) return false
  return SALON_PATH_RE.test(pathname)
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl

  // El panel del salón se sirve SIEMPRE en modo claro (lo usa el mozo con el
  // celular a plena luz, y el dueño lo pidió explícito). Marcamos el request
  // acá para que el root layout emita el `<html>` claro DESDE EL SERVER y no
  // haya flash oscuro. Se setea sobre `request.headers` — no sobre la response —
  // porque `NextResponse.next({ request })` es lo que reenvía los headers al
  // render, y `response` se reasigna adentro de `setAll` en cada refresh de
  // cookies (setearlo ahí se perdería).
  if (isSalonWorkspacePath(pathname)) {
    try {
      request.headers.set(WORKSPACE_HEADER, 'salon')
    } catch {
      // Headers inmutables en algún runtime: el script no-flash del <head> es
      // la red de seguridad y corre igual antes del primer paint.
    }
  }

  let response = NextResponse.next({ request })

  if (isMachinePath(pathname)) return response

  const { url, anonKey } = getSupabaseClientEnv()

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getClaims() = refresh de la sesión si venció (y reenvío de las cookies
  // nuevas al render + al browser) + verificación LOCAL de la firma del JWT
  // (ES256 contra el JWKS del proyecto, cacheado en memoria por auth-js).
  // Cero round-trips a Supabase Auth en el camino feliz. NO reemplazar por
  // getUser(): ese endpoint era el cuello de botella (p50 100–200 ms desde
  // Vercel, cola de hasta 157 s en producción).
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims ?? null
  const userId = typeof claims?.sub === 'string' ? claims.sub : null

  if (!userId && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (!userId || !claims) return response

  // Memberships desde el JWT (null = token viejo sin el claim → fallback a DB).
  const tenantClaims = readTenantClaims(claims.app_metadata)

  // Logged-in user landing on /login → bounce by role. Excepción: si un layout
  // nos mandó con ?reason=session es porque PostgREST rechazó el JWT que
  // getClaims() dio por bueno (clave revocada, skew de reloj) — rebotar a home
  // sería un loop; dejamos que el login re-emita la sesión.
  if (pathname === '/login') {
    if (request.nextUrl.searchParams.get('reason') === 'session') return response
    const activeTenantId = readActiveTenantId(claims.app_metadata)
    if (activeTenantId) {
      let lookup: RoleLookup | null = null
      if (tenantClaims) {
        const claim = claimForTenantId(tenantClaims, activeTenantId)
        lookup = claim ? { role: claim.role, slug: claim.slug } : null
      } else {
        lookup = await getActiveRoleAndSlug(supabase, userId, activeTenantId)
      }
      if (lookup) {
        return NextResponse.redirect(
          new URL(homePathForRole(lookup.role, lookup.slug), request.url),
        )
      }
    }
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Ruteo por rol dentro del tenant:
  //  - staff de salón (cashier/waiter/kitchen) → siempre /salon
  //  - roles acotados del manager (editor/host) → solo sus prefijos permitidos
  //  - owner navega libre (peek mode en /salon permitido)
  // Es SOLO ruteo: la autorización real la hace cada layout/page contra la DB
  // (get_tenant_access bajo RLS) y cada Server Action con requireRole.
  const segments = pathname.split('/').filter(Boolean)
  const slug = segments[0]
  const rest = segments.slice(1)

  if (slug && !RESERVED_SLUGS.has(slug)) {
    const role = tenantClaims
      ? roleForSlug(tenantClaims, slug)
      : await getRoleForSlug(supabase, userId, slug)
    if (role) {
      const inSalon = rest[0] === 'salon'
      if (inSalon) {
        if (!STAFF_ROLES.has(role) && role !== 'owner' && !canAccessSalonPath(role, rest)) {
          return NextResponse.redirect(new URL(homePathForRole(role, slug), request.url))
        }
      } else if (STAFF_ROLES.has(role)) {
        return NextResponse.redirect(new URL(`/${slug}/salon`, request.url))
      } else if (!canAccessManagerPath(role, rest)) {
        return NextResponse.redirect(new URL(homePathForRole(role, slug), request.url))
      }
    }
  }

  return response
}
