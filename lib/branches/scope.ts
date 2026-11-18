import 'server-only'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { requireTenantAccess } from '@/lib/tenant/access'
import { BRANCH_PARAM_HEADER } from '@/lib/workspace'
import { branchCookieName, parseBranchCookie } from './cookie'
import { resolveBranchScope } from './resolve'
import type { BranchScope, BranchSurface } from './types'

/**
 * La sucursal (o las sucursales) que se miran en este pedido. Una sola resolución por pedido: el layout, la página y
 * las acciones del mismo pedido comparten el resultado. No va a la base: las sucursales de la persona ya vienen en
 * `get_tenant_access`.
 *
 * - `view` (el panel): puede ser «Todas».
 * - `device` (el salón): siempre una; la que eligió este dispositivo.
 */
export const getBranchScope = cache(
  async (slug: string, surface: BranchSurface = 'view'): Promise<BranchScope> => {
    const access = await requireTenantAccess(slug)
    const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
    return resolveBranchScope({
      branches: access.branches,
      role: access.role,
      unrestricted: access.realRole === 'owner' || access.realRole === 'accountant',
      cookie: parseBranchCookie(cookieStore.get(branchCookieName(access.tenant.id))?.value),
      param: headerStore.get(BRANCH_PARAM_HEADER),
      surface,
    })
  },
)
