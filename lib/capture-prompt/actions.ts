'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { Json } from '@/types/database'
import { capturePromptConfigSchema } from './schemas'

export type CapturePromptState = { ok: true; message?: string } | { ok: false; message: string }

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

export async function updateCapturePromptConfig(
  slug: string,
  _prev: CapturePromptState,
  formData: FormData,
): Promise<CapturePromptState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = capturePromptConfigSchema.safeParse({
    enabled: formData.get('enabled') === 'true',
    headline: formData.get('headline'),
    subtext: formData.get('subtext'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenant.id)
    .maybeSingle()
  const settings = (current?.settings ?? {}) as Record<string, unknown>
  const nextSettings: Json = { ...settings, capture_prompt: parsed.data }

  const { error } = await supabase
    .from('tenants')
    .update({ settings: nextSettings })
    .eq('id', tenant.id)
  if (error) {
    console.error('[capture-prompt.update]', error.message)
    return { ok: false, message: 'No se pudo guardar.' }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'tenant_config.capture_prompt_updated',
    entity: 'tenant',
    entityId: tenant.id,
    payload: { enabled: parsed.data.enabled },
  })

  revalidatePath(`/${slug}/club/bienvenida`)
  return { ok: true, message: 'Guardado.' }
}
