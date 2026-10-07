'use server'

/**
 * Puesta en marcha de Administración (H.3, C.2): el asistente, «Arrancar en
 * cero» y los saldos iniciales.
 *
 * `bootstrapAccounting` es la única acción que no exige acceso a
 * Administración (todavía nadie lo tiene): pide rol dueño + `canSetUp`, y la
 * RPC lo vuelve a decidir BAJO EL LOCK del bar (dos dueños a la vez: el segundo
 * recibe `already_set_up`).
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccActionState,
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { tryLoadPostingContext } from '@/lib/accounting/context'
import { ACC_ERRORS, engineErrorsState, warningCopy } from '@/lib/accounting/errors'
import { buildOpening, toRpcPayload } from '@/lib/accounting/posting'
import { bootstrapSchemaAt, openingSchema } from '@/lib/accounting/schemas'
import { todayInCordoba } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import {
  ACCOUNTING_WRITE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  type BootstrapResult as BootstrapResultData,
  type BootstrapTreasury as BootstrapTreasuryRow,
  bootstrapMethodsIssue,
  bootstrapPayload,
  parseBootstrapResult,
  parsePostBundleResult,
} from './payloads'
import {
  accFailure,
  fieldFailure,
  formInput,
  revalidateAccounting,
  rpcFailure,
  unexpectedFailure,
} from './support'

// ─── Tipos que devuelven ─────────────────────────────────────────────────────

export type BootstrapTreasury = BootstrapTreasuryRow
export type BootstrapResult = BootstrapResultData

// ─── Asistente (paso 2) ──────────────────────────────────────────────────────

type SetupGate = { ok: true; tenantId: string } | { ok: false; state: AccFailureState }

/** Dueño del bar, módulo prendido, sin configurar y habilitado para configurarlo. */
async function authorizeSetup(slug: unknown): Promise<SetupGate> {
  if (typeof slug !== 'string' || slug === '') return { ok: false, state: accFailure('forbidden') }
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(slug)
    requireRole(access.role, ACCOUNTING_WRITE_ROLES)
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, state: accFailure('unauthenticated') }
    }
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) {
      return { ok: false, state: accFailure('forbidden') }
    }
    throw error
  }
  const acc = access.accounting
  if (!acc.enabled) return { ok: false, state: accFailure('accounting_not_enabled') }
  if (acc.setUp) return { ok: false, state: accFailure('already_set_up') }
  if (!acc.canSetUp) return { ok: false, state: accFailure('not_allowed_to_set_up') }
  return { ok: true, tenantId: access.tenant.id }
}

/**
 * Paso 2 del asistente (H.3): datos de la SAS, cajas, medios de cobro y puntos
 * de venta → `acc_bootstrap`, que además siembra el plan de cuentas, los
 * partícipes del sistema y el ejercicio, y deja a quien configura como
 * administrador de los accesos.
 */
export async function bootstrapAccounting(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<BootstrapResult>> {
  try {
    const gate = await authorizeSetup(slug)
    if (!gate.ok) return gate.state

    const parsed = bootstrapSchemaAt(todayInCordoba()).safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const issue = bootstrapMethodsIssue(parsed.data)
    if (issue) return fieldFailure(issue.field, issue.message)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_bootstrap', {
      p_tenant_id: gate.tenantId,
      p_payload: bootstrapPayload(parsed.data),
    })
    if (error) return rpcFailure('setup.bootstrap', error)

    // El menú del bar cambia (aparece Administración): se refresca todo el shell.
    revalidateAccounting(slug, 'tenant')
    return {
      ok: true,
      data: parseBootstrapResult(data),
      message: 'Listo: Administración quedó configurada.',
    }
  } catch (error) {
    return unexpectedFailure('setup.bootstrap', error)
  }
}

// ─── Paso 3: «Arrancar en cero» o los saldos iniciales ──────────────────────

/** «Arrancar en cero»: sin asiento de apertura (idempotente). */
export async function skipOpening(slug: string): Promise<AccSimpleState> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_skip_opening', { p_tenant_id: auth.tenantId })
    if (error) return rpcFailure('setup.skipOpening', error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: undefined,
      message: 'Listo: Administración arranca sin saldos iniciales.',
    }
  } catch (error) {
    return unexpectedFailure('setup.skipOpening', error)
  }
}

/**
 * Paso 3 del asistente: el asiento de apertura (E.5.16) por el mismo camino
 * que todo comprobante (G.3): contexto desde la base, el mismo armador que vio
 * el formulario, hash de la vista previa, avisos y `acc_post_bundle`.
 */
export async function postOpening(slug: string, raw: unknown): Promise<AccActionState> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state

    const parsed = openingSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { clientRef, previewHash, ...input } = parsed.data

    const loaded = await tryLoadPostingContext(auth.tenantId)
    if (!loaded.ok) return loaded.state

    const built = buildOpening(input, loaded.ctx, { clientRef })
    if (!built.ok) return engineErrorsState(built.errors)
    if (built.hash !== previewHash) {
      return {
        ok: false,
        code: 'preview_stale',
        message: ACC_ERRORS.preview_stale.message,
        preview: built.preview,
        hash: built.hash,
      }
    }
    const pending = built.warnings.filter((w) => !input.warningsAck.includes(w.key))
    if (pending.length > 0) {
      return {
        ok: false,
        code: 'needs_confirmation',
        message: 'Revisá antes de guardar.',
        warnings: pending.map(warningCopy),
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_post_bundle', {
      p_tenant_id: auth.tenantId,
      p_client_ref: clientRef,
      p_bundle: toRpcPayload(built.bundle, built.hash),
    })
    if (error) return rpcFailure('setup.postOpening', error)

    revalidateAccounting(slug)
    return { ok: true, result: parsePostBundleResult(data), message: 'Saldos iniciales guardados.' }
  } catch (error) {
    return unexpectedFailure('setup.postOpening', error)
  }
}
