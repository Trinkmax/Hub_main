import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseClientEnv } from '@/lib/env'
import { canAccessManagerPath, homePathForRole, SALON_ROLES } from '@/lib/tenant/roles'
// Fuente ÚNICA de slugs reservados (evitamos el set duplicado/divergente de antes).
import { RESERVED_SLUGS } from '@/lib/tenant/types'

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
  '/api/webhooks/',
  '/api/cron/', // jobs de fondo: se auto-protegen con Bearer CRON_SECRET en cada route handler
  '/_next/',
  '/auth/',
  '/accept-invite/',
  '/icons/',
  '/forgot-password',
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

type RoleLookup = {
  role: string
  slug: string
}

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

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Logged-in user landing on /login → bounce by role
  if (user && pathname === '/login') {
    const activeTenantId =
      (user.app_metadata as { active_tenant_id?: string } | undefined)?.active_tenant_id ?? null

    if (activeTenantId) {
      const lookup = await getActiveRoleAndSlug(supabase, user.id, activeTenantId)
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
  if (user) {
    const segments = pathname.split('/').filter(Boolean)
    const slug = segments[0]
    const rest = segments.slice(1)

    if (slug && !RESERVED_SLUGS.has(slug)) {
      const role = await getRoleForSlug(supabase, user.id, slug)
      if (role) {
        const inSalon = rest[0] === 'salon'
        if (inSalon) {
          if (!STAFF_ROLES.has(role) && role !== 'owner') {
            return NextResponse.redirect(new URL(homePathForRole(role, slug), request.url))
          }
        } else if (STAFF_ROLES.has(role)) {
          return NextResponse.redirect(new URL(`/${slug}/salon`, request.url))
        } else if (!canAccessManagerPath(role, rest)) {
          return NextResponse.redirect(new URL(homePathForRole(role, slug), request.url))
        }
      }
    }
  }

  return response
}
