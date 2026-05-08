'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isValidSlug, slugify } from '@/lib/tenant/slugify'

const schema = z.object({
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(80, 'Máximo 80'),
  slug: z.string().trim().toLowerCase().refine(isValidSlug, 'Slug inválido o reservado'),
})

export type CreateTenantState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fields?: { name?: string; slug?: string }
  redirectTo?: string
}

export async function createTenant(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const raw = {
    name: String(formData.get('name') ?? ''),
    slug: String(formData.get('slug') ?? '').trim() || slugify(String(formData.get('name') ?? '')),
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fields: raw,
    }
  }

  const supabase = await createClient()
  const { data: tenant, error } = await supabase.rpc('create_tenant_with_owner', {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  })

  if (error) {
    if (error.message.includes('tenants_slug_key') || error.code === '23505') {
      return { status: 'error', message: 'Ese slug ya está tomado.', fields: raw }
    }
    return { status: 'error', message: 'No pudimos crear el bar. Probá de nuevo.', fields: raw }
  }

  await supabase.auth.refreshSession()
  const slug = (tenant as { slug?: string } | null)?.slug ?? parsed.data.slug
  return { status: 'success', redirectTo: `/${slug}` }
}
