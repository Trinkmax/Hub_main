import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseClientEnv } from '@/lib/env'
import { isLandingsHost } from '@/lib/landings/security'
import { legacyReservasRedirect } from '@/lib/salon/calendar-links'
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

/**
 * Destino del redirect de la vieja lista `/{slug}/reservas`, o null si el path
 * no es esa lista EXACTA (`/reservas/nuevo` y `/reservas/[id]` siguen vivas).
 *
 * Se resuelve acá y no solo en `reservas/page.tsx` porque el `loading.tsx` de
 * `[tenantSlug]` vuelve streaming esa página: en carga dura Next contesta 200 +
 * meta refresh (después de renderizar el layout entero) en lugar de un 307. El
 * mapeo es el mismo (`legacyReservasRedirect`); los params repetidos viajan
 * como array para que gane el primero, igual que con los searchParams de Next.
 */
export function legacyReservasTarget(
  slug: string,
  rest: readonly string[],
  searchParams: URLSearchParams,
): string | null {
  if (rest.length !== 1 || rest[0] !== 'reservas') return null
  const sp: Record<string, string[]> = {}
  for (const key of searchParams.keys()) sp[key] = searchParams.getAll(key)
  return legacyReservasRedirect(slug, sp)
}

/** El mismo formato de slug que valida el Route Handler de /p/[slug]. */
const LANDING_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

/**
 * El host dedicado a las landings (si está configurado) sirve SÓLO landings.
 *
 * Es la mitad de la protección del modo A: en ese origen el HTML del bar corre
 * sin sandbox, así que lo que garantiza que no haya nada que robar es que ahí
 * NUNCA se pueda iniciar sesión. Login, panel, API y salón no existen en ese
 * host: se rebotan al dominio principal.
 *
 * Además la URL queda corta y linda — `paginas.tudominio/halloween` — porque
 * `/[slug]` se reescribe internamente a `/p/[slug]`, que es donde vive el
 * Route Handler.
 */
function serveLandingsHost(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  if (!isLandingsHost(request.headers.get('host'))) return null

  // `/p/<slug>` → `/…` : una sola URL canónica por página.
  if (pathname.startsWith('/p/')) {
    const url = request.nextUrl.clone()
    url.pathname = pathname.slice(2)
    return NextResponse.redirect(url, 308)
  }

  const slug = pathname.slice(1)
  if (LANDING_SLUG_RE.test(slug)) {
    const url = request.nextUrl.clone()
    url.pathname = `/p/${slug}`
    return NextResponse.rewrite(url)
  }

  // Todo lo demás no vive acá. Si sabemos cuál es el dominio del panel, lo
  // mandamos ahí; si no, 404 seco (mejor eso que servir el panel en un origen
  // donde el HTML de terceros corre suelto).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    const target = new URL(pathname, appUrl)
    // Guard anti-loop: si alguien configuró el host de landings igual al del
    // panel, redirigir acá sería un rebote infinito. Mejor 404 seco.
    // OJO AL PROBAR EN LOCAL: si usás `localhost` y `127.0.0.1` como los dos
    // hosts, el dev server los toma como el MISMO origen y devuelve el
    // `Location` relativo, con lo que parece un rebote infinito. Con dos hosts
    // de verdad (que es el caso en producción) el redirect sale absoluto.
    if (!isLandingsHost(target.host)) return NextResponse.redirect(target, 307)
  }
  return new NextResponse('No encontrado', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ANTES que nada: si el request llegó al host de las landings, ni siquiera
  // instanciamos el cliente de Supabase. Es tráfico anónimo por definición.
  const landingsResponse = serveLandingsHost(request)
  if (landingsResponse) return landingsResponse

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
      } else {
        // La lista /reservas se retiró: 307 al calendario (va DESPUÉS del
        // chequeo de rol, así el staff sigue cayendo en /salon).
        const legacyTarget = legacyReservasTarget(slug, rest, request.nextUrl.searchParams)
        if (legacyTarget) {
          const redirect = NextResponse.redirect(new URL(legacyTarget, request.url), 307)
          // Si getClaims() recién refrescó la sesión, las cookies nuevas viven
          // en `response`: sin copiarlas, el browser seguiría el redirect con
          // el token viejo.
          for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
          return redirect
        }
      }
    }
  }

  return response
}
