'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { authorizeSetup } from './authorize'
import { branchSlug, isNameTaken, suggestShortName } from './naming'
import { canBeDefault, canDeactivate, canDelete, positionWrites, sortBranches } from './order'
import { nextFreeColor } from './palette'
import { branchColumns, planBranchPatch } from './patch'
import {
  BRANCH_COLUMNS,
  type BranchRow,
  branchFromRow,
  readBranch,
  readBranches,
  readBranchWeight,
  untypedClient,
} from './queries'
import {
  createBranchSchema,
  deleteBranchSchema,
  firstIssue,
  reorderBranchesSchema,
  setDefaultBranchSchema,
  updateBranchSchema,
} from './schemas'
import type {
  Branch,
  BranchChange,
  BranchDeleteResult,
  BranchField,
  BranchListResult,
  BranchWriteResult,
} from './types'

/**
 * Lo que «Sucursales» escribe. Cada acción vuelve a comprobar quién es y qué rol tiene
 * (`authorizeSetup`: dueño de ESTE bar, con el punto de venta prendido), valida con zod, lee
 * la sucursal con el filtro del bar (una fila de otro bar no existe) y deja su renglón en la
 * auditoría (ids, colores y nombres de sucursal; ningún dato de personas).
 *
 * Nada se pisa: los datos de la ficha viajan con lo que la persona veía y se escriben solo si
 * la fila no cambió entre la lectura y la escritura (la versión es su `updated_at`).
 */

const INVALID = 'No pudimos leer lo que mandó la pantalla. Recargá la página y probá de nuevo.'
const READ_FAILED = 'No pudimos leer las sucursales de la base. Probá de nuevo en un momento.'
const NOT_SAVED = 'No se guardó. Revisá la conexión y probá de nuevo.'
const GONE = 'Esa sucursal ya no existe. Recargá la página.'
const CHANGED =
  'Otro dueño cambió esto recién y no se guardó lo tuyo. Ya ves cómo quedó: si querés otra cosa, cambialo de nuevo.'
const BUSY = 'Alguien más está cambiando esta sucursal en este momento. Probá de nuevo.'

/** Un tope de cordura: nadie abre cuarenta locales desde esta pantalla. */
const MAX_BRANCHES = 40
const ATTEMPTS = 3

const nameTaken = (name: string) =>
  `Ya hay una sucursal que se llama «${name}». Probá con otro nombre.`

function revalidate(slug: string) {
  revalidatePath(`/${slug}/local/sucursales`)
}

/** Crear una sucursal: alcanza con el nombre. El resto sale solo y se cambia después. */
export async function createBranch(slug: string, input: unknown): Promise<BranchWriteResult> {
  const auth = await authorizeSetup(slug)
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
  const parsed = createBranchSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: firstIssue(parsed.error) ?? INVALID }
  }
  const { tenantId, userId } = auth
  const { name } = parsed.data
  const supabase = await untypedClient()

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let branches: Branch[]
    try {
      branches = await readBranches(supabase, tenantId)
    } catch {
      return { ok: false, code: 'error', message: READ_FAILED }
    }
    if (isNameTaken(branches, name)) {
      return { ok: false, code: 'invalid', message: nameTaken(name) }
    }
    if (branches.length >= MAX_BRANCHES) {
      return {
        ok: false,
        code: 'blocked',
        message: `Un bar puede tener hasta ${MAX_BRANCHES} sucursales. Borrá o reutilizá una que no uses.`,
      }
    }

    const { data, error } = await supabase
      .from('branches')
      .insert({
        tenant_id: tenantId,
        name,
        short_name: suggestShortName(name),
        slug: branchSlug(
          name,
          branches.map((branch) => branch.slug),
        ),
        color:
          parsed.data.color ??
          nextFreeColor(branches.filter((branch) => branch.active).map((branch) => branch.color)),
        position: Math.max(-1, ...branches.map((branch) => branch.position)) + 1,
        created_by: userId,
      })
      .select(BRANCH_COLUMNS)

    if (error) {
      // 23505: otro dueño creó una con el mismo nombre o el mismo link en el mismo instante.
      // Se vuelve a leer: si era el nombre, se dice; si era el link, sale otro.
      if (error.code === '23505') continue
      console.error('[pos.branches.create]', error.code, error.message)
      return { ok: false, code: 'error', message: NOT_SAVED }
    }
    const row = ((data ?? []) as unknown as BranchRow[])[0]
    if (!row) return { ok: false, code: 'error', message: NOT_SAVED }
    const branch = branchFromRow(row)
    const savedAt = Date.now()

    await logAudit({
      tenantId,
      userId,
      action: 'pos.branch_created',
      entity: 'branch',
      entityId: branch.id,
      payload: { name: branch.name, slug: branch.slug, color: branch.color },
    })
    revalidate(slug)
    return { ok: true, savedAt, branch }
  }
  return { ok: false, code: 'error', message: BUSY }
}

