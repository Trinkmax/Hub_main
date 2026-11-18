'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

const SETTINGS_KEY = 'onboarding'

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
    ) {
      return null
    }
    throw error
  }
}

/**
 * «No mostrar más» de la lista de primeros pasos del Resumen. Guarda la marca en los ajustes del bar
 * (la misma que dejaba el asistente de primer arranque, así los bares que ya lo habían pasado no
 * vuelven a ver la lista).
 */
export async function markOnboardingCompleted(slug: string): Promise<{ ok: boolean }> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false }

  const supabase = await createClient()
  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  const next = {
    ...settings,
    [SETTINGS_KEY]: { completed: true, completed_at: new Date().toISOString() },
  }

  const { error } = await supabase.from('tenants').update({ settings: next }).eq('id', tenant.id)
  if (error) {
    console.error('[onboarding.markCompleted]', error.message)
    return { ok: false }
  }

  revalidatePath(`/${slug}`)
  return { ok: true }
}
