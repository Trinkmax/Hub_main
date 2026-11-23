'use server'

/**
 * Accesos a Administración por persona (B.4, B.5, H.17 › Accesos).
 *
 * Dar, cambiar y quitar: solo quien «da accesos» (administrador). Cada acceso
 * tiene un nivel: completo (todo Administración) o solo compras y pagos. La
 * base vuelve a decidir todo bajo el lock del bar: el destino tiene que ser
 * dueño, dar accesos pide el nivel completo (`admin_needs_full`), nunca queda
 * el bar sin administrador (`last_admin`) y todo se audita adentro.
 * «Recuperar» (`claimAccountingAdmin`): un dueño con acceso completo, solo si
 * no quedó ningún administrador.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccountingScope, scopeOf } from '@/lib/accounting/access-levels'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import { revokeAccessSchema, setAccessSchema } from '@/lib/accounting/schemas'
import { createClient } from '@/lib/supabase/server'
import {
  asRecord,
  boolOf,
  formInput,
  revalidateAccounting,
  rpcFailure,
  textOf,
  unexpectedFailure,
} from './support'

export type GrantedAccess = {
  /** Fila de `acc_access`. */
  id: string
  userId: string
  displayName: string
  isAdmin: boolean
  /** El nivel con el que quedó. */
  scope: AccountingScope
  source: 'setup' | 'grant' | 'platform' | 'claim'
  grantedAt: string | null
  /** `false`: ya tenía acceso y se le cambió el nivel, «Da accesos» o el nombre. */
  created: boolean
}

const SOURCES = ['setup', 'grant', 'platform', 'claim'] as const

function grantedRow(data: unknown): GrantedAccess {
  const r = asRecord(data) ?? {}
  const source = SOURCES.find((s) => s === r.source) ?? 'grant'
  return {
    id: textOf(r.id) ?? '',
    userId: textOf(r.user_id) ?? '',
    displayName: textOf(r.display_name) ?? '',
    isAdmin: boolOf(r.is_admin),
    scope: scopeOf(r.scope),
    source,
    grantedAt: textOf(r.granted_at),
    created: boolOf(r.created),
  }
}

/**
 * Le da acceso a un dueño eligiendo el nivel, o le cambia el nivel, «Da accesos» y el nombre que se
 * ve en Administración a quien ya lo tiene. El nombre vacío deja el que tenía (o toma el de su cuenta).
 */
export async function setAccountingAccess(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<GrantedAccess>> {
  const op = 'access.set'
  try {
    const auth = await authorizeAccounting(slug, 'admin')
    if (!auth.ok) return auth.state
    const parsed = setAccessSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_set_access', {
      p_tenant_id: auth.tenantId,
      p_user_id: parsed.data.userId,
      p_scope: parsed.data.scope,
      p_is_admin: parsed.data.isAdmin,
      ...(parsed.data.displayName === null ? {} : { p_display_name: parsed.data.displayName }),
    })
    if (error) return rpcFailure(op, error)
    const row = grantedRow(data)

    // Cambia lo que ve esa persona (y su menú): se refresca el bar entero.
    revalidateAccounting(slug, 'tenant')
    const name = row.displayName || 'Esa persona'
    return {
      ok: true,
      data: row,
      message: !row.created
        ? `Listo: actualizamos el acceso de ${name}.`
        : row.scope === 'full'
          ? `Listo: ${name} ya ve todo Administración.`
          : `Listo: ${name} ya puede cargar compras y pagos.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/** Le saca el acceso a alguien (queda en la historia; nunca se borra). */
export async function revokeAccountingAccess(slug: string, raw: unknown): Promise<AccSimpleState> {
  const op = 'access.revoke'
  try {
    const auth = await authorizeAccounting(slug, 'admin')
    if (!auth.ok) return auth.state
    const parsed = revokeAccessSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_revoke_access', {
      p_tenant_id: auth.tenantId,
      p_user_id: parsed.data.userId,
      p_reason: parsed.data.reason,
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug, 'tenant')
    const self = parsed.data.userId === auth.userId
    return {
      ok: true,
      data: undefined,
      message: self
        ? 'Listo: ya no tenés acceso a Administración.'
        : 'Acceso quitado: ya no ve Administración.',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * Recuperación (B.4.4): si no quedó nadie que dé accesos, un dueño con acceso
 * pasa a darlos. La base lo rechaza con `admins_exist` si todavía hay alguien.
 */
export async function claimAccountingAdmin(slug: string): Promise<AccSimpleState> {
  const op = 'access.claim'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_claim_admin', { p_tenant_id: auth.tenantId })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug, 'tenant')
    return {
      ok: true,
      data: undefined,
      message: 'Listo: ahora vos das los accesos de Administración.',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
