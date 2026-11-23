import 'server-only'

import { notFound, redirect } from 'next/navigation'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  accountingAllows,
  isPurchasesOnly,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

/**
 * La puerta de cada página de Libros, Comprobantes y Asientos (CLAUDE.md §4.5
 * + G.1): el layout ya decidió flag, configuración y acceso, pero ninguna
 * página confía solo en él. Lectura: dueños con acceso y la contadora. Quien
 * no tiene acceso ve el 404 de la sección (no se le cuenta que existe).
 *
 * `canWrite` decide qué botones de carga, anulación y cierre se MUESTRAN: a la
 * contadora no se le dibujan (H.19), y la base igual rechaza cualquier
 * escritura que no sea de un dueño con acceso.
 *
 * **El nivel.** Por defecto pide ver TODO Administración (los libros, los asientos). Solo la ficha de
 * un comprobante la pide con `level: 'purchases'`: ahí también entra quien tiene «solo compras y
 * pagos», que ve sus compras, gastos y pagos (la base no le muestra otros) en una vista reducida.
 * Para ese nivel `canWrite` es siempre `false` (anular, reimputar y cambiar de sucursal son del nivel
 * completo) y `canAttach` dice si puede sumarle la foto.
 */
export async function requireBooksAccess(
  tenantSlug: string,
  returnTo: string,
  opts: { level?: 'full' | 'purchases' } = {},
): Promise<{
  access: TenantAccess
  canWrite: boolean
  /** Quien mira tiene «solo compras y pagos» (siempre `false` con `level: 'full'`). */
  purchasesOnly: boolean
  /** Puede sumar la foto del comprobante: quien carga todo o quien carga compras. */
  canAttach: boolean
}> {
  const purchases = opts.level === 'purchases'
  try {
    const access = await requireAccountingAccess(tenantSlug, purchases ? 'buy_read' : 'read')
    const purchasesOnly = purchases && isPurchasesOnly(access.accounting)
    return {
      access,
      canWrite: access.accounting.write,
      purchasesOnly,
      canAttach:
        access.role === 'owner' &&
        accountingAllows(access.accounting, purchases ? 'buy_write' : 'write'),
    }
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
