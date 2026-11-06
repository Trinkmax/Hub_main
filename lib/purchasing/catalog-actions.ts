'use server'

import { revalidatePath } from 'next/cache'
import { canonicalPhone } from '@/lib/phone'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  eventPlanSchema,
  itemSchema,
  recipeDeleteSchema,
  recipeLinesSchema,
  recipeSchema,
  settingsSchema,
  supplierSchema,
  zoneDeleteSchema,
  zoneOrderSchema,
  zoneSchema,
} from './schemas'

/**
 * Lo que antes se editaba en la planilla (INSUMOS, PROVEEDORES, RECETAS, SECTORES, CONFIG) y ahora se edita
 * en el panel. Solo el dueño (policies `pur_*_owner_write`).
 */

export type CatalogResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string }

const NO_ACCESS = 'Solo los dueños editan Compras.'
const GENERIC = 'No se pudo guardar. Probá de nuevo en un momento.'

async function authorize(slug: string) {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, PURCHASING_MANAGE_ROLES)
    return { tenantId: tenant.id, userId: user.id }
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

function revalidateAll(slug: string) {
  revalidatePath(`/${slug}/compras`, 'layout')
  revalidatePath(`/${slug}/salon/stock`, 'layout')
}

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Revisá los datos.'
}

function dbError(
  where: string,
  error: { code?: string },
  duplicate?: string,
): { ok: false; message: string } {
  console.error(`[purchasing.${where}]`, { code: error.code })
  if (error.code === '23505' && duplicate) return { ok: false, message: duplicate }
  return { ok: false, message: GENERIC }
}

// ─── Insumos ──────────────────────────────────────────────────────────────────

