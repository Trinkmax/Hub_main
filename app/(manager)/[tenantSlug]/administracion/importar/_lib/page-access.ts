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
 * La puerta de cada página de «Importar» (CLAUDE.md §4.5 + G.1): el layout de
 * Administración ya decidió flag, configuración y acceso, pero ninguna página
 * confía solo en él. Leen los dueños con acceso y la contadora (el hub, el
 * historial y la revisión, sin botones); quien no tiene acceso ve el 404 de la
 * sección. `canWrite` decide qué se MUESTRA para cargar: la base igual rechaza
 * cualquier escritura que no sea de un dueño con acceso.
 */
export async function requireImportAccess(
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

/** `searchParams` de Next trae un string o una lista: vale el primero, recortado. */
export function firstParam(value: string | string[] | undefined | null): string {
  const v = Array.isArray(value) ? value[0] : value
  return (v ?? '').trim()
}
