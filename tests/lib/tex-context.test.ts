/**
 * El contexto de Tex lleva la sucursal que mira el dispositivo (`getBranchScope`, la misma de las pantallas), en
 * datos planos: si se mira «Todas», cuál se mira, las que ve y el filtro de lectura.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tenant', () => ({
  requireTenantAccess: vi.fn(),
  RoleRequiredError: class RoleRequiredError extends Error {},
  TenantNotFoundError: class TenantNotFoundError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}))
vi.mock('@/lib/branches/scope', () => ({ getBranchScope: vi.fn() }))
vi.mock('@/lib/platform/features', () => ({ getEffectiveFeatures: vi.fn(() => ({})) }))

import { resolveBranchScope } from '@/lib/branches/resolve'
import { getBranchScope } from '@/lib/branches/scope'
import type { BranchCookie, BranchRef } from '@/lib/branches/types'
import { requireTenantAccess, type TenantRole, UnauthenticatedError } from '@/lib/tenant'
import { texBranchView } from '@/lib/tex/branch'
import { texContext } from '@/lib/tex/context'

function ref(
  id: string,
  name: string,
  opts: { shortName?: string; isDefault?: boolean; position: number },
): BranchRef {
  return {
    id,
    name,
    shortName: opts.shortName ?? null,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    color: '#1d4ed8',
    address: null,
    position: opts.position,
    isDefault: opts.isDefault ?? false,
    openedOn: null,
    seatCapacity: null,
  }
}

const ALTA = ref('00000000-0000-4000-8000-0000000000b1', 'Alta Córdoba', {
  shortName: 'AC',
  isDefault: true,
  position: 0,
})
const CERRO = ref('00000000-0000-4000-8000-0000000000b2', 'Cerro', { position: 1 })

function stubAccess(role: TenantRole, branches: BranchRef[], cookie: BranchCookie | null) {
  vi.mocked(requireTenantAccess).mockResolvedValue({
    tenant: { id: 'tenant-hub', name: 'HUB' },
    role,
    realRole: role,
    user: { id: 'user-1' },
    accounting: { enabled: true, read: true, write: role === 'owner', admin: false },
    branches,
  } as never)
  vi.mocked(getBranchScope).mockResolvedValue(
    resolveBranchScope({
      branches,
      role,
      unrestricted: role === 'owner',
      cookie,
      param: null,
      surface: 'view',
    }),
  )
}

const PLAIN_ALTA = { id: ALTA.id, name: 'Alta Córdoba', shortName: 'AC', isDefault: true }
const PLAIN_CERRO = { id: CERRO.id, name: 'Cerro', shortName: null, isDefault: false }

beforeEach(() => vi.clearAllMocks())

describe('el contexto de Tex', () => {
  it('lleva la sucursal que mira el dispositivo, en datos planos', async () => {
    stubAccess('owner', [ALTA, CERRO], { kind: 'branch', id: CERRO.id })
    const result = await texContext('hub')
    expect(getBranchScope).toHaveBeenCalledWith('hub')
    if (!result.ok) throw new Error(result.message)
    expect(result.ctx.branch).toEqual({
      isAll: false,
      currentId: CERRO.id,
      branches: [PLAIN_ALTA, PLAIN_CERRO],
      filter: { ids: [CERRO.id] },
    })
    // Viaja tal cual: sin funciones ni datos de la pantalla (el color, la dirección).
    expect(JSON.parse(JSON.stringify(result.ctx.branch))).toEqual(result.ctx.branch)
  })

  it('«Todas»: sin sucursal actual y, para un dueño, sin filtro', async () => {
    stubAccess('owner', [ALTA, CERRO], { kind: 'all', device: CERRO.id })
    const result = await texContext('hub')
    if (!result.ok) throw new Error(result.message)
    expect(result.ctx.branch).toEqual({
      isAll: true,
      currentId: null,
      branches: [PLAIN_ALTA, PLAIN_CERRO],
      filter: { ids: null },
    })
  })

  it('quien ve una sola sucursal la mira siempre a ella', async () => {
    stubAccess('host', [CERRO], null)
    const result = await texContext('hub')
    if (!result.ok) throw new Error(result.message)
    expect(result.ctx.branch).toEqual({
      isAll: false,
      currentId: CERRO.id,
      branches: [PLAIN_CERRO],
      filter: { ids: [CERRO.id] },
    })
  })

  it('texBranchView es lo mismo que arma el contexto', () => {
    const scope = resolveBranchScope({
      branches: [ALTA, CERRO],
      role: 'owner',
      unrestricted: true,
      cookie: { kind: 'branch', id: ALTA.id },
      param: null,
      surface: 'view',
    })
    expect(texBranchView(scope)).toEqual({
      isAll: false,
      currentId: ALTA.id,
      branches: [PLAIN_ALTA, PLAIN_CERRO],
      filter: { ids: [ALTA.id] },
    })
  })

  it('si la sesión vence al leer la sucursal, vuelve el 401 de siempre', async () => {
    stubAccess('owner', [ALTA, CERRO], null)
    vi.mocked(getBranchScope).mockRejectedValue(new UnauthenticatedError())
    expect(await texContext('hub')).toEqual({
      ok: false,
      status: 401,
      message: 'Tu sesión venció. Volvé a entrar.',
    })
  })
})
