'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  createCategorySchema,
  createMenuItemSchema,
  reorderItemsSchema,
  reorderSchema,
  updateCategorySchema,
  updateMenuItemSchema,
} from './schemas'

export type MenuActionState = { ok: true; message?: string } | { ok: false; message: string }

async function authorizeOwner(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return tenant
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    )
      return null
    throw error
  }
}

export async function createCategory(
  slug: string,
  _prev: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createCategorySchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: maxPos } = await supabase
    .from('menu_categories')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: created, error } = await supabase
    .from('menu_categories')
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      position: (maxPos?.position ?? 0) + 1,
    })
    .select('id')
    .single()
  if (error || !created) return { ok: false, message: 'No pudimos crear la categoría.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'menu_category.created',
    entity: 'menu_category',
    entityId: created.id,
    payload: { name: parsed.data.name },
  })

  revalidatePath(`/${slug}/menu`)
  return { ok: true, message: 'Categoría creada.' }
}

export async function updateCategory(
  slug: string,
  payload: { id: string; name: string; active: boolean },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateCategorySchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('menu_categories')
    .update({ name: parsed.data.name, active: parsed.data.active })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

export async function deleteCategory(slug: string, id: string): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('menu_categories')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        message: 'No se puede borrar: hay ítems asociados. Pasalos a otra categoría primero.',
      }
    }
    return { ok: false, message: 'No pudimos borrar.' }
  }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

export async function createMenuItem(
  slug: string,
  _prev: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createMenuItemSchema.safeParse({
    category_id: formData.get('category_id'),
    name: formData.get('name'),
    description: formData.get('description'),
    price_cents: formData.get('price_cents'),
    points_override: formData.get('points_override'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Verificar que la categoría es del tenant
  const { data: cat } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('id', parsed.data.category_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!cat) return { ok: false, message: 'Categoría inválida.' }

  const { data: maxPos } = await supabase
    .from('menu_items')
    .select('position')
    .eq('category_id', parsed.data.category_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: created, error } = await supabase
    .from('menu_items')
    .insert({
      tenant_id: tenant.id,
      category_id: parsed.data.category_id,
      name: parsed.data.name,
      description: parsed.data.description,
      price_cents: parsed.data.price_cents,
      points_override: parsed.data.points_override,
      position: (maxPos?.position ?? 0) + 1,
    })
    .select('id')
    .single()
  if (error || !created) return { ok: false, message: 'No pudimos crear el ítem.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'menu_item.created',
    entity: 'menu_item',
    entityId: created.id,
    payload: { name: parsed.data.name, price_cents: parsed.data.price_cents },
  })

  revalidatePath(`/${slug}/menu`)
  return { ok: true, message: 'Ítem creado.' }
}

export async function updateMenuItem(
  slug: string,
  payload: {
    id: string
    category_id: string
    name: string
    description: string | null
    price_cents: number
    points_override: number | null
    active: boolean
  },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateMenuItemSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('menu_items')
    .update({
      category_id: parsed.data.category_id,
      name: parsed.data.name,
      description: parsed.data.description,
      price_cents: parsed.data.price_cents,
      points_override: parsed.data.points_override,
      active: parsed.data.active,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

export async function deleteMenuItem(slug: string, id: string): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('menu_items')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        message:
          'No se puede borrar: el ítem está referenciado en visitas. Pausá el ítem en su lugar.',
      }
    }
    return { ok: false, message: 'No pudimos borrar.' }
  }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

export async function reorderCategories(slug: string, ids: string[]): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reorderSchema.safeParse({ ids })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('reorder_menu_categories', {
    p_tenant_id: tenant.id,
    p_ordered_ids: parsed.data.ids,
  })
  if (error) return { ok: false, message: 'No pudimos reordenar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

export async function reorderItems(
  slug: string,
  categoryId: string,
  ids: string[],
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reorderItemsSchema.safeParse({ category_id: categoryId, ids })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('reorder_menu_items', {
    p_category_id: parsed.data.category_id,
    p_ordered_ids: parsed.data.ids,
  })
  if (error) return { ok: false, message: 'No pudimos reordenar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}
