'use server'

/**
 * Server actions de los importadores de Administración (diseño §4.0, WP6):
 * subir → revisar → confirmar.
 *
 * Todas reciben el `slug` de la URL y un objeto, empiezan con
 * `authorizeAccounting(slug, 'write')` (dueño con acceso de carga; la contadora
 * no importa), validan con zod (`lib/imports/server/types.ts`) y devuelven un
 * `AccSimpleState` (`lib/accounting/action-state.ts`) con el texto listo para
 * mostrar. Corren con la sesión del usuario: nunca `service_role` (el cron de
 * Mercado Pago usa sus RPC `*_service` aparte y nunca contabiliza, D7).
 *
 * El flujo de la pantalla:
 * 1. El navegador parsea el archivo (`lib/imports/**`) y calcula su SHA-256.
 * 2. `createImportBatch` → `addImportItems` en tandas (≤ 1000 filas y < 1 MB
 *    por llamada; un reenvío no duplica). Un archivo repetido vuelve con
 *    `detail.key = 'import_file_already'`, `detail.batch_id` y, si ese lote quedó
 *    a medio subir, `detail.resumable = true`.
 * 3. `buildImportProposals` arma las propuestas; la pantalla las lee con
 *    `lib/imports/server/queries.ts`. Lo que falta se resuelve con
 *    `resolveImportNeeds` y `createImportSuppliers` (los dos vuelven a armar).
 * 4. `postImportProposals` de a 15, en bucle («Cargando 45 de 142…»); se puede
 *    cortar y retomar: lo ya cargado se saltea (estado y `client_ref`).
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import {
  accFailure,
  asRecord,
  boolOf,
  fieldFailure,
  intOf,
  rpcFailure,
  textOf,
  unexpectedFailure,
} from '@/lib/accounting/actions/support'
import { ONBOARDING_MANUAL_STEPS } from '@/lib/accounting/onboarding'
import { revalidateAdministracion } from '@/lib/accounting/server/post-document'
import { createClient } from '@/lib/supabase/server'
import { postImportProposalsFor } from './server/post'
import { BANK_EXPENSE_COMPONENTS } from './server/proposals/bank'
import { createImportSuppliersFor, rebuildBatch, resolveImportNeedsFor } from './server/propose'
import { isSafePattern, SAFE_PATTERN_HELP } from './server/safe-pattern'
import { addImportItemsFor, createImportBatchFor } from './server/stage'
import {
  type AddImportItemsInput,
  type AddImportItemsResult,
  BANK_RULE_KINDS,
  type BuildProposalsResult,
  batchOnlySchema,
  type CreateImportBatchInput,
  type CreateImportBatchResult,
  type CreateImportSuppliersInput,
  type CreateImportSuppliersResult,
  cancelImportBatchSchema,
  deleteImportRuleSchema,
  MP_COBRO_CHANNELS,
  MP_TAX_COMPONENTS,
  markOnboardingStepSchema,
  type PostImportProposalsInput,
  type PostImportResult,
  type ResolveImportNeedsInput,
  type SavedImportRule,
  type SavedMpSettings,
  type SaveImportLayoutInput,
  type SaveImportRuleInput,
  type SaveMpSettingsInput,
  saveImportLayoutSchema,
  saveImportRuleSchema,
  saveMpSettingsSchema,
} from './server/types'

type Authorized = Extract<Awaited<ReturnType<typeof authorizeAccounting>>, { ok: true }>

function isPgError(error: unknown): error is { message?: string; code?: string; details?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  )
}

/** Permiso de carga + manejo de lo inesperado (sin datos personales en el log). */
async function asWriter<T>(
  op: string,
  slug: unknown,
  run: (auth: Authorized) => Promise<AccSimpleState<T>>,
): Promise<AccSimpleState<T>> {
  try {
    if (typeof slug !== 'string' || slug === '') return accFailure('forbidden')
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    return await run(auth)
  } catch (error) {
    if (isPgError(error)) return rpcFailure(op, error)
    return unexpectedFailure(op, error)
  }
}