/** Los datos que se copian a la auditoría. La dirección no: alcanza con saber que cambió. */
function auditFields(fields: ReadonlyArray<BranchField>, before: Branch, after: Branch) {
  const changes: Record<string, unknown> = {}
  for (const field of fields) {
    changes[field] =
      field === 'address'
        ? { set: after.address !== null }
        : { from: before[field], to: after[field] }
  }
  return changes
}

/**
 * Cambiar datos de la ficha: nombre, nombre corto, color, dirección, y activarla o
 * desactivarla. Cada dato se escribe solo si sigue como la persona lo veía.
 */
export async function updateBranch(slug: string, input: unknown): Promise<BranchWriteResult> {
  const auth = await authorizeSetup(slug)
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
  const parsed = updateBranchSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: firstIssue(parsed.error) ?? INVALID }
  }
  const { tenantId, userId } = auth
  const { branchId } = parsed.data
  // El esquema ya dejó cada cambio con la forma de su dato.
  const changes = parsed.data.changes as BranchChange[]
  const supabase = await untypedClient()

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let branches: Branch[]
    try {
      branches = await readBranches(supabase, tenantId)
    } catch {
      return { ok: false, code: 'error', message: READ_FAILED }
    }
    const current = branches.find((branch) => branch.id === branchId)
    if (!current) return { ok: false, code: 'gone', message: GONE }

    const plan = planBranchPatch(current, changes)
    if (plan.kind === 'noop') return { ok: true, savedAt: Date.now(), branch: current }
    if (plan.kind === 'conflict') return { ok: false, code: 'changed', message: CHANGED, current }

    if (plan.fields.includes('name') && isNameTaken(branches, plan.next.name, branchId)) {
      return { ok: false, code: 'invalid', message: nameTaken(plan.next.name) }
    }
    if (plan.fields.includes('active') && !plan.next.active) {
      let weight: Awaited<ReturnType<typeof readBranchWeight>>
      try {
        weight = await readBranchWeight(supabase, tenantId, branchId)
      } catch {
        return { ok: false, code: 'error', message: READ_FAILED }
      }
      const verdict = canDeactivate(current, weight)
      if (!verdict.ok) return { ok: false, code: 'blocked', message: verdict.why }
    }

    const { data, error } = await supabase
      .from('branches')
      .update(branchColumns(plan.fields, plan.next))
      .eq('tenant_id', tenantId)
      .eq('id', branchId)
      .eq('updated_at', current.updatedAt)
      .select(BRANCH_COLUMNS)

    if (error) {
      if (error.code === '23505') {
        return { ok: false, code: 'invalid', message: nameTaken(plan.next.name) }
      }
      console.error('[pos.branches.update]', error.code, error.message)
      if (error.code === '23514') return { ok: false, code: 'invalid', message: INVALID }
      return { ok: false, code: 'error', message: NOT_SAVED }
    }
    const row = ((data ?? []) as unknown as BranchRow[])[0]
    // Nadie quedó escrito: la fila cambió entre la lectura y la escritura. Otra vuelta.
    if (!row) continue

    const branch = branchFromRow(row)
    const savedAt = Date.now()
    await logAudit({
      tenantId,
      userId,
      action: 'pos.branch_updated',
      entity: 'branch',
      entityId: branch.id,
      payload: { changes: auditFields(plan.fields, current, branch) },
    })
    revalidate(slug)
    return { ok: true, savedAt, branch }
  }
  return { ok: false, code: 'error', message: BUSY }
}

/**
 * Elegir la principal: a la que cae todo lo que no dice sucursal (las reservas sin sucursal,
 * un sector nuevo). Siempre hay una sola.
 *
 * Las dos filas (la que deja de serlo y la que pasa a serlo) cambian en UNA sola escritura,
 * así el bar nunca queda sin principal. Va primero la que deja de serlo: el índice de «una
 * sola principal por bar» se revisa fila por fila.
 */