export async function saveItem(input: unknown): Promise<CatalogResult<{ id: string }>> {
  const parsed = itemSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const v = parsed.data
  const auth = await authorize(v.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const row = {
    code: v.code,
    name: v.name,
    brand: v.brand,
    zone_id: v.zoneId,
    unit: v.unit,
    frequency: v.frequency,
    target_qty: v.targetQty,
    pack_label: v.packLabel,
    pack_size: v.packSize,
    supplier_id: v.supplierId,
    notes: v.notes,
    active: v.active,
    updated_by: auth.userId,
  }
  const res = v.id
    ? await db
        .from('pur_items')
        .update(row)
        .eq('tenant_id', auth.tenantId)
        .eq('id', v.id)
        .select('id')
        .single()
    : await db
        .from('pur_items')
        .insert({ ...row, tenant_id: auth.tenantId, created_by: auth.userId })
        .select('id')
        .single()
  if (res.error) return dbError('saveItem', res.error, 'Ya hay un insumo con ese código.')
  revalidateAll(v.slug)
  return { ok: true, id: res.data.id }
}

// ─── Zonas ────────────────────────────────────────────────────────────────────

export async function saveZone(input: unknown): Promise<CatalogResult<{ id: string }>> {
  const parsed = zoneSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const v = parsed.data
  const auth = await authorize(v.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  // Una zona nueva va al final del recorrido.
  const last = v.id
    ? null
    : await db
        .from('pur_zones')
        .select('sort_order')
        .eq('tenant_id', auth.tenantId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
  const res = v.id
    ? await db
        .from('pur_zones')
        .update({ name: v.name, area: v.area })
        .eq('tenant_id', auth.tenantId)
        .eq('id', v.id)
        .select('id')
        .single()
    : await db
        .from('pur_zones')
        .insert({
          tenant_id: auth.tenantId,
          name: v.name,
          area: v.area,
          sort_order: (last?.data?.sort_order ?? 0) + 10,
        })
        .select('id')
        .single()
  if (res.error) return dbError('saveZone', res.error, 'Ya hay una zona con ese nombre.')
  revalidateAll(v.slug)
  return { ok: true, id: res.data.id }
}

/** El orden del recorrido: el de la lista que manda el panel. */
export async function reorderZones(input: unknown): Promise<CatalogResult> {
  const parsed = zoneOrderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const auth = await authorize(parsed.data.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const results = await Promise.all(
    parsed.data.ids.map((id, i) =>
      db
        .from('pur_zones')
        .update({ sort_order: (i + 1) * 10 })
        .eq('tenant_id', auth.tenantId)
        .eq('id', id),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) return dbError('reorderZones', failed.error)
  revalidateAll(parsed.data.slug)
  return { ok: true }
}

/** Una zona se borra; sus insumos quedan «sin zona» (la base los suelta, no los borra). */
export async function deleteZone(input: unknown): Promise<CatalogResult> {
  const parsed = zoneDeleteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const auth = await authorize(parsed.data.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { error } = await db
    .from('pur_zones')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('id', parsed.data.id)
  if (error) return dbError('deleteZone', error)
  revalidateAll(parsed.data.slug)
  return { ok: true }
}

// ─── Proveedores ─────────────────────────────────────────────────────────────

export async function saveSupplier(input: unknown): Promise<CatalogResult<{ id: string }>> {
  const parsed = supplierSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const v = parsed.data
  const auth = await authorize(v.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  let whatsapp: string | null = null
  if (v.whatsapp) {
    const e164 = canonicalPhone(v.whatsapp)
    if (!e164)
      return {
        ok: false,
        message: 'El WhatsApp no parece un número: escribilo con la característica (351…).',
      }
    whatsapp = e164.replace(/\D/g, '')
  }
  const db = await createClient()
  const row = {
    name: v.name,
    contact_name: v.contactName,
    whatsapp,
    delivery_weekdays: [...new Set(v.deliveryWeekdays)].sort(),
    lead_days: v.leadDays,
    notes: v.notes,
    active: v.active,
    updated_by: auth.userId,
  }
  const res = v.id
    ? await db
        .from('pur_suppliers')
        .update(row)
        .eq('tenant_id', auth.tenantId)
        .eq('id', v.id)
        .select('id')
        .single()
    : await db
        .from('pur_suppliers')
        .insert({ ...row, tenant_id: auth.tenantId, created_by: auth.userId })
        .select('id')
        .single()
  if (res.error) return dbError('saveSupplier', res.error, 'Ya hay un proveedor con ese nombre.')
  revalidateAll(v.slug)
  return { ok: true, id: res.data.id }
}

// ─── Recetas ─────────────────────────────────────────────────────────────────

export async function saveRecipe(input: unknown): Promise<CatalogResult<{ id: string }>> {
  const parsed = recipeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const v = parsed.data
  const auth = await authorize(v.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const row = {
    template_id: v.templateId,
    name: v.name,
    variant: v.variant,
    base_guests: v.baseGuests,
    notes: v.notes,
    active: v.active,
    updated_by: auth.userId,
  }
  const res = v.id
    ? await db
        .from('pur_recipes')
        .update(row)
        .eq('tenant_id', auth.tenantId)
        .eq('id', v.id)
        .select('id')
        .single()
    : await db
        .from('pur_recipes')
        .insert({ ...row, tenant_id: auth.tenantId, created_by: auth.userId })
        .select('id')
        .single()
  if (res.error)
    return dbError('saveRecipe', res.error, 'Ese formato ya tiene una variante con ese nombre.')
  revalidateAll(v.slug)
  return { ok: true, id: res.data.id }
}

/** Reemplaza las líneas de la receta por las que manda el editor (es una lista corta). */
export async function saveRecipeLines(input: unknown): Promise<CatalogResult> {
  const parsed = recipeLinesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { slug, recipeId, lines } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const recipe = await db
    .from('pur_recipes')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('id', recipeId)
    .maybeSingle()
  if (recipe.error) return dbError('saveRecipeLines', recipe.error)
  if (!recipe.data) return { ok: false, message: 'No encontramos esa receta.' }

  const del = await db
    .from('pur_recipe_lines')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('recipe_id', recipeId)
  if (del.error) return dbError('saveRecipeLines.delete', del.error)
  if (lines.length) {
    const ins = await db.from('pur_recipe_lines').insert(
      lines.map((l, i) => ({
        tenant_id: auth.tenantId,
        recipe_id: recipeId,
        item_id: l.itemId,
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        in_house: l.inHouse,
        note: l.note,
        sort_order: i + 1,
      })),
    )
    if (ins.error) return dbError('saveRecipeLines.insert', ins.error)
  }
  revalidateAll(slug)
  return { ok: true }
}

export async function deleteRecipe(input: unknown): Promise<CatalogResult> {
  const parsed = recipeDeleteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const auth = await authorize(parsed.data.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { error } = await db
    .from('pur_recipes')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('id', parsed.data.id)
  if (error) return dbError('deleteRecipe', error)
  revalidateAll(parsed.data.slug)
  return { ok: true }
}

// ─── Fechas del calendario ───────────────────────────────────────────────────

/** Qué variante va y para cuántas personas se compra una fecha; o que no sume. */
export async function saveEventPlan(input: unknown): Promise<CatalogResult> {
  const parsed = eventPlanSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const v = parsed.data
  const auth = await authorize(v.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const event = await db
    .from('scheduled_events')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('id', v.scheduledEventId)
    .maybeSingle()
  if (event.error) return dbError('saveEventPlan.event', event.error)
  if (!event.data) return { ok: false, message: 'Esa fecha ya no está en el calendario.' }
  const { error } = await db.from('pur_event_plans').upsert(
    {
      tenant_id: auth.tenantId,
      scheduled_event_id: v.scheduledEventId,
      recipe_id: v.recipeId,
      guests: v.guests,
      skip: v.skip,
      updated_by: auth.userId,
    },
    { onConflict: 'scheduled_event_id' },
  )
  if (error) return dbError('saveEventPlan', error)
  revalidateAll(v.slug)
  return { ok: true }
}

// ─── Ajustes ─────────────────────────────────────────────────────────────────

export async function saveSettings(input: unknown): Promise<CatalogResult> {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const v = parsed.data
  const auth = await authorize(v.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { error } = await db.from('pur_settings').upsert(
    {
      tenant_id: auth.tenantId,
      count_weekdays: [...new Set(v.countWeekdays)].sort(),
      recipe_base_guests: v.recipeBaseGuests,
      reviewer_name: v.reviewerName,
      sender_name: v.senderName,
      updated_by: auth.userId,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return dbError('saveSettings', error)
  revalidateAll(v.slug)
  return { ok: true }
}
