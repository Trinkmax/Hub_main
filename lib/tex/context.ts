import 'server-only'

import { todayInCordoba } from '@/lib/dates'
import { getEffectiveFeatures } from '@/lib/platform/features'
import {
  RoleRequiredError,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { TexToolContext } from './tools/types'

/**
 * Quién usa a Tex: el panel de gestión. Los del salón (mozos, caja, cocina) viven en otro espacio y no
 * lo tienen. Cada rol ve solo lo suyo: lo deciden `visible` de cada área y `need` de cada herramienta, y
 * después, al leer o escribir, la RLS y las acciones de siempre.
 */
export const TEX_ROLES: ReadonlyArray<TenantRole> = ['owner', 'editor', 'host', 'accountant']

export type TexContextResult =
  | { ok: true; ctx: TexToolContext }
  | { ok: false; status: number; message: string }

export async function texContext(slug: string): Promise<TexContextResult> {
  try {
    const access = await requireTenantAccess(slug)
    if (!TEX_ROLES.includes(access.role)) {
      return { ok: false, status: 403, message: 'Tex no está disponible para tu rol.' }
    }
    const { accounting } = access
    return {
      ok: true,
      ctx: {
        slug,
        tenantId: access.tenant.id,
        tenantName: access.tenant.name,
        userId: access.user.id,
        role: access.role,
        features: getEffectiveFeatures(access.tenant),
        isAccountant: access.role === 'accountant',
        access: {
          read: accounting.enabled && accounting.read,
          write: accounting.enabled && accounting.write,
          admin: accounting.enabled && accounting.admin,
        },
        today: todayInCordoba(),
      },
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, status: 401, message: 'Tu sesión venció. Volvé a entrar.' }
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return { ok: false, status: 403, message: 'No tenés acceso a este bar.' }
    }
    console.error('[tex.context]', error instanceof Error ? error.name : 'desconocido')
    return { ok: false, status: 500, message: 'Se me trabó algo. Probá de nuevo.' }
  }
}