// ─── Subir ───────────────────────────────────────────────────────────────────

/** El lote de un archivo (idempotente por SHA-256: «Ya importaste este archivo el…»). */
export async function createImportBatch(
  slug: string,
  input: CreateImportBatchInput,
): Promise<AccSimpleState<CreateImportBatchResult>> {
  return asWriter('imports.createBatch', slug, (auth) => createImportBatchFor(auth, input))
}

/** Una tanda de filas ya parseadas (hasta 1000; reenviarla no duplica nada). */
export async function addImportItems(
  slug: string,
  input: AddImportItemsInput,
): Promise<AccSimpleState<AddImportItemsResult>> {
  return asWriter('imports.addItems', slug, (auth) => addImportItemsFor(auth, input))
}

// ─── Revisar ─────────────────────────────────────────────────────────────────

/** Arma (o vuelve a armar: «Revisar de nuevo») las propuestas del lote. */
export async function buildImportProposals(
  slug: string,
  input: { batchId: string },
): Promise<AccSimpleState<BuildProposalsResult>> {
  return asWriter('imports.build', slug, async (auth) => {
    const parsed = batchOnlySchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const result = await rebuildBatch(auth, parsed.data.batchId)
    if (result.ok) revalidateAdministracion(auth.slug)
    return result
  })
}

/**
 * Lo que la persona completó en la revisión (cuenta habitual, condición del
 * proveedor, «otros tributos», medio de un canal, a quién, «no es nuestro»,
 * aceptar un aviso, confirmar…). Aplica todo y vuelve a armar.
 */
export async function resolveImportNeeds(
  slug: string,
  input: ResolveImportNeedsInput,
): Promise<AccSimpleState<BuildProposalsResult>> {
  return asWriter('imports.resolve', slug, (auth) => resolveImportNeedsFor(auth, input))
}

/** «Crear N proveedores» con su cuenta habitual; después vuelve a armar el lote. */
export async function createImportSuppliers(
  slug: string,
  input: CreateImportSuppliersInput,
): Promise<AccSimpleState<CreateImportSuppliersResult>> {
  return asWriter('imports.suppliers', slug, (auth) => createImportSuppliersFor(auth, input))
}

// ─── Confirmar ───────────────────────────────────────────────────────────────

/** Carga hasta 15 propuestas (cada una con su `acc_post_bundle`). Se llama en bucle. */
export async function postImportProposals(
  slug: string,
  input: PostImportProposalsInput,
): Promise<AccSimpleState<PostImportResult>> {
  return asWriter('imports.post', slug, (auth) => postImportProposalsFor(auth, input))
}

/** Cancela el lote: lo que no se cargó queda afuera; lo cargado queda (se anula como siempre). */
export async function cancelImportBatch(
  slug: string,
  input: { batchId: string; reason?: string | null },
): Promise<AccSimpleState<null>> {
  return asWriter('imports.cancel', slug, async (auth) => {
    const parsed = cancelImportBatchSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_import_cancel_batch', {
      p_tenant_id: auth.tenantId,
      p_batch_id: parsed.data.batchId,
      p_reason: parsed.data.reason,
    })
    if (error) return rpcFailure('imports.cancel', error)
    revalidateAdministracion(auth.slug)
    return {
      ok: true,
      data: null,
      message: 'Importación cancelada. Lo que ya estaba cargado queda.',
    }
  })
}

// ─── Reglas y formatos ───────────────────────────────────────────────────────

function ruleRow(raw: unknown): SavedImportRule | null {
  const r = asRecord(raw)
  const id = textOf(r?.id)
  if (!r || !id) return null
  return {
    id,
    source: textOf(r.source) ?? '',
    priority: intOf(r.priority) ?? 100,
    label: textOf(r.label) ?? '',
    match: asRecord(r.match) ?? {},
    action: asRecord(r.action) ?? {},
    active: boolOf(r.active, true),
    updatedAt: textOf(r.updated_at),
  }
}

