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

const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido')
    .default('#94a3b8'),
})

export type TagActionState = { ok: true } | { ok: false; message: string }

async function authorizeOwnerCashier(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner', 'cashier'])
    return tenant
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

export async function createTag(slug: string, formData: FormData): Promise<TagActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createTagSchema.safeParse({
    name: formData.get('name'),
    color: formData.get('color') ?? '#94a3b8',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('customer_tags')
    .insert({ tenant_id: tenant.id, name: parsed.data.name, color: parsed.data.color })

  if (error) {
    if (error.code === '23505')
      return { ok: false, message: 'Ya existe una etiqueta con ese nombre.' }
    return { ok: false, message: 'No pudimos crear la etiqueta.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: user.user?.id ?? null,
    action: 'tag.created',
    entity: 'customer_tag',
    payload: { name: parsed.data.name },
  })

  revalidatePath(`/${slug}/clientes`)
  return { ok: true }
}

export async function deleteTag(slug: string, tagId: string): Promise<TagActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(tagId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_tags')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)

  if (error) return { ok: false, message: 'No pudimos borrar la etiqueta.' }

  revalidatePath(`/${slug}/clientes`)
  return { ok: true }
}
