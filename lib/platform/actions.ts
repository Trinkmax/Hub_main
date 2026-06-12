'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from './is-admin'
import { setTenantFeatureSchema } from './schemas'

export type SetTenantFeatureResult = { ok: true } | { ok: false; error: string }

/**
 * Togglea una feature flag de un tenant. Solo superadmin.
 * Defensa en profundidad: chequeo en la action + policy RLS
 * (tenants_update_platform_admin) + trigger trg_guard_feature_flags.
 */
export async function setTenantFeature(input: unknown): Promise<SetTenantFeatureResult> {
  const parsed = setTenantFeatureSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const { tenantId, key, enabled } = parsed.data

  if (!(await isPlatformAdmin())) return { ok: false, error: 'No autorizado' }

  const supabase = await createClient()

  const { data: row, error: readErr } = await supabase
    .from('tenants')
    .select('id, slug, feature_flags')
    .eq('id', tenantId)
    .single()

  if (readErr || !row) return { ok: false, error: 'Bar no encontrado' }

  const current = (row.feature_flags ?? {}) as Record<string, boolean>
  const next = { ...current, [key]: enabled }

  const { error: writeErr } = await supabase
    .from('tenants')
    .update({ feature_flags: next })
    .eq('id', tenantId)

  if (writeErr) {
    console.error('[platform.setTenantFeature]', writeErr.code, writeErr.message)
    return { ok: false, error: 'No se pudo guardar' }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${tenantId}`)
  // Recalcula la nav del bar afectado.
  revalidatePath(`/${row.slug}`, 'layout')

  return { ok: true }
}
