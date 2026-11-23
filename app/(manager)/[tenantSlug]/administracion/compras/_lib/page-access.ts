import 'server-only'

import { notFound, redirect } from 'next/navigation'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  accountingAllows,
  isPurchasesOnly,
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
 *
 * **El nivel.** Por defecto la puerta es la estricta (`level: 'full'`): pide ver TODO Administración.
 * La comparten Gastos fijos, Sueldos y el Plan de la semana, que son del nivel completo. Las tres
 * pantallas de Compras y pagos (la lista, cargar una compra y la ficha del proveedor) la piden con
 * `level: 'purchases'`: ahí también entra quien tiene «solo compras y pagos», y `canWrite` es que
 * pueda cargar compras. `purchasesOnly` les dice que ese es el nivel de quien mira, para no ofrecerle
 * lo que no puede usar (anular, exportar, gastos fijos, la semana, ARCA) ni pedir lecturas que la base
 * le va a rechazar.
 */
export type ComprasAccessLevel = 'full' | 'purchases'

export async function requireComprasAccess(
  tenantSlug: string,
  returnTo: string,
  opts: { level?: ComprasAccessLevel } = {},
): Promise<{
  access: TenantAccess
  canWrite: boolean
  branch: AccBranchView
  /** Quien mira tiene «solo compras y pagos» (siempre `false` con `level: 'full'`). */
  purchasesOnly: boolean
}> {
  const purchases = opts.level === 'purchases'
  try {
    const access = await requireAccountingAccess(tenantSlug, purchases ? 'buy_read' : 'read')
    // La sucursal que se mira, una vez por pedido (las pantallas de todo el bar no la usan).
    const branch = accBranchView(await getBranchScope(tenantSlug))
    return {
      access,
      canWrite:
        access.role === 'owner' &&
        accountingAllows(access.accounting, purchases ? 'buy_write' : 'write'),
      branch,
      purchasesOnly: purchases && isPurchasesOnly(access.accounting),
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