/** Lo que cada origen entiende de una regla (lo demás, la base lo guardaría pero nadie lo aplicaría). */
function ruleShapeFailure(v: {
  source: string
  match: { pattern?: string; party_id?: string }
  action: {
    kind: string
    component?: string
    account_id?: string
    party_id?: string
    treasury_account_id?: string
    other_taxes_as?: string
  }
}) {
  const a = v.action
  if (v.source === 'arca_recibidos') {
    return a.kind === 'other_taxes' && v.match.party_id && a.other_taxes_as
      ? null
      : fieldFailure('action.kind', 'Elegí el proveedor y cómo se cargan sus otros tributos.')
  }
  if (v.source === 'mp_release') {
    const ok =
      a.kind === 'mp_tax' &&
      !!v.match.pattern &&
      (MP_TAX_COMPONENTS as readonly unknown[]).includes(a.component) &&
      (a.component !== 'otro' || !!a.account_id)
    return ok ? null : fieldFailure('action.kind', 'Elegí el impuesto y adónde va.')
  }
  const ok =
    (BANK_RULE_KINDS as readonly string[]).includes(a.kind) &&
    (a.kind !== 'expense_component' ||
      (BANK_EXPENSE_COMPONENTS as readonly unknown[]).includes(a.component)) &&
    (a.kind !== 'transfer' || !!a.treasury_account_id) &&
    ((a.kind !== 'payment' && a.kind !== 'collection') || !!a.party_id) &&
    (a.kind !== 'movement' || !!a.account_id)
  return ok ? null : fieldFailure('action.kind', 'Elegí qué hacer con esos movimientos.')
}

/**
 * Alta o edición de una regla («Recordar para este proveedor», «Crear regla»
 * del banco, un impuesto de Mercado Pago). El patrón tiene que entrar en el
 * subconjunto seguro (el servidor nunca corre una expresión regular del bar).
 */
export async function saveImportRule(
  slug: string,
  input: SaveImportRuleInput,
): Promise<AccSimpleState<SavedImportRule>> {
  return asWriter('imports.saveRule', slug, async (auth) => {
    const parsed = saveImportRuleSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data
    if (v.match.pattern !== undefined && !isSafePattern(v.match.pattern)) {
      return fieldFailure('match.pattern', SAFE_PATTERN_HELP)
    }
    const failure = ruleShapeFailure(v)
    if (failure) return failure
    const rule: Record<string, unknown> = {
      priority: v.priority,
      label: v.label,
      match: v.match,
      action: v.action,
      active: v.active,
    }
    if (v.id) rule.id = v.id
    else rule.source = v.source
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_import_save_rule', {
      p_tenant_id: auth.tenantId,
      p_rule: rule,
      p_expected_updated_at: v.id ? v.expectedUpdatedAt : null,
    })
    if (error) return rpcFailure('imports.saveRule', error)
    const row = ruleRow(data)
    if (!row) return unexpectedFailure('imports.saveRule', new Error('respuesta vacía'))
    revalidateAdministracion(auth.slug)
    return { ok: true, data: row, message: v.id ? 'Regla guardada.' : 'Regla creada.' }
  })
}

export async function deleteImportRule(
  slug: string,
  input: { ruleId: string },
): Promise<AccSimpleState<null>> {
  return asWriter('imports.deleteRule', slug, async (auth) => {
    const parsed = deleteImportRuleSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_import_delete_rule', {
      p_tenant_id: auth.tenantId,
      p_rule_id: parsed.data.ruleId,
    })
    if (error) return rpcFailure('imports.deleteRule', error, { operation: 'delete' })
    revalidateAdministracion(auth.slug)
    return { ok: true, data: null, message: 'Regla borrada.' }
  })
}

