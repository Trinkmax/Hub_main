/**
 * «Actualizar en los celulares» (`forceCartaRefresh` en lib/menu/actions.ts, docs/features/carta-al-dia.md).
 * Lo que se fija: solo dueño y Contenido; sube la versión con `menu_force_refresh` del bar de la URL;
 * los errores de la base (sesión, permiso) vuelven como mensajes que se entienden; queda en la auditoría.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  TENANT: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  USER: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: 'owner' as string,
  accessError: null as Error | null,
  rpcResult: { data: null as unknown, error: null as { code: string; message: string } | null },
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args })
      return state.rpcResult
    },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/item-tags/actions', () => ({ setItemTags: vi.fn() }))
vi.mock('@/lib/tenant', async (actual) => ({
  ...(await actual<typeof import('@/lib/tenant')>()),
  requireTenantAccess: vi.fn(async () => {
    if (state.accessError) throw state.accessError
    return {
      tenant: { id: state.TENANT, name: 'HUB', slug: 'hub' },
      role: state.role,
      user: { id: state.USER },
    }
  }),
}))

import { logAudit } from '@/lib/audit'
import { forceCartaRefresh } from '@/lib/menu/actions'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from '@/lib/tenant'

const CHANGED_AT = '2026-11-15T23:10:00.123456+00:00'

beforeEach(() => {
  state.role = 'owner'
  state.accessError = null
  state.rpcResult = { data: { rev: 8, changed_at: CHANGED_AT }, error: null }
  state.rpcCalls = []
  vi.mocked(logAudit).mockClear()
})

describe('forceCartaRefresh', () => {
  it('el dueño sube la versión del bar de la URL y queda en la auditoría', async () => {
    await expect(forceCartaRefresh('hub')).resolves.toEqual({
      ok: true,
      data: { rev: 8, changedAt: CHANGED_AT },
    })
    expect(state.rpcCalls).toEqual([{ fn: 'menu_force_refresh', args: { p_tenant: state.TENANT } }])
    expect(logAudit).toHaveBeenCalledWith({
      tenantId: state.TENANT,
      userId: state.USER,
      action: 'menu.carta_refresh_forced',
      entity: 'menu',
      entityId: null,
      payload: { rev: 8 },
    })
  })

  it('Contenido (editor) también puede', async () => {
    state.role = 'editor'
    expect((await forceCartaRefresh('hub')).ok).toBe(true)
  })

  it('el resto del equipo no: ni llega a la base', async () => {
    for (const role of ['cashier', 'waiter', 'kitchen', 'host', 'accountant']) {
      state.role = role
      const result = await forceCartaRefresh('hub')
      expect(result).toEqual({
        ok: false,
        message: 'Solo el dueño o quien edita la carta puede actualizarla en los celulares.',
      })
    }
    expect(state.rpcCalls).toEqual([])
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('sin sesión pide volver a entrar; sin acceso al bar, sin permiso', async () => {
    state.accessError = new UnauthenticatedError()
    expect(await forceCartaRefresh('hub')).toEqual({
      ok: false,
      message: 'Tu sesión se cerró. Volvé a entrar y tocá «Actualizar ahora» de nuevo.',
    })
    state.accessError = new TenantNotFoundError()
    expect((await forceCartaRefresh('otro-bar')).ok).toBe(false)
    state.accessError = new RoleRequiredError()
    expect((await forceCartaRefresh('hub')).ok).toBe(false)
    expect(state.rpcCalls).toEqual([])
  })

  it('un slug vacío no consulta nada', async () => {
    expect((await forceCartaRefresh('  ')).ok).toBe(false)
    expect(state.rpcCalls).toEqual([])
  })

  it('la base vuelve a validar: 28000 es la sesión, 42501 el permiso', async () => {
    state.rpcResult = { data: null, error: { code: '28000', message: 'unauthenticated' } }
    expect(await forceCartaRefresh('hub')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Tu sesión se cerró'),
    })
    state.rpcResult = { data: null, error: { code: '42501', message: 'forbidden' } }
    expect(await forceCartaRefresh('hub')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Solo el dueño'),
    })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('cualquier otro error o una respuesta rara: mensaje para reintentar, sin auditoría', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = {
      ok: false,
      message: 'No pudimos actualizar la carta. Revisá la conexión y probá de nuevo en un rato.',
    }
    state.rpcResult = { data: null, error: { code: '57014', message: 'timeout' } }
    expect(await forceCartaRefresh('hub')).toEqual(failed)
    state.rpcResult = { data: { rev: 'x' }, error: null }
    expect(await forceCartaRefresh('hub')).toEqual(failed)
    expect(logAudit).not.toHaveBeenCalled()
    quiet.mockRestore()
  })
})
