import 'server-only'

import { notFound, redirect } from 'next/navigation'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { type AccBranchView, accBranchView } from '@/lib/accounting/branch'
import { getBranchScope } from '@/lib/branches/scope'
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
 *
 * `branch` es la sucursal que se mira (`getBranchScope`, una vez por pedido): las pantallas por sucursal se la
 * pasan a sus lecturas (docs/features/sucursales.md › La regla para cada pantalla).
 */
export async function requireComprasAccess(
  tenantSlug: string,
  returnTo: string,
): Promise<{ access: TenantAccess; canWrite: boolean; branch: AccBranchView }> {
  try {
    const access = await requireAccountingAccess(tenantSlug, 'read')
    // La sucursal que se mira, una vez por pedido (las pantallas de todo el bar no la usan).
    const branch = accBranchView(await getBranchScope(tenantSlug))
    return { access, canWrite: access.role === 'owner' && access.accounting.write, branch }
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
