'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { mapPgError } from './errors'
import { clampToArea, ELEMENT_DEFAULTS, GRID, TABLE_PRESETS } from './grid'
import { suggestNextLabel } from './numbering'
import type {
  AddDecorInput,
  BulkCreateTablesInput,
  CreateTableInPlanInput,
  ElementGeometry,
} from './schemas'
import {
  addDecorSchema,
  areaCanvasSchema,
  areaCreateSchema,
  areaRenameSchema,
  areaReorderSchema,
  bulkCreateTablesSchema,
  createTableInPlanSchema,
  elementIdSchema,
  geometryBatchSchema,
  mergeTablesSchema,
  placeTableSchema,
  setShapeSchema,
  setTableActiveSchema,
  setZIndexSchema,
  splitTableSchema,
  updateDecorSchema,
} from './schemas'

export type FloorPlanActionState =
  | { ok: true; data?: unknown }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(
  slug: string,
): Promise<{ tenant: { id: string }; role: string; userId: string } | null> {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    return { tenant, role, userId: user.id }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

const NO_ACCESS: FloorPlanActionState = { ok: false, message: 'No tenés permiso.' }

// ────────────────────────────────────────────────────────────
// Áreas
// ────────────────────────────────────────────────────────────

export async function createAreaAction(
  slug: string,
  input: { name: string; number_start?: number },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()

  // Posición densa: al final de las áreas existentes.
  const { count, error: countError } = await supabase
    .from('floor_plan_areas')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', access.tenant.id)
  if (countError) {
    console.error('[floor-plan.createArea] count', countError.message)
    return { ok: false, message: 'No se pudo crear el área.' }
  }

  const { data, error } = await supabase
    .from('floor_plan_areas')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      number_start: parsed.data.number_start,
      position: count ?? 0,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.createArea]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'create',
    entity: 'floor_plan_area',
    entityId: data.id,
    payload: { name: parsed.data.name, number_start: parsed.data.number_start },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, data: { id: data.id } }
}

