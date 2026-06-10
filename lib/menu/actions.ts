'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { setItemTags } from '@/lib/item-tags/actions'
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
  moveCategorySchema,
  reorderCategoriesSchema,
  reorderItemsSchema,
  updateCategorySchema,
  updateMenuItemSchema,
} from './schemas'

// Estas RPCs son nuevas / cambiaron de firma y todavía no están en los tipos
// generados (types/database.ts se parcheó a mano). Las llamamos con un cast
// acotado hasta el próximo regen real de tipos.
type RpcResult = { data: unknown; error: { message: string } | null }
async function callRpc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  return (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(
    fn,
    args,
  )
}

// Helper: lee tag_ids como CSV string o array. FormData de un <form> con
// múltiples inputs hidden "tag_ids" devuelve sólo el último value; para
// soportar ambos casos (CSV serializado o array via getAll), normalizamos.
function readTagIds(formData: FormData): string[] {
  const multi = formData.getAll('tag_ids')
  if (multi.length > 1) {
    return multi.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  const single = formData.get('tag_ids')
  if (typeof single !== 'string' || single.length === 0) return []
  // Aceptamos CSV simple, o JSON array si vino de un control que serializa.
  if (single.startsWith('[')) {
    try {
      const parsed = JSON.parse(single)
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
      }
    } catch {
      // cae a CSV
    }
  }
  return single
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

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

  const parsed = createCategorySchema.safeParse({
    name: formData.get('name'),
    image_url: formData.get('image_url'),
    parent_id: formData.get('parent_id'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Si viene parent_id, validar que la categoría padre es del tenant.
  if (parsed.data.parent_id) {
    const { data: parent } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('id', parsed.data.parent_id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (!parent) return { ok: false, message: 'Categoría padre inválida.' }
  }

  // Posición = max entre hermanos (mismo parent_id) + 1.
  const siblingQuery = supabase
    .from('menu_categories')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
  const { data: maxPos } = await (parsed.data.parent_id
    ? siblingQuery.eq('parent_id', parsed.data.parent_id)
    : siblingQuery.is('parent_id', null)
  ).maybeSingle()

  const { data: created, error } = await supabase
    .from('menu_categories')
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      image_url: parsed.data.image_url,
      parent_id: parsed.data.parent_id,
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
  payload: { id: string; name: string; active: boolean; image_url: string | null },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateCategorySchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('menu_categories')
    .update({
      name: parsed.data.name,
      active: parsed.data.active,
      image_url: parsed.data.image_url,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

export async function moveCategory(
  slug: string,
  payload: { id: string; parent_id: string | null },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = moveCategorySchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await callRpc(supabase, 'move_category', {
    p_category_id: parsed.data.id,
    p_new_parent_id: parsed.data.parent_id,
  })
  if (error) {
    if (error.message.includes('cycle')) {
      return { ok: false, message: 'No podés mover una categoría dentro de sí misma.' }
    }
    if (error.message.includes('invalid_parent')) {
      return { ok: false, message: 'Categoría destino inválida.' }
    }
    return { ok: false, message: 'No pudimos mover la categoría.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'menu_category.moved',
    entity: 'menu_category',
    entityId: parsed.data.id,
    payload: { parent_id: parsed.data.parent_id },
  })

  revalidatePath(`/${slug}/menu`)
  return { ok: true, message: 'Categoría movida.' }
}

export async function deleteCategory(slug: string, id: string): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { data, error } = await callRpc(supabase, 'delete_category_cascade', {
    p_category_id: idParsed.data,
  })
  if (error) {
    console.error('[menu.deleteCategory] cascade', error.message)
    return { ok: false, message: 'No pudimos borrar la categoría.' }
  }

  const summary = (data ?? {}) as {
    deleted_categories?: number
    archived_items?: number
    deleted_items?: number
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'menu_category.deleted_cascade',
    entity: 'menu_category',
    entityId: idParsed.data,
    payload: summary,
  })

  revalidatePath(`/${slug}/menu`)
  const archived = summary.archived_items ?? 0
  return {
    ok: true,
    message:
      archived > 0
        ? `Categoría eliminada. ${archived} ítem${archived === 1 ? '' : 's'} con historial quedaron archivados.`
        : 'Categoría eliminada.',
  }
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
    image_url: formData.get('image_url'),
    featured: formData.get('featured') ?? false,
    tag_ids: readTagIds(formData),
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
      image_url: parsed.data.image_url,
      position: (maxPos?.position ?? 0) + 1,
      // featured no está aún en database.ts (tabla mig posterior). Cast aditivo.
      ...({ featured: parsed.data.featured } as { featured?: boolean }),
    })
    .select('id')
    .single()
  if (error || !created) return { ok: false, message: 'No pudimos crear el ítem.' }

  // Si vinieron tag_ids, sincronizar en el mismo flow. setItemTags reusa
  // su propia autorización y audit; un fallo no rompe la creación del ítem
  // pero sí devolvemos un message degradado.
  let tagsWarning: string | null = null
  if (parsed.data.tag_ids.length > 0) {
    const tagResult = await setItemTags(slug, {
      menu_item_id: created.id,
      tag_ids: parsed.data.tag_ids,
    })
    if (!tagResult.ok) {
      console.error('[menu.createMenuItem] setItemTags', tagResult.message)
      tagsWarning = tagResult.message
    }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'menu_item.created',
    entity: 'menu_item',
    entityId: created.id,
    payload: {
      name: parsed.data.name,
      price_cents: parsed.data.price_cents,
      featured: parsed.data.featured,
      tag_ids: parsed.data.tag_ids,
    },
  })

  revalidatePath(`/${slug}/menu`)
  if (tagsWarning) {
    return { ok: true, message: `Ítem creado, pero: ${tagsWarning}` }
  }
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
    image_url: string | null
    active: boolean
    // Campos opcionales del rediseño 2026. Si no se pasan, no se tocan.
    featured?: boolean
    tag_ids?: string[]
  },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateMenuItemSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()

  // El UPDATE incluye featured solo si el caller pasó featured explícitamente.
  // Esto evita sobreescribir el toggle hecho por toggleFeatured cuando un form
  // legacy llama a updateMenuItem sin tocar featured.
  const updatePayload: Record<string, unknown> = {
    category_id: parsed.data.category_id,
    name: parsed.data.name,
    description: parsed.data.description,
    price_cents: parsed.data.price_cents,
    points_override: parsed.data.points_override,
    image_url: parsed.data.image_url,
    active: parsed.data.active,
  }
  if (payload.featured !== undefined) {
    updatePayload.featured = parsed.data.featured
  }

  const { error } = await supabase
    .from('menu_items')
    .update(updatePayload)
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  // Sincronizar tags solo si vinieron explícitamente (undefined = no tocar).
  if (payload.tag_ids !== undefined) {
    const tagResult = await setItemTags(slug, {
      menu_item_id: parsed.data.id,
      tag_ids: parsed.data.tag_ids,
    })
    if (!tagResult.ok) {
      console.error('[menu.updateMenuItem] setItemTags', tagResult.message)
      return { ok: false, message: `Ítem actualizado, pero: ${tagResult.message}` }
    }
  }

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

export async function reorderCategories(
  slug: string,
  parentId: string | null,
  ids: string[],
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reorderCategoriesSchema.safeParse({ parent_id: parentId, ids })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await callRpc(supabase, 'reorder_menu_categories', {
    p_parent_id: parsed.data.parent_id,
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

// Toggle del flag featured en menu_items. Leer-luego-flip se hace en dos
// queries para mantener tipos simples (sin RPC). El segundo eq() por
// tenant_id en el UPDATE es defensa en profundidad además de la verificación.
export async function toggleFeatured(slug: string, itemId: string): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(itemId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()

  // featured todavía no está en database.ts (migración recién aplicada).
  // Usamos .returns<>() para tipar el row sin recurrir a `any` en el .select().
  const { data: current, error: readErr } = await supabase
    .from('menu_items')
    .select('id, featured')
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
    .returns<Array<{ id: string; featured: boolean | null }>>()
    .maybeSingle()
  if (readErr) {
    console.error('[menu.toggleFeatured] read', readErr.message)
    return { ok: false, message: 'No pudimos leer el ítem.' }
  }
  if (!current) return { ok: false, message: 'El ítem no existe.' }

  const nowFeatured = !(current.featured ?? false)

  const { error: updateErr } = await supabase
    .from('menu_items')
    .update({ featured: nowFeatured } as { featured?: boolean })
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (updateErr) {
    console.error('[menu.toggleFeatured] update', updateErr.message)
    return { ok: false, message: 'No pudimos actualizar el ítem.' }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'menu_item.featured_toggled',
    entity: 'menu_item',
    entityId: idParsed.data,
    payload: { featured: nowFeatured },
  })

  revalidatePath(`/${slug}/menu`)
  return { ok: true, message: nowFeatured ? 'Ítem destacado.' : 'Destacado removido.' }
}