/** «Contanos qué es cada columna»: el mapeo de un formato de extracto (por firma). */
export async function saveImportLayout(
  slug: string,
  input: SaveImportLayoutInput,
): Promise<AccSimpleState<{ id: string; signature: string }>> {
  return asWriter('imports.saveLayout', slug, async (auth) => {
    const parsed = saveImportLayoutSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_import_save_layout', {
      p_tenant_id: auth.tenantId,
      p_layout: {
        source: 'bank_statement',
        signature: v.signature,
        mapping: v.mapping,
        ...(v.treasuryAccountId ? { treasury_account_id: v.treasuryAccountId } : {}),
      },
    })
    if (error) return rpcFailure('imports.saveLayout', error)
    const id = textOf(asRecord(data)?.id)
    if (!id) return unexpectedFailure('imports.saveLayout', new Error('respuesta vacía'))
    return {
      ok: true,
      data: { id, signature: v.signature },
      message: 'Listo: la próxima vez reconocemos este formato solo.',
    }
  })
}

// ─── Mercado Pago (una vez) ──────────────────────────────────────────────────

/**
 * «Antes de la primera importación»: la billetera, el medio del cierre de cada
 * canal y el corte del día (`acc_mp_save_connection`). Sin token: conectar por
 * API es de la fase 3.
 */
export async function saveMercadoPagoImportSettings(
  slug: string,
  input: SaveMpSettingsInput,
): Promise<AccSimpleState<SavedMpSettings>> {
  return asWriter('imports.mpSettings', slug, async (auth) => {
    const parsed = saveMpSettingsSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data
    const patch: Record<string, unknown> = {}
    if (v.treasuryAccountId !== undefined) patch.treasury_account_id = v.treasuryAccountId
    if (v.partyId !== undefined) patch.party_id = v.partyId
    if (v.channelMethods !== undefined) patch.channel_methods = v.channelMethods
    if (v.dayCutoffHour !== undefined) patch.day_cutoff_hour = v.dayCutoffHour
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_mp_save_connection', {
      p_tenant_id: auth.tenantId,
      p_patch: patch,
      p_expected_updated_at: v.expectedUpdatedAt,
    })
    if (error) return rpcFailure('imports.mpSettings', error)
    const r = asRecord(data)
    const id = textOf(r?.id)
    if (!r || !id) return unexpectedFailure('imports.mpSettings', new Error('respuesta vacía'))
    const methods: SavedMpSettings['channelMethods'] = {}
    const raw = asRecord(r.channel_methods) ?? {}
    for (const channel of MP_COBRO_CHANNELS) {
      const m = textOf(raw[channel])
      if (m) methods[channel] = m
    }
    revalidateAdministracion(auth.slug)
    return {
      ok: true,
      data: {
        id,
        treasuryAccountId: textOf(r.treasury_account_id) ?? '',
        partyId: textOf(r.party_id) ?? '',
        status: textOf(r.status) ?? 'csv_only',
        channelMethods: methods,
        dayCutoffHour: intOf(r.day_cutoff_hour) ?? 0,
        updatedAt: textOf(r.updated_at),
      },
      message: 'Configuración de Mercado Pago guardada.',
    }
  })
}

// ─── «Cómo arrancar»: los ítems que se marcan a mano ─────────────────────────

/** «Ya lo hice» / deshacer en la guía «Cómo arrancar» (`acc_guide_progress`, guía `arranque`). */
export async function markOnboardingStep(
  slug: string,
  input: { step: string; done: boolean },
): Promise<AccSimpleState<{ step: string; done: boolean }>> {
  return asWriter('imports.onboardingStep', slug, async (auth) => {
    const parsed = markOnboardingStepSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const { step, done } = parsed.data
    if (!(ONBOARDING_MANUAL_STEPS as readonly string[]).includes(step)) {
      return fieldFailure('step', 'Ese paso se marca solo.')
    }
    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_guide_mark', {
      p_tenant_id: auth.tenantId,
      p_guide: 'arranque',
      p_step: step,
      p_done: done,
    })
    if (error) return rpcFailure('imports.onboardingStep', error)
    revalidateAdministracion(auth.slug)
    return { ok: true, data: { step, done }, message: done ? 'Marcado como hecho.' : 'Desmarcado.' }
  })
}
