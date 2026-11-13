import 'server-only'
import { isFeatureEnabled } from '@/lib/platform/features'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'

/**
 * Quién arma el punto de venta: las sucursales y sus ajustes son del dueño. Espeja las
 * políticas de la base (`branches_owner_*` y `pos_settings_owner_write`), que son las que
 * mandan: acá solo se corta antes para contestar con un mensaje que se entienda.
 */
export const POS_SETUP_ROLES: ReadonlyArray<TenantRole> = ['owner']

export type SetupAccess =
  | { ok: true; tenantId: string; userId: string; timezone: string }
  | { ok: false; code: 'forbidden' | 'error'; message: string }

/**
 * Lo que toda acción de «Sucursales» comprueba primero: hay sesión, la persona es dueña de
 * ESTE bar y el bar tiene el punto de venta prendido.
 */
export async function authorizeSetup(slug: unknown): Promise<SetupAccess> {
  if (typeof slug !== 'string' || slug === '') {
    return {
      ok: false,
      code: 'error',
      message: 'No pudimos leer lo que mandó la pantalla. Recargá la página y probá de nuevo.',
    }
  }
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, POS_SETUP_ROLES)
    if (!isFeatureEnabled(access.tenant, 'pos') && !access.isPlatformAdmin) {
      return {
        ok: false,
        code: 'forbidden',
        message: 'El punto de venta no está prendido en este bar.',
      }
    }
    return {
      ok: true,
      tenantId: access.tenant.id,
      userId: access.user.id,
      timezone: access.tenant.timezone || 'America/Argentina/Cordoba',
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, code: 'forbidden', message: 'Se cerró tu sesión. Volvé a entrar.' }
    }
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) {
      return {
        ok: false,
        code: 'forbidden',
        message: 'Solo un dueño del bar puede cambiar las sucursales y sus ajustes.',
      }
    }
    console.error('[pos.setup.authorize]', error instanceof Error ? error.message : 'unknown')
    return {
      ok: false,
      code: 'error',
      message: 'No pudimos comprobar tu acceso. Probá de nuevo en un momento.',
    }
  }
}