export async function renameAreaAction(
  slug: string,
  input: { id: string; name: string },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaRenameSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('floor_plan_areas')
    .update({ name: parsed.data.name })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .select('id')

  if (error) {
    console.error('[floor-plan.renameArea]', error.message)
    return { ok: false, message: mapPgError(error) }
  }
  if (!updated || updated.length === 0) {
    return { ok: false, message: 'No se encontró el elemento (puede que ya no exista).' }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function updateAreaCanvasAction(
  slug: string,
  input: { id: string; width: number; height: number; number_start: number },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaCanvasSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('floor_plan_areas')
    .update({
      width: parsed.data.width,
      height: parsed.data.height,
      number_start: parsed.data.number_start,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .select('id')

  if (error) {
    console.error('[floor-plan.updateAreaCanvas]', error.message)
    return { ok: false, message: mapPgError(error) }
  }
  if (!updated || updated.length === 0) {
    return { ok: false, message: 'No se encontró el elemento (puede que ya no exista).' }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function reorderAreasAction(
  slug: string,
  ids: string[],
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaReorderSchema.safeParse({ ids })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Posiciones densas 0..n-1 según el orden recibido. Cada update filtra por
  // tenant_id, así que un id de otro tenant no afecta filas (RLS + eq).
  for (let i = 0; i < parsed.data.ids.length; i++) {
    const id = parsed.data.ids[i]
    if (!id) continue
    const { error } = await supabase
      .from('floor_plan_areas')
      .update({ position: i })
      .eq('id', id)
      .eq('tenant_id', access.tenant.id)
    if (error) {
      console.error('[floor-plan.reorderAreas]', error.message)
      return { ok: false, message: mapPgError(error) }
    }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function deleteAreaAction(
  slug: string,
  areaId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: areaId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_delete_area', { p_area_id: parsed.data.id })

  if (error) {
    console.error('[floor-plan.deleteArea]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'delete',
    entity: 'floor_plan_area',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Geometría
// ────────────────────────────────────────────────────────────

export async function saveGeometryAction(
  slug: string,
  items: ElementGeometry[],
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = geometryBatchSchema.safeParse({ items })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Update por elemento: SOLO geometría (x,y,width,height,rotation,corner_radius,
  // z_index). Nunca area_id/tenant_id/kind/physical_table_id. Cada update filtra
  // por tenant_id (RLS + eq).
  for (const item of parsed.data.items) {
    const { error } = await supabase
      .from('floor_plan_elements')
      .update({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        corner_radius: item.corner_radius,
        z_index: item.z_index,
      })
      .eq('id', item.id)
      .eq('tenant_id', access.tenant.id)
    if (error) {
      console.error('[floor-plan.saveGeometry]', error.message)
      return { ok: false, message: mapPgError(error) }
    }
  }

  // NO revalidamos acá: la geometría es optimista en cliente con rollback propio
  // (onQueueError). Revalidar re-stremearía el RSC y pisaría el estado optimista
  // a mitad/fin del drag. El próximo SSR (navegación/recarga) ya trae lo persistido.
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Estructura mesa-QR
// ────────────────────────────────────────────────────────────

export async function createTableInPlanAction(
  slug: string,
  input: CreateTableInPlanInput,
): Promise<
  | { ok: true; tableId: string; elementId: string; qrToken: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }
> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createTableInPlanSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fp_create_table', {
    p_area_id: parsed.data.area_id,
    p_label: parsed.data.label,
    p_shape: parsed.data.shape,
    p_x: parsed.data.x,
    p_y: parsed.data.y,
    ...(parsed.data.capacity != null ? { p_capacity: parsed.data.capacity } : {}),
  })

  if (error || !data) {
    console.error('[floor-plan.createTableInPlan]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  const result = data as { table_id: string; element_id: string; qr_token: string }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'create',
    entity: 'physical_table',
    entityId: result.table_id,
    payload: { label: parsed.data.label, area_id: parsed.data.area_id },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return {
    ok: true,
    tableId: result.table_id,
    elementId: result.element_id,
    qrToken: result.qr_token,
  }
}

/**
 * Crea N mesas de una vez en grilla (armado rápido). Cada mesa mintea su propio
 * physical_table + qr_token vía fp_create_table (no toca QRs existentes) y se
 * auto-numera desde `area.number_start`. La forma/tamaño viene del preset.
 */
export async function bulkCreateTablesAction(
  slug: string,
  input: BulkCreateTablesInput,
): Promise<{ ok: true; data: { created: number } } | { ok: false; message: string }> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = bulkCreateTablesSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }
  const { area_id, count, capacity, preset } = parsed.data
  const dims = TABLE_PRESETS[preset]

  const supabase = await createClient()

  // Área (dimensiones + numeración) y labels existentes en el área.
  const { data: area, error: areaError } = await supabase
    .from('floor_plan_areas')
    .select('width, height, number_start')
    .eq('id', area_id)
    .eq('tenant_id', access.tenant.id)
    .single()
  if (areaError || !area) {
    console.error('[floor-plan.bulkCreate] area', areaError?.message)
    return { ok: false, message: 'No se pudo leer el área.' }
  }

  const { data: siblings } = await supabase
    .from('floor_plan_elements')
    .select('physical_tables(label)')
    .eq('area_id', area_id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')
  const existingLabels = (
    (siblings ?? []) as unknown as { physical_tables: { label: string } | null }[]
  )
    .map((s) => s.physical_tables?.label)
    .filter((l): l is string => typeof l === 'string')

  // Grilla: columnas según el ancho del área y el tamaño del preset.
  const stepX = dims.width + 24
  const stepY = dims.height + 28
  const cols = Math.max(1, Math.floor((area.width - 40) / stepX))

  // Si el área no es lo bastante alta para todas las filas, la agrandamos (cap 6000)
  // para que las mesas no se apilen contra el borde inferior (clamp → overlap).
  const rows = Math.ceil(count / cols)
  const neededHeight = Math.min(6000, 20 + (rows - 1) * stepY + dims.height + 20)
  const effHeight = Math.max(area.height, neededHeight)
  if (effHeight > area.height) {
    await supabase
      .from('floor_plan_areas')
      .update({ height: effHeight })
      .eq('id', area_id)
      .eq('tenant_id', access.tenant.id)
  }

  const createdElementIds: string[] = []
  for (let i = 0; i < count; i++) {
    const label = suggestNextLabel(area.number_start, existingLabels)
    existingLabels.push(label)
    const col = i % cols
    const row = Math.floor(i / cols)
    const pos = clampToArea(
      20 + col * stepX,
      20 + row * stepY,
      dims.width,
      dims.height,
      area.width,
      effHeight,
    )
    const { data, error } = await supabase.rpc('fp_create_table', {
      p_area_id: area_id,
      p_label: label,
      p_shape: dims.shape,
      p_x: pos.x,
      p_y: pos.y,
      ...(capacity != null ? { p_capacity: capacity } : {}),
    })
    if (error || !data) {
      console.error('[floor-plan.bulkCreate] create', error?.message)
      // Devolver lo creado hasta ahora (no es atómico, pero no rompe invariantes).
      if (createdElementIds.length === 0) return { ok: false, message: mapPgError(error) }
      break
    }
    createdElementIds.push((data as { element_id: string }).element_id)
  }

  // Ajustar el tamaño de todas las nuevas al preset en una sola pasada.
  if (createdElementIds.length > 0) {
    await supabase
      .from('floor_plan_elements')
      .update({ width: dims.width, height: dims.height })
      .in('id', createdElementIds)
      .eq('tenant_id', access.tenant.id)
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'bulk_create',
    entity: 'physical_table',
    entityId: area_id,
    payload: { count: createdElementIds.length, preset, capacity },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, data: { created: createdElementIds.length } }
}

export async function splitTableAction(
  slug: string,
  sourceElementId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = splitTableSchema.safeParse({ source_element_id: sourceElementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()

  // 1) Leer el elemento source: geometría + área + capacidad/shape de la mesa.
  const { data: source, error: sourceError } = await supabase
    .from('floor_plan_elements')
    .select('area_id, x, y, width, height, shape, physical_tables(capacity)')
    .eq('id', parsed.data.source_element_id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')
    .single()

  if (sourceError || !source) {
    console.error('[floor-plan.splitTable] source', sourceError?.message)
    return { ok: false, message: 'No se pudo leer la mesa de origen.' }
  }

  const src = source as unknown as {
    area_id: string
    x: number
    y: number
    width: number
    height: number
    shape: 'rect' | 'circle'
    physical_tables: { capacity: number | null } | null
  }

  // 2) Leer el área para sus dimensiones (clamp) + las labels ya en el área.
  const { data: area, error: areaError } = await supabase
    .from('floor_plan_areas')
    .select('width, height, number_start')
    .eq('id', src.area_id)
    .eq('tenant_id', access.tenant.id)
    .single()

  if (areaError || !area) {
    console.error('[floor-plan.splitTable] area', areaError?.message)
    return { ok: false, message: 'No se pudo leer el área.' }
  }

  // Labels existentes en el área (para suggestNextLabel).
  const { data: siblings, error: siblingsError } = await supabase
    .from('floor_plan_elements')
    .select('physical_tables(label)')
    .eq('area_id', src.area_id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')

  if (siblingsError) {
    console.error('[floor-plan.splitTable] siblings', siblingsError.message)
    return { ok: false, message: 'No se pudo calcular el nombre.' }
  }

  const existingLabels = (
    (siblings ?? []) as unknown as { physical_tables: { label: string } | null }[]
  )
    .map((s) => s.physical_tables?.label)
    .filter((l): l is string => typeof l === 'string')

  const newLabel = suggestNextLabel(area.number_start, existingLabels)

  // 3) Offset: a la derecha del source, mismo y; clampeado al área.
  const offset = clampToArea(
    src.x + src.width + GRID,
    src.y,
    ELEMENT_DEFAULTS.table.width,
    ELEMENT_DEFAULTS.table.height,
    area.width,
    area.height,
  )

  // 4) Crear la mesa vía RPC (hereda área, capacidad y shape del source).
  const { data, error } = await supabase.rpc('fp_create_table', {
    p_area_id: src.area_id,
    p_label: newLabel,
    p_shape: src.shape,
    p_x: offset.x,
    p_y: offset.y,
    ...(src.physical_tables?.capacity != null ? { p_capacity: src.physical_tables.capacity } : {}),
  })

  if (error || !data) {
    console.error('[floor-plan.splitTable]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  const result = data as { table_id: string; element_id: string; qr_token: string }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'split',
    entity: 'physical_table',
    entityId: result.table_id,
    payload: { source_element_id: parsed.data.source_element_id, label: newLabel },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, data: { tableId: result.table_id, elementId: result.element_id } }
}

/**
 * Duplica un elemento del plano (mesa o decoración) con un offset en cascada.
 * - Mesa: crea una mesa NUEVA (mintea physical_table + qr_token vía fp_create_table,
 *   hereda shape + capacidad), auto-numerada. NO toca QRs existentes.
 * - Decoración: inserta una copia (kind/shape/label/color/tamaño/rotación).
 * Devuelve el element_id nuevo para seleccionarlo.
 */
export async function duplicateElementAction(
  slug: string,
  elementId: string,
): Promise<{ ok: true; data: { elementId: string } } | { ok: false; message: string }> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = elementIdSchema.safeParse({ id: elementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()

  // 1) Leer el elemento + su área (para clamp del offset) + capacidad si es mesa.
  const { data: src, error: srcError } = await supabase
    .from('floor_plan_elements')
    .select(
      'area_id, kind, shape, x, y, width, height, rotation, corner_radius, z_index, label, color, physical_tables(capacity)',
    )
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .single()

  if (srcError || !src) {
    console.error('[floor-plan.duplicate] source', srcError?.message)
    return { ok: false, message: 'No se pudo leer el elemento a duplicar.' }
  }

  const el = src as unknown as {
    area_id: string
    kind: 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage' | 'booth'
    shape: 'rect' | 'circle' | 'banquette'
    x: number
    y: number
    width: number
    height: number
    rotation: number
    corner_radius: number
    z_index: number
    label: string | null
    color: string | null
    physical_tables: { capacity: number | null } | null
  }

  const { data: area } = await supabase
    .from('floor_plan_areas')
    .select('width, height, number_start')
    .eq('id', el.area_id)
    .eq('tenant_id', access.tenant.id)
    .single()
  const areaW = area?.width ?? 2000
  const areaH = area?.height ?? 2000

  const offset = clampToArea(el.x + GRID * 2, el.y + GRID * 2, el.width, el.height, areaW, areaH)

  if (el.kind === 'table') {
    // Labels existentes del área para auto-numerar.
    const { data: siblings } = await supabase
      .from('floor_plan_elements')
      .select('physical_tables(label)')
      .eq('area_id', el.area_id)
      .eq('tenant_id', access.tenant.id)
      .eq('kind', 'table')
    const existingLabels = (
      (siblings ?? []) as unknown as { physical_tables: { label: string } | null }[]
    )
      .map((s) => s.physical_tables?.label)
      .filter((l): l is string => typeof l === 'string')
    const newLabel = suggestNextLabel(area?.number_start ?? 1, existingLabels)

    const { data, error } = await supabase.rpc('fp_create_table', {
      p_area_id: el.area_id,
      p_label: newLabel,
      p_shape: el.shape,
      p_x: offset.x,
      p_y: offset.y,
      ...(el.physical_tables?.capacity != null ? { p_capacity: el.physical_tables.capacity } : {}),
    })
    if (error || !data) {
      console.error('[floor-plan.duplicate] table', error?.message)
      return { ok: false, message: mapPgError(error) }
    }
    const result = data as { table_id: string; element_id: string }

    // Heredar tamaño/rotación/corner del original (fp_create_table usa defaults).
    const { error: geomErr } = await supabase
      .from('floor_plan_elements')
      .update({
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        corner_radius: el.corner_radius,
      })
      .eq('id', result.element_id)
      .eq('tenant_id', access.tenant.id)
    // No abortamos (la mesa ya existe con su QR); solo lo dejamos observable.
    if (geomErr) console.error('[floor-plan.duplicate] geom', geomErr.message)

    await logAudit({
      tenantId: access.tenant.id,
      userId: access.userId,
      action: 'duplicate',
      entity: 'physical_table',
      entityId: result.table_id,
      payload: { source_element_id: parsed.data.id, label: newLabel },
    })
    revalidatePath(`/${slug}/local/mesas`)
    return { ok: true, data: { elementId: result.element_id } }
  }

  // Decoración: insertar copia directa (RLS owner).
  const { data, error } = await supabase
    .from('floor_plan_elements')
    .insert({
      tenant_id: access.tenant.id,
      area_id: el.area_id,
      kind: el.kind,
      shape: el.shape,
      physical_table_id: null,
      x: offset.x,
      y: offset.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation,
      corner_radius: el.corner_radius,
      z_index: el.z_index,
      label: el.label,
      color: el.color,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.duplicate] decor', error?.message)
    return { ok: false, message: mapPgError(error) }
  }
  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, data: { elementId: data.id } }
}

export async function placeTableAction(
  slug: string,
  input: {
    table_id: string
    area_id: string
    x: number
    y: number
    shape?: 'rect' | 'circle' | 'banquette'
  },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = placeTableSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  // El trigger fp_elements_integrity rechaza mesa inactiva / cross-tenant.
  const { data, error } = await supabase
    .from('floor_plan_elements')
    .insert({
      tenant_id: access.tenant.id,
      area_id: parsed.data.area_id,
      kind: 'table',
      // Conservar la forma con la que se re-ubica (no degradar redonda → rect).
      shape: parsed.data.shape,
      physical_table_id: parsed.data.table_id,
      x: parsed.data.x,
      y: parsed.data.y,
      width: ELEMENT_DEFAULTS.table.width,
      height: ELEMENT_DEFAULTS.table.height,
      z_index: 10,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.placeTable]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'place',
    entity: 'floor_plan_element',
    entityId: data.id,
    payload: { table_id: parsed.data.table_id, area_id: parsed.data.area_id },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, data: { id: data.id } }
}

export async function removeFromPlanAction(
  slug: string,
  elementId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: elementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  // Borra solo el elemento visual; la mesa sigue activa y vuelve a la bandeja.
  const { error } = await supabase
    .from('floor_plan_elements')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')

  if (error) {
    console.error('[floor-plan.removeFromPlan]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'remove_from_plan',
    entity: 'floor_plan_element',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function mergeTablesAction(
  slug: string,
  survivorTableId: string,
  absorbedTableId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = mergeTablesSchema.safeParse({
    survivor_table_id: survivorTableId,
    absorbed_table_id: absorbedTableId,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_merge_tables', {
    p_survivor_table_id: parsed.data.survivor_table_id,
    p_absorbed_table_id: parsed.data.absorbed_table_id,
  })

  if (error) {
    console.error('[floor-plan.mergeTables]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'merge',
    entity: 'physical_table',
    entityId: parsed.data.survivor_table_id,
    payload: { absorbed_table_id: parsed.data.absorbed_table_id },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function setTableActiveAction(
  slug: string,
  tableId: string,
  active: boolean,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = setTableActiveSchema.safeParse({ table_id: tableId, active })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_set_table_active', {
    p_table_id: parsed.data.table_id,
    p_active: parsed.data.active,
  })

  if (error) {
    console.error('[floor-plan.setTableActive]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: parsed.data.active ? 'reactivate' : 'deactivate',
    entity: 'physical_table',
    entityId: parsed.data.table_id,
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function deleteTablePermanentlyAction(
  slug: string,
  tableId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: tableId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_delete_table', { p_table_id: parsed.data.id })

  if (error) {
    console.error('[floor-plan.deleteTablePermanently]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'delete_permanent',
    entity: 'physical_table',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Decoración + z-index
// ────────────────────────────────────────────────────────────

export async function addDecorAction(
  slug: string,
  input: AddDecorInput,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = addDecorSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('floor_plan_elements')
    .insert({
      tenant_id: access.tenant.id,
      area_id: parsed.data.area_id,
      kind: parsed.data.kind,
      shape: parsed.data.shape,
      physical_table_id: null,
      x: parsed.data.x,
      y: parsed.data.y,
      width: parsed.data.width,
      height: parsed.data.height,
      label: parsed.data.label ?? null,
      color: parsed.data.color ?? null,
      z_index: 0,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.addDecor]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, data: { id: data.id } }
}

export async function updateDecorAction(
  slug: string,
  input: { id: string; label?: string | null; color?: string | null },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = updateDecorSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  // Solo escribimos las keys presentes (label/color son opcionales).
  const patch: { label?: string | null; color?: string | null } = {}
  if ('label' in parsed.data) patch.label = parsed.data.label ?? null
  if ('color' in parsed.data) patch.color = parsed.data.color ?? null

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('floor_plan_elements')
    .update(patch)
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .neq('kind', 'table')
    .select('id')

  if (error) {
    console.error('[floor-plan.updateDecor]', error.message)
    return { ok: false, message: mapPgError(error) }
  }
  if (!updated || updated.length === 0) {
    return { ok: false, message: 'No se encontró el elemento (puede que ya no exista).' }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function deleteDecorAction(
  slug: string,
  elementId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: elementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_elements')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .neq('kind', 'table')

  if (error) {
    console.error('[floor-plan.deleteDecor]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function setElementShapeAction(
  slug: string,
  elementId: string,
  shape: 'rect' | 'circle' | 'banquette',
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = setShapeSchema.safeParse({ id: elementId, shape })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  // Solo las mesas tienen selector de forma (las sillas se dibujan por forma+capacidad).
  const { data: updated, error } = await supabase
    .from('floor_plan_elements')
    .update({ shape: parsed.data.shape })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')
    .select('id')

  if (error) {
    console.error('[floor-plan.setElementShape]', error.message)
    return { ok: false, message: mapPgError(error) }
  }
  if (!updated || updated.length === 0) {
    return { ok: false, message: 'No se encontró el elemento (puede que ya no exista).' }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}

export async function setElementZIndexAction(
  slug: string,
  elementId: string,
  zIndex: number,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = setZIndexSchema.safeParse({ id: elementId, z_index: zIndex })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_elements')
    .update({ z_index: parsed.data.z_index })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[floor-plan.setElementZIndex]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true }
}
