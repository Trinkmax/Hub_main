import { notFound, redirect } from 'next/navigation'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

/**
 * La puerta de las páginas de la guía: la puede leer cualquiera que entra a Administración (los
 * dueños con acceso y la contadora). Cada página la llama por su cuenta, como todas las de la
 * sección: ninguna confía solo en el layout.
 *
 * Sin sesión, al login (y de ahí de vuelta a `path`); sin acceso o con la sección apagada, 404.
 * `canWrite` decide si se ofrecen los botones «Hacerlo ahora»: la contadora no ve ninguno.
 */
export async function requireGuideAccess(
  tenantSlug: string,
  /** La página, después de `/administracion` (`/guias/dia-a-dia`). */
  path: string,
): Promise<{ access: TenantAccess; base: string; canWrite: boolean }> {
  const base = `/${tenantSlug}/administracion`
  try {
    const access = await requireAccountingAccess(tenantSlug, 'read')
    return { access, base, canWrite: access.role === 'owner' && access.accounting.write }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}${path}`)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }
}
