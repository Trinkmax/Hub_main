import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantRole } from '@/lib/tenant/types'

/**
 * `GET /api/customers/search` (el que usa el `CustomerPicker`): valida `slug` y
 * `q` con zod, exige sesión y un rol de `RESERVATION_OPERATOR_ROLES`, reusa la
 * consulta de `lib/customers/search.ts` y contesta `{ options }` sin cache y
 * sin dejar PII en los logs.
 */

const searchCustomers = vi.fn()
vi.mock('@/lib/customers/search', () => ({
  searchCustomers: (...args: unknown[]) => searchCustomers(...args),
}))

vi.mock('@/lib/tenant', async () => {
  // Roles y errores reales: el test tiene que fallar si alguien cambia el set
  // de roles. Solo se reemplaza la lectura de la membership.
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

const { GET } = await import('@/app/api/customers/search/route')
const tenant = await import('@/lib/tenant')
const requireTenantAccess = vi.mocked(tenant.requireTenantAccess)

function grant(role: TenantRole) {
  requireTenantAccess.mockResolvedValue({
    tenant: { id: 'tenant-a', slug: 'hub' },
    role,
  } as unknown as Awaited<ReturnType<typeof tenant.requireTenantAccess>>)
}

function call(query: string) {
  return GET(new Request(`https://hub.test/api/customers/search?${query}`))
}

const MELINA = {
  id: 'c-1',
  first_name: 'Melina',
  last_name: 'Gómez',
  phone: '+5493515551234',
  points_balance: 120,
  service_alerts: ['celiac', 'no-existe'],
}

describe('GET /api/customers/search', () => {
  beforeEach(() => {
    searchCustomers.mockReset()
    requireTenantAccess.mockReset()
  })

  it('400 sin bar o con menos de 2 letras, sin tocar la base', async () => {
    expect((await call('q=me')).status).toBe(400)
    expect((await call('slug=hub&q=m')).status).toBe(400)
    expect((await call('slug=hub&q=%20%20')).status).toBe(400)
    expect(requireTenantAccess).not.toHaveBeenCalled()
    expect(searchCustomers).not.toHaveBeenCalled()
  })

  it('401 sin sesión', async () => {
    requireTenantAccess.mockRejectedValue(new tenant.UnauthenticatedError())
    const res = await call('slug=hub&q=mel')
    expect(res.status).toBe(401)
    expect(searchCustomers).not.toHaveBeenCalled()
  })

  it('403 si el rol no vincula clientes (editor, cocina) o el bar no es suyo', async () => {
    grant('editor')
    expect((await call('slug=hub&q=mel')).status).toBe(403)
    grant('kitchen')
    expect((await call('slug=hub&q=mel')).status).toBe(403)
    requireTenantAccess.mockRejectedValue(new tenant.TenantNotFoundError())
    expect((await call('slug=otro&q=mel')).status).toBe(403)
    expect(searchCustomers).not.toHaveBeenCalled()
  })

  it('arma las opciones del Combobox con el cliente entero en `data`', async () => {
    grant('waiter')
    searchCustomers.mockResolvedValue([
      MELINA,
      { ...MELINA, id: 'c-2', first_name: '', last_name: '' },
    ])
    const res = await call('slug=hub&q=%20mel%20')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    // `q` llega recortado a la consulta.
    expect(searchCustomers).toHaveBeenCalledWith('hub', 'mel')
    const body = (await res.json()) as {
      options: Array<{ value: string; label: string; description: string; data: unknown }>
    }
    expect(body.options).toHaveLength(2)
    expect(body.options[0]).toEqual({
      value: 'c-1',
      label: 'Melina Gómez',
      description: '+54 9 351 555-1234',
      // El aviso que la app no conoce se descarta.
      data: { ...MELINA, service_alerts: ['celiac'] },
    })
    expect(body.options[1]?.label).toBe('Sin nombre')
  })

  it('500 sin PII en el log cuando falla algo inesperado', async () => {
    grant('owner')
    searchCustomers.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call('slug=hub&q=3515551234')
    expect(res.status).toBe(500)
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toContain('3515551234')
    expect(logged).toContain('hub')
    spy.mockRestore()
  })
})
