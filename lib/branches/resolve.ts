import type { TenantRole } from '@/lib/tenant/types'
import type {
  BranchCookie,
  BranchRef,
  BranchScope,
  BranchScopeSource,
  BranchSurface,
} from './types'

/**
 * Los roles que trabajan EN un lugar: si tienen más de una sucursal y este dispositivo nunca eligió, la entrada les
 * pregunta «¿A dónde entrás?». La contadora y Contenido miran cosas de todo el bar (Administración, la carta):
 * arrancan en «Todas» sin preguntar.
 */
export const BRANCH_GATE_ROLES: ReadonlySet<TenantRole> = new Set<TenantRole>([
  'owner',
  'host',
  'cashier',
  'waiter',
  'kitchen',
])

/** El valor de `?sucursal=` que pide «Todas». */
export const ALL_BRANCHES_PARAM = 'todas'

export type ResolveBranchScopeInput = {
  /** Las sucursales activas que esta persona ve (de `get_tenant_access`), la principal primero. */
  branches: ReadonlyArray<BranchRef>
  /** El rol con el que se muestra (con «Ver como», el que se mira). */
  role: TenantRole
  /** Ve todas las sucursales del bar (dueño o contadora). */
  unrestricted: boolean
  cookie: BranchCookie | null
  /** `?sucursal=` del link: el slug de una sucursal o `todas`. */
  param: string | null | undefined
  surface: BranchSurface
}

/**
 * Qué sucursal se mira, en este orden: el link (`?sucursal=`) → lo que eligió este dispositivo (recortado a lo que
 * la persona tiene permitido) → su única sucursal → si tiene varias y nunca eligió, se pregunta (y mientras tanto se
 * usa la principal, para no mostrar nunca algo que no le toca).
 */
export function resolveBranchScope(input: ResolveBranchScopeInput): BranchScope {
  const branches = [...input.branches]
  const multi = branches.length > 1
  const canAll = multi && input.surface === 'view'
  const byId = (id: string | null | undefined) =>
    id ? branches.find((branch) => branch.id === id) : undefined
  const bySlug = (slug: string) => branches.find((branch) => branch.slug === slug)

  const cookieDevice =
    input.cookie?.kind === 'branch'
      ? byId(input.cookie.id)
      : input.cookie?.kind === 'all'
        ? byId(input.cookie.device)
        : undefined
  const device = cookieDevice ?? (branches.length === 1 ? branches[0] : undefined) ?? null

  const base = {
    branches,
    unrestricted: input.unrestricted,
    multi,
    canAll,
    device,
  }
  const one = (branch: BranchRef, source: BranchScopeSource, needsChoice = false): BranchScope => ({
    ...base,
    current: branch,
    isAll: false,
    ids: [branch.id],
    needsChoice,
    source,
  })
  const all = (source: BranchScopeSource): BranchScope => ({
    ...base,
    current: null,
    isAll: true,
    ids: branches.map((branch) => branch.id),
    needsChoice: false,
    source,
  })

  if (branches.length === 0) {
    return { ...base, current: null, isAll: false, ids: [], needsChoice: false, source: 'none' }
  }

  const param = input.param?.trim().toLowerCase()
  if (param) {
    if (param === ALL_BRANCHES_PARAM && canAll) return all('param')
    const linked = bySlug(param)
    if (linked) return one(linked, 'param')
  }

  if (input.surface === 'view') {
    if (input.cookie?.kind === 'all' && canAll) return all('cookie')
    if (cookieDevice) return one(cookieDevice, 'cookie')
  } else if (cookieDevice) {
    return one(cookieDevice, 'cookie')
  }

  const only = branches.length === 1 ? branches[0] : undefined
  if (only) return one(only, 'single')

  if (input.surface === 'view' && !BRANCH_GATE_ROLES.has(input.role)) return all('fallback')

  const fallback = branches.find((branch) => branch.isDefault) ?? branches[0]
  if (!fallback) return all('fallback')
  return one(fallback, 'fallback', true)
}
