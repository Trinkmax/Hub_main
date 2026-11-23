import 'server-only'

/**
 * Única puerta de Administración para páginas, acciones y exportes (G.1).
 *
 * CLAUDE.md §4.5: `requireTenantAccess` + `requireRole` siempre. El ROL es el
 * prerrequisito (dueño o contadora); el acceso por persona viene en
 * `access.accounting` (lo arma `get_tenant_access` → `acc_my_access` en el
 * mismo round-trip, cacheado por request) y la base lo vuelve a decidir en
 * cada RPC y en cada RLS. Esto solo decide qué se muestra y corta temprano.
 */

import { cache } from 'react'
import { isFeatureEnabled } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import {
  ACCOUNTING_READ_ROLES,
  ACCOUNTING_WRITE_ROLES,
  type AccountingAccess,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  type TenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { AccFailureState } from './action-state'
import { ACC_ERRORS, ACC_GENERIC_ERROR, type AccErrorKey, accErrorMessage } from './errors'

/**
 * Qué necesita la pantalla o la acción: ver, cargar, o dar accesos. `buy_read` y `buy_write` son las
 * de Compras y pagos: alcanzan con el nivel «solo compras y pagos» (y, claro, con el completo).
 */
export type AccountingNeed = 'read' | 'write' | 'admin' | 'buy_read' | 'buy_write'

/** El bar no tiene Administración prendida (flag `accounting`). */
export class AccountingDisabledError extends Error {
  readonly code = 'accounting_disabled'
  constructor(message: string = ACC_ERRORS.accounting_not_enabled.message) {
    super(message)
    this.name = 'AccountingDisabledError'
  }
}

/** Prendida, pero esta persona no tiene el acceso que hace falta. */
export class AccountingForbiddenError extends Error {
  readonly code = 'accounting_forbidden'
  constructor(message: string = ACC_ERRORS.forbidden.message) {
    super(message)
    this.name = 'AccountingForbiddenError'
  }
}

/**
 * ¿Alcanza el acceso para lo que se pide? Puro (lo usan también el layout y
 * los tests). Dar accesos exige además poder cargar: es la pantalla de
 * Ajustes › Accesos, que existe después de la puesta en marcha.
 */
export function accountingAllows(acc: AccountingAccess, need: AccountingNeed): boolean {
  if (!acc.enabled) return false
  if (need === 'read') return acc.read
  if (need === 'write') return acc.write
  if (need === 'buy_read') return acc.read || acc.buyRead === true
  if (need === 'buy_write') return acc.write || acc.buyWrite === true
  return acc.admin && acc.write
}

/**
 * ¿Es alguien con «solo compras y pagos»? Entra a Compras y pagos y a nada más de Administración: no
 * se le muestran saldos de las cajas, ventas, sueldos ni libros. Puro.
 */
export function isPurchasesOnly(acc: AccountingAccess): boolean {
  return acc.enabled && !acc.read && acc.buyRead === true
}

/**
 * Para páginas y route handlers: devuelve el acceso o tira.
 * - Sin sesión / no miembro: los errores de `requireTenantAccess`.
 * - Rol que no es dueño (ni contadora, para leer): `RoleRequiredError`.
 * - Flag apagado: `AccountingDisabledError`.
 * - Sin el acceso pedido: `AccountingForbiddenError`.
 */
export async function requireAccountingAccess(
  slug: string,
  need: AccountingNeed,
): Promise<TenantAccess> {
  const access = await requireTenantAccess(slug)
  requireRole(
    access.role,
    need === 'read' || need === 'buy_read' ? ACCOUNTING_READ_ROLES : ACCOUNTING_WRITE_ROLES,
  )
  if (!access.accounting.enabled) throw new AccountingDisabledError()
  if (!accountingAllows(access.accounting, need)) throw new AccountingForbiddenError()
  return access
}

/**
 * ¿La proyección de ventas toma lo que cobró el punto de venta? Solo si el bar lo tiene prendido y
 * quien mira es dueño: `pos_sales_days` es de dueños, y la contadora está aislada de todo lo que no es
 * Administración (para ella la proyección sale de los cierres, como siempre). Va por el interruptor del
 * bar, sin la excepción de superadmin: mirando un bar que no lo usa no hay nada que sumar.
 */
export function projectionUsesPos(access: {
  role: TenantRole
  tenant: Pick<TenantAccess['tenant'], 'feature_flags'>
}): boolean {
  return access.role === 'owner' && isFeatureEnabled(access.tenant, 'pos')
}

export type AccountingAuthorized = {
  ok: true
  access: TenantAccess
  /** El bar DE LA URL: el primer parámetro de toda RPC `acc_*`. */
  tenantId: string
  userId: string
  slug: string
  /**
   * Quien llama tiene el nivel «solo compras y pagos» (`isPurchasesOnly`). Solo puede darse en las
   * acciones que piden `buy_read` o `buy_write`: ahí sirve para no pedir lo que la base le va a
   * rechazar (gastos fijos, la semana) y para recortar el contexto del motor. `authorizeAccounting`
   * lo manda siempre; falta = no (este dato solo achica lo que se pide o se muestra: nunca abre nada).
   */
  purchasesOnly?: boolean
}

export type AccountingAuth = AccountingAuthorized | { ok: false; state: AccFailureState }

function denied(key: AccErrorKey): { ok: false; state: AccFailureState } {
  return {
    ok: false,
    state: {
      ok: false,
      code: ACC_ERRORS[key].code,
      message: accErrorMessage(key),
      detail: { key },
    },
  }
}

/**
 * Para server actions: lo mismo que `requireAccountingAccess`, pero sin tirar.
 * Devuelve el estado de error listo para el formulario (G.3):
 *
 * ```ts
 * const auth = await authorizeAccounting(slug, 'write')
 * if (!auth.ok) return auth.state
 * ```
 */
export async function authorizeAccounting(
  slug: string,
  need: AccountingNeed,
): Promise<AccountingAuth> {
  try {
    const access = await requireAccountingAccess(slug, need)
    return {
      ok: true,
      access,
      tenantId: access.tenant.id,
      userId: access.user.id,
      slug,
      purchasesOnly: isPurchasesOnly(access.accounting),
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) return denied('unauthenticated')
    if (error instanceof AccountingDisabledError) return denied('accounting_not_enabled')
    if (
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      return denied('forbidden')
    }
    console.error('[accounting.authorize]', error instanceof Error ? error.message : 'unknown')
    return { ok: false, state: { ok: false, code: 'error', message: ACC_GENERIC_ERROR } }
  }
}

// ─── Estado para el layout de /administracion ───────────────────────────────

export type AccountingState = {
  role: TenantRole
  /** Dueño o contadora: los únicos roles que pueden llegar a ver Administración. */
  eligible: boolean
  isOwner: boolean
  isAccountant: boolean
  /** El bar tiene Administración prendida. */
  enabled: boolean
  /** Ya se hizo la puesta en marcha. */
  setUp: boolean
  /** Esta persona puede hacer la puesta en marcha ahora. */
  canSetUp: boolean
  read: boolean
  write: boolean
  /** Entra a Compras y pagos: quien lee todo y quien tiene «solo compras y pagos». */
  buyRead: boolean
  /** Carga compras y pagos: dueño con acceso vigente, del nivel que sea. */
  buyWrite: boolean
  /** El nivel de esta persona es «solo compras y pagos»: la sección le muestra Compras y nada más. */
  purchasesOnly: boolean
  /** Da y quita accesos (y suma a la contadora). */
  admin: boolean
  /**
   * Quiénes administran los accesos (solo nombres, nunca emails). Se piden
   * únicamente cuando la pantalla los muestra: un dueño sin acceso
   * («Administración es privada…») o uno que no configura («La va a configurar
   * {nombre}»). En cualquier otro caso, `[]`.
   */
  adminNames: string[]
}

async function loadAdminNames(tenantId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('acc_admin_names', { p_tenant_id: tenantId })
  if (error) {
    console.error('[accounting.adminNames]', error.code, error.message)
    return []
  }
  if (!Array.isArray(data)) return []
  const names: string[] = []
  for (const row of data as unknown[]) {
    const name =
      row !== null && typeof row === 'object' && 'display_name' in row
        ? (row as { display_name: unknown }).display_name
        : null
    if (typeof name === 'string' && name.trim() !== '' && !names.includes(name.trim())) {
      names.push(name.trim())
    }
  }
  return names
}

/**
 * Lo que el layout de Administración necesita para decidir qué mostrar
 * (G.1 · H.18): cacheado por request, sale del mismo `get_tenant_access` que ya
 * resolvió el layout del panel (más `acc_admin_names` solo para el dueño sin
 * acceso). Los errores de sesión o de bar los tira `requireTenantAccess`, igual
 * que en el resto del panel.
 */
export const getAccountingState = cache(async (slug: string): Promise<AccountingState> => {
  const access = await requireTenantAccess(slug)
  const acc = access.accounting
  const isOwner = access.role === 'owner'
  const isAccountant = access.role === 'accountant'
  const eligible = ACCOUNTING_READ_ROLES.includes(access.role)
  const read = eligible && accountingAllows(acc, 'read')
  const write = isOwner && accountingAllows(acc, 'write')
  const buyRead = eligible && accountingAllows(acc, 'buy_read')
  const buyWrite = isOwner && accountingAllows(acc, 'buy_write')
  const needsNames = isOwner && acc.enabled && !buyRead && !acc.canSetUp
  return {
    role: access.role,
    eligible,
    isOwner,
    isAccountant,
    enabled: eligible && acc.enabled,
    setUp: acc.setUp,
    canSetUp: isOwner && acc.canSetUp,
    read,
    write,
    buyRead,
    buyWrite,
    purchasesOnly: isOwner && isPurchasesOnly(acc),
    admin: isOwner && acc.admin,
    adminNames: needsNames ? await loadAdminNames(access.tenant.id) : [],
  }
})
