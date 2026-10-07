import { revalidatePath } from 'next/cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateTenantConfig } from '@/lib/admin/tenant-config'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
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

const SLUG = 'hub'
const TENANT = 'tenant-a'

type UpdateCall = { table: string; payload: unknown; filter: [string, unknown] | null }

function fakeSupabase(error: { message: string } | null) {
  const calls: UpdateCall[] = []
  const client = {
    from(table: string) {
      return {
        update(payload: unknown) {
          const call: UpdateCall = { table, payload, filter: null }
          calls.push(call)
          return {
            eq(column: string, value: unknown) {
              call.filter = [column, value]
              return Promise.resolve({ data: null, error })
            },
          }
        },
      }
    },
  }
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  return calls
}

function asRole(role: TenantRole) {
  vi.mocked(requireTenantAccess).mockResolvedValue({
    tenant: { id: TENANT },
    role,
    user: { id: 'user-a' },
  } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
}

function configForm(): FormData {
  const fd = new FormData()
  fd.set('guest_idle_hours_to_rescan', '2')
  fd.set('session_auto_abandon_hours', '6')
  fd.set('ticket_auto_accept_enabled', 'on')
  fd.set('ticket_auto_accept_max_cents', '5000000')
  fd.set('ticket_auto_accept_max_items', '')
  return fd
}

const revalidated = () => vi.mocked(revalidatePath).mock.calls.map((call) => call[0])

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear()
  asRole('owner')
})

describe('updateTenantConfig', () => {
  it('guarda y revalida Configuración y Local › Auto-aceptación (donde vive el formulario)', async () => {
    const calls = fakeSupabase(null)
    const result = await updateTenantConfig(SLUG, { ok: true }, configForm())
    expect(result).toEqual({ ok: true, message: 'Guardado.' })
    expect(calls).toEqual([
      {
        table: 'tenants',
        payload: {
          guest_idle_hours_to_rescan: 2,
          session_auto_abandon_hours: 6,
          ticket_auto_accept_enabled: true,
          ticket_auto_accept_max_cents: 5000000,
          ticket_auto_accept_max_items: null,
          kitchen_flow_enabled: false,
        },
        filter: ['id', TENANT],
      },
    ])
    expect(revalidated()).toEqual([`/${SLUG}/configuracion`, `/${SLUG}/local/auto-aceptacion`])
  })

  it('si no se pudo guardar, no revalida', async () => {
    fakeSupabase({ message: 'boom' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await updateTenantConfig(SLUG, { ok: true }, configForm())
      expect(result).toEqual({ ok: false, message: 'No se pudo guardar.' })
      expect(revalidatePath).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('solo el dueño: sin permiso no toca nada', async () => {
    const calls = fakeSupabase(null)
    asRole('cashier')
    const result = await updateTenantConfig(SLUG, { ok: true }, configForm())
    expect(result).toEqual({ ok: false, message: 'No tenés permiso.' })
    expect(calls).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
