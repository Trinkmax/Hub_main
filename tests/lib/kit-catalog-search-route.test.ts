import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantRole } from '@/lib/tenant/types'

/**
 * `GET /[tenantSlug]/docs/componentes/busqueda`: la búsqueda de mentira del
 * catálogo de componentes (kit HUB §6.3). Mismo contrato que las búsquedas de
 * verdad (`?q=` de 2 a 80 caracteres, `{ options }`), 400 ms de espera para
 * que se vea la cancelación, `?fallo=1` para el error, y la misma validación
 * de sesión y rol que todo el panel (solo el dueño o el superadmin).
 */

vi.mock('@/lib/tenant', async () => {
  const roles = await vi.importActual<typeof import('@/lib/tenant/roles')>('@/lib/tenant/roles')
  const errors = await vi.importActual<typeof import('@/lib/tenant/errors')>('@/lib/tenant/errors')
  return {
    ...roles,
    ...errors,
    requireTenantAccess: vi.fn(),
    requireRole: (role: TenantRole, allowed: ReadonlyArray<TenantRole>) => {
      if (!allowed.includes(role)) throw new errors.RoleRequiredError()
    },
  }
})

const { GET } = await import('@/app/(manager)/[tenantSlug]/docs/componentes/busqueda/route')
const tenant = await import('@/lib/tenant')
const requireTenantAccess = vi.mocked(tenant.requireTenantAccess)

function grant(role: TenantRole, isPlatformAdmin = false) {
  requireTenantAccess.mockResolvedValue({
    tenant: { id: 'tenant-a', slug: 'bar-de-ejemplo' },
    role,
    isPlatformAdmin,
  } as unknown as Awaited<ReturnType<typeof tenant.requireTenantAccess>>)
}

function call(query: string, signal?: AbortSignal) {
  return GET(
    new Request(`https://hub.test/bar-de-ejemplo/docs/componentes/busqueda?${query}`, { signal }),
    {
      params: Promise.resolve({ tenantSlug: 'bar-de-ejemplo' }),
    },
  )
}

/** Corre el pedido y avanza el reloj los 400 ms de la espera de mentira. */
async function settle(promise: Promise<Response>): Promise<Response> {
  await vi.advanceTimersByTimeAsync(400)
  return promise
}

describe('GET /[tenantSlug]/docs/componentes/busqueda', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    requireTenantAccess.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('400 con menos de 2 letras o un fallo que no es 0 ni 1, sin mirar la sesión', async () => {
    expect((await call('q=d')).status).toBe(400)
    expect((await call('q=%20%20')).status).toBe(400)
    expect((await call('q=dis&fallo=si')).status).toBe(400)
    expect(requireTenantAccess).not.toHaveBeenCalled()
  })

  it('401 sin sesión y 403 si no es el dueño (ni superadmin) o el bar no es suyo', async () => {
    requireTenantAccess.mockRejectedValue(new tenant.UnauthenticatedError())
    expect((await call('q=dis')).status).toBe(401)
    grant('cashier')
    expect((await call('q=dis')).status).toBe(403)
    grant('editor')
    expect((await call('q=dis')).status).toBe(403)
    requireTenantAccess.mockRejectedValue(new tenant.TenantNotFoundError())
    expect((await call('q=dis')).status).toBe(403)
  })

  it('el dueño busca por nombre o rubro, sin tildes, y no se guarda en cache', async () => {
    grant('owner')
    const response = await settle(call('q=lacteos'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body = (await response.json()) as { options: Array<{ value: string; label: string }> }
    expect(body.options.map((option) => option.label)).toEqual(['Lácteos Serranos SA'])

    const byCategory = (await (await settle(call('q=bebidas'))).json()) as {
      options: Array<{ label: string; description: string }>
    }
    expect(byCategory.options.map((option) => option.label)).toEqual([
      'Distribuidora del Centro SA',
      'Bebidas del Sur SRL',
    ])
    expect(byCategory.options[0]?.description).toBe('Bebidas · Responsable inscripto')
  })

  it('el superadmin de la plataforma también entra', async () => {
    grant('cashier', true)
    expect((await settle(call('q=cafe'))).status).toBe(200)
  })

  it('?fallo=1 contesta 503 (el Combobox muestra «No pudimos buscar»)', async () => {
    grant('owner')
    expect((await settle(call('q=dis&fallo=1'))).status).toBe(503)
  })

  it('si el pedido se cancela durante la espera, no contesta opciones (499)', async () => {
    grant('owner')
    const controller = new AbortController()
    const pending = call('q=dis', controller.signal)
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    const response = await settle(pending)
    expect(response.status).toBe(499)
  })
})
