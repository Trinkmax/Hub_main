import 'server-only'

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
 * La puerta de cada página de Compras (CLAUDE.md §4.5 + G.1): el layout de la
 * sección ya decidió flag, configuración y acceso, pero ninguna página confía
 * solo en él. Lectura: dueños con acceso y la contadora. Quien no tiene
 * acceso ve el 404 de la sección (no se le cuenta que existe).
 *
 * `canWrite` decide qué botones de carga, pago y edición se MUESTRAN: a la
 * contadora no se le dibujan (H.19). La base igual rechaza cualquier
 * escritura que no sea de un dueño con acceso.
 */
export async function requireComprasAccess(
  tenantSlug: string,
  returnTo: string,
): Promise<{ access: TenantAccess; canWrite: boolean }> {
  try {
    const access = await requireAccountingAccess(tenantSlug, 'read')
    return { access, canWrite: access.role === 'owner' && access.accounting.write }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(returnTo)}`)
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
