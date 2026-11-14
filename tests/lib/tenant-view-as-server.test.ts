import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Ver como» del lado del server: `requireTenantAccess` aplica la cookie solo a un superadmin
 * dueño, `actsAsPlatformAdmin` deja de abrir los paneles ocultos y `setViewAs` escribe o borra
 * la cookie y lleva al inicio del rol.
 */

const UID = '3924fd2f-4fc9-44f6-9cfd-352ac2972de9'

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  rpcPayload: null as unknown,
  isAdmin: true,
  set: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'hub_view_as' && state.cookie !== undefined ? { value: state.cookie } : undefined,
    set: state.set,
    delete: state.delete,
  })),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'get_tenant_access') return { data: state.rpcPayload, error: null }
      if (fn === 'is_platform_admin') return { data: state.isAdmin, error: null }
      return { data: null, error: { code: 'X', message: 'unexpected rpc' } }
    }),
  })),
}))

vi.mock('@/lib/tenant/current', () => ({
  getCurrentUser: vi.fn(async () => ({
    id: UID,
    email: 'dev@example.test',
    activeTenantId: null,
    tenants: null,
  })),
}))

const ACCOUNTING = {
  enabled: true,
  set_up: true,
  read: true,
  write: true,
  admin: true,
  can_set_up: false,
}

function payload(role: string, isPlatformAdmin: boolean) {
  return {
    tenant: { id: 't-1', slug: 'hub', name: 'HUB', feature_flags: {} },
    role,
    is_platform_admin: isPlatformAdmin,
    memberships: [],
    accounting: ACCOUNTING,
  }
}

beforeEach(() => {
  state.cookie = undefined
  state.rpcPayload = payload('owner', true)
  state.isAdmin = true
  state.set.mockReset()
  state.delete.mockReset()
})

describe('requireTenantAccess con «Ver como»', () => {
  it('superadmin dueño con la cookie: ve y se autoriza como ese rol', async () => {
    const { requireTenantAccess } = await import('@/lib/tenant/access')
    state.cookie = `${UID}:host`
    const access = await requireTenantAccess('hub')
    expect(access.role).toBe('host')
    expect(access.realRole).toBe('owner')
    expect(access.viewAs).toBe('host')
    expect(access.canViewAs).toBe(true)
    expect(access.isPlatformAdmin).toBe(false)
    expect(access.accounting.read).toBe(false)
    expect(access.accounting.write).toBe(false)
  })

  it('sin cookie: el rol de la base y el selector disponible', async () => {
    const { requireTenantAccess } = await import('@/lib/tenant/access')
    const access = await requireTenantAccess('hub')
    expect(access.role).toBe('owner')
    expect(access.viewAs).toBeNull()
    expect(access.canViewAs).toBe(true)
    expect(access.isPlatformAdmin).toBe(true)
    expect(access.accounting.write).toBe(true)
  })

  it('un dueño que no es superadmin no puede, aunque se fabrique la cookie', async () => {
    const { requireTenantAccess } = await import('@/lib/tenant/access')
    state.rpcPayload = payload('owner', false)
    state.cookie = `${UID}:waiter`
    const access = await requireTenantAccess('hub')
    expect(access.role).toBe('owner')
    expect(access.canViewAs).toBe(false)
  })
})

describe('actsAsPlatformAdmin', () => {
  it('superadmin sin «Ver como»: sí', async () => {
    const { actsAsPlatformAdmin } = await import('@/lib/platform/is-admin')
    expect(await actsAsPlatformAdmin()).toBe(true)
  })

  it('superadmin mirando otro rol: no (ve lo que ve esa persona)', async () => {
    const { actsAsPlatformAdmin } = await import('@/lib/platform/is-admin')
    state.cookie = `${UID}:waiter`
    expect(await actsAsPlatformAdmin()).toBe(false)
  })

  it('quien no es superadmin: no', async () => {
    const { actsAsPlatformAdmin } = await import('@/lib/platform/is-admin')
    state.isAdmin = false
    expect(await actsAsPlatformAdmin()).toBe(false)
  })
})

describe('setViewAs', () => {
  it('mirar como mozo: guarda la cookie del usuario y lleva al salón', async () => {
    const { setViewAs } = await import('@/lib/tenant/view-as-actions')
    await expect(setViewAs('hub', 'waiter')).rejects.toThrow('REDIRECT:/hub/salon')
    expect(state.set).toHaveBeenCalledWith(
      'hub_view_as',
      `${UID}:waiter`,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 43200 }),
    )
    expect(state.delete).not.toHaveBeenCalled()
  })

  it('anfitrión lleva a Reservas y contenido a la carta', async () => {
    const { setViewAs } = await import('@/lib/tenant/view-as-actions')
    await expect(setViewAs('hub', 'host')).rejects.toThrow('REDIRECT:/hub/reservas')
    await expect(setViewAs('hub', 'editor')).rejects.toThrow('REDIRECT:/hub/menu')
  })

  it('volver a dueño borra la cookie y lleva al inicio', async () => {
    const { setViewAs } = await import('@/lib/tenant/view-as-actions')
    state.cookie = `${UID}:waiter`
    await expect(setViewAs('hub', 'owner')).rejects.toThrow('REDIRECT:/hub')
    expect(state.delete).toHaveBeenCalledWith('hub_view_as')
    expect(state.set).not.toHaveBeenCalled()
  })

  it('un rol que no existe no hace nada', async () => {
    const { setViewAs } = await import('@/lib/tenant/view-as-actions')
    expect(await setViewAs('hub', 'superadmin')).toEqual({ ok: false, error: 'Ese rol no existe.' })
    expect(state.set).not.toHaveBeenCalled()
  })

  it('quien no es superadmin dueño no puede', async () => {
    const { setViewAs } = await import('@/lib/tenant/view-as-actions')
    state.rpcPayload = payload('owner', false)
    const result = await setViewAs('hub', 'waiter')
    expect(result.ok).toBe(false)
    expect(state.set).not.toHaveBeenCalled()
    expect(state.delete).not.toHaveBeenCalled()
  })
})