export async function setDefaultBranch(slug: string, input: unknown): Promise<BranchListResult> {
  const auth = await authorizeSetup(slug)
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
  const parsed = setDefaultBranchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'invalid', message: INVALID }
  const { tenantId, userId } = auth
  const { branchId, expectedDefaultId } = parsed.data
  const supabase = await untypedClient()

  let branches: Branch[]
  try {
    branches = await readBranches(supabase, tenantId)
  } catch {
    return { ok: false, code: 'error', message: READ_FAILED }
  }
  const target = branches.find((branch) => branch.id === branchId)
  if (!target) return { ok: false, code: 'gone', message: GONE }
  const previous = branches.find((branch) => branch.isDefault)
  if (target.isDefault) return { ok: true, savedAt: Date.now(), branches }
  if (!previous) return { ok: false, code: 'error', message: READ_FAILED }
  if (previous.id !== expectedDefaultId) {
    return {
      ok: false,
      code: 'changed',
      message: `Otro dueño cambió la principal recién: ahora es ${previous.name}. Si igual querés cambiarla, tocá de nuevo.`,
    }
  }
  const verdict = canBeDefault(target)
  if (!verdict.ok) return { ok: false, code: 'blocked', message: verdict.why }

  const row = (branch: Branch, isDefault: boolean) => ({
    id: branch.id,
    tenant_id: tenantId,
    // El nombre y el link viajan porque la fila tiene que estar completa; no cambian.
    name: branch.name,
    slug: branch.slug,
    is_default: isDefault,
  })
  const { error } = await supabase
    .from('branches')
    .upsert([row(previous, false), row(target, true)], { onConflict: 'id' })
  if (error) {
    console.error('[pos.branches.default]', error.code, error.message)
    return { ok: false, code: 'error', message: NOT_SAVED }
  }
  const savedAt = Date.now()

  let after: Branch[]
  try {
    after = await readBranches(supabase, tenantId)
  } catch {
    return { ok: false, code: 'error', message: READ_FAILED }
  }
  await logAudit({
    tenantId,
    userId,
    action: 'pos.branch_default_changed',
    entity: 'branch',
    entityId: target.id,
    payload: { from: previous.id, to: target.id },
  })
  revalidate(slug)
  return { ok: true, savedAt, branches: after }
}

/** Acomodar las sucursales: `order` son los ids como tienen que quedar. */
export async function reorderBranches(slug: string, input: unknown): Promise<BranchListResult> {
  const auth = await authorizeSetup(slug)
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
  const parsed = reorderBranchesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'invalid', message: INVALID }
  const { tenantId, userId } = auth
  const supabase = await untypedClient()

  let branches: Branch[]
  try {
    branches = await readBranches(supabase, tenantId)
  } catch {
    return { ok: false, code: 'error', message: READ_FAILED }
  }
  const writes = positionWrites(branches, parsed.data.order)
  if (writes.length === 0) return { ok: true, savedAt: Date.now(), branches }

  const results = await Promise.all(
    writes.map((write) =>
      supabase
        .from('branches')
        .update({ position: write.position })
        .eq('tenant_id', tenantId)
        .eq('id', write.id),
    ),
  )
  const failed = results.find((result) => result.error)
  if (failed?.error)
    console.error('[pos.branches.reorder]', failed.error.code, failed.error.message)
  const savedAt = Date.now()

  let after: Branch[]
  try {
    after = sortBranches(await readBranches(supabase, tenantId))
  } catch {
    return { ok: false, code: 'error', message: READ_FAILED }
  }
  if (failed) {
    revalidate(slug)
    return {
      ok: false,
      code: 'error',
      message: 'No se pudo guardar el orden. Recargá la página para ver cómo quedó.',
    }
  }
  await logAudit({
    tenantId,
    userId,
    action: 'pos.branches_reordered',
    entity: 'branch',
    payload: { order: after.map((branch) => branch.id) },
  })
  revalidate(slug)
  return { ok: true, savedAt, branches: after }
}

/**
 * Borrar una sucursal vacía (recién creada, o creada por error). Con plano, mesas o historia
 * no se borra: se desactiva y queda guardada. La principal no se borra nunca.
 */
export async function deleteBranch(slug: string, input: unknown): Promise<BranchDeleteResult> {
  const auth = await authorizeSetup(slug)
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
  const parsed = deleteBranchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'invalid', message: INVALID }
  const { tenantId, userId } = auth
  const { branchId } = parsed.data
  const supabase = await untypedClient()

  let current: Branch | null
  let weight: Awaited<ReturnType<typeof readBranchWeight>>
  try {
    current = await readBranch(supabase, tenantId, branchId)
    // Ya no está: es lo que se quería.
    if (!current) return { ok: true, savedAt: Date.now(), branchId }
    weight = await readBranchWeight(supabase, tenantId, branchId)
  } catch {
    return { ok: false, code: 'error', message: READ_FAILED }
  }
  const verdict = canDelete(current, weight)
  if (!verdict.ok) return { ok: false, code: 'blocked', message: verdict.why }

  const { error } = await supabase
    .from('branches')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', branchId)
    .eq('is_default', false)
  if (error) {
    // 23503: algo se le colgó entre la cuenta y el borrado (un sector, una mesa).
    if (error.code === '23503') {
      return {
        ok: false,
        code: 'blocked',
        message: 'Ya tiene cosas cargadas: no se borra. Desactivala y queda guardada.',
      }
    }
    console.error('[pos.branches.delete]', error.code, error.message)
    return { ok: false, code: 'error', message: NOT_SAVED }
  }
  const savedAt = Date.now()

  await logAudit({
    tenantId,
    userId,
    action: 'pos.branch_deleted',
    entity: 'branch',
    entityId: branchId,
    payload: { name: current.name, slug: current.slug },
  })
  revalidate(slug)
  return { ok: true, savedAt, branchId }
}
