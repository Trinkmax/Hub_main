import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El proxy rutea con el rol que se está mirando («Ver como», lib/tenant/view-as.ts): el dueño
 * que mira como mozo va al salón, como anfitrión solo a sus pantallas, y sin la cookie (o con
 * la de otro usuario) navega libre como siempre.
 */

const UID = '3924fd2f-4fc9-44f6-9cfd-352ac2972de9'

const claims = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/env', () => ({
  getSupabaseClientEnv: () => ({ url: 'https://example.supabase.co', anonKey: 'anon' }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: vi.fn(async () => ({ data: claims.value ? { claims: claims.value } : null })),
    },
    from: vi.fn(() => {
      throw new Error('el proxy no debería ir a la base con el claim presente')
    }),
  })),
}))

function ownerClaims() {
  return {
    sub: UID,
    email: 'dev@example.test',
    app_metadata: {
      active_tenant_id: 't-1',
      tenants: [{ id: 't-1', slug: 'hub', role: 'owner' }],
    },
  }
}

function request(path: string, cookie?: string) {
  return new NextRequest(`https://app.example.test${path}`, {
    headers: cookie ? { cookie: `hub_view_as=${cookie}` } : {},
  })
}

/** El destino del redirect (solo el path), o null si dejó pasar. */
function redirectedTo(response: Response): string | null {
  const location = response.headers.get('location')
  return location ? new URL(location).pathname : null
}

beforeEach(() => {
  claims.value = ownerClaims()
})

describe('proxy con «Ver como»', () => {
  it('dueño sin cookie: navega libre', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    expect(redirectedTo(await updateSession(request('/hub/clientes')))).toBeNull()
  })

  it('mirando como mozo: el panel lo manda al salón y el salón lo deja pasar', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    const cookie = encodeURIComponent(`${UID}:waiter`)
    expect(redirectedTo(await updateSession(request('/hub/clientes', cookie)))).toBe('/hub/salon')
    expect(redirectedTo(await updateSession(request('/hub/salon/escanear', cookie)))).toBeNull()
  })

  it('mirando como anfitrión: solo sus pantallas', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    const cookie = encodeURIComponent(`${UID}:host`)
    expect(redirectedTo(await updateSession(request('/hub/clientes', cookie)))).toBe(
      '/hub/reservas',
    )
    expect(redirectedTo(await updateSession(request('/hub/ventas-online', cookie)))).toBeNull()
    expect(redirectedTo(await updateSession(request('/hub/salon/puerta', cookie)))).toBeNull()
    expect(redirectedTo(await updateSession(request('/hub/salon/escanear', cookie)))).toBe(
      '/hub/reservas',
    )
  })

  it('al entrar a /login con la sesión abierta, va al inicio del rol que mira', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    const cookie = encodeURIComponent(`${UID}:editor`)
    expect(redirectedTo(await updateSession(request('/login', cookie)))).toBe('/hub/menu')
  })

  it('la cookie de otro usuario no cuenta', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    const cookie = encodeURIComponent('0f6b1f0e-0000-4000-8000-000000000001:waiter')
    expect(redirectedTo(await updateSession(request('/hub/clientes', cookie)))).toBeNull()
  })

  it('quien no es dueño no puede subirse de rol con la cookie', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    claims.value = {
      ...ownerClaims(),
      app_metadata: {
        active_tenant_id: 't-1',
        tenants: [{ id: 't-1', slug: 'hub', role: 'waiter' }],
      },
    }
    const cookie = encodeURIComponent(`${UID}:host`)
    expect(redirectedTo(await updateSession(request('/hub/reservas', cookie)))).toBe('/hub/salon')
  })
})
