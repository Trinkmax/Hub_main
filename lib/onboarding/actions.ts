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

export type OnboardingState = {
  completed: boolean
  steps: {
    table_created: boolean
    menu_seeded: boolean
    points_configured: boolean
    team_invited: boolean
  }
}

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

export async function getOnboardingState(slug: string): Promise<OnboardingState | null> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return null

  const supabase = await createClient()
  const [
    { count: tableCount },
    { count: itemCount },
    { count: ruleCount },
    { count: memberCount },
  ] = await Promise.all([
    supabase
      .from('physical_tables')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase
      .from('menu_items')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase
      .from('points_rules')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('active', true),
    supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
  ])

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  const onboarding = (settings[SETTINGS_KEY] ?? {}) as { completed?: boolean }

  return {
    completed: Boolean(onboarding.completed),
    steps: {
      table_created: (tableCount ?? 0) > 0,
      menu_seeded: (itemCount ?? 0) > 0,
      points_configured: (ruleCount ?? 0) > 0,
      team_invited: (memberCount ?? 0) > 1, // > 1 porque el owner siempre cuenta
    },
  }
}

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
  revalidatePath(`/${slug}/onboarding`)
  return { ok: true }
}
