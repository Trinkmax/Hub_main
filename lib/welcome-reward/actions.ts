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
import { updateWelcomeRewardConfigSchema } from './schemas'

export type WelcomeRewardActionState =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

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

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function updateWelcomeRewardConfig(
  slug: string,
  _prev: WelcomeRewardActionState,
  formData: FormData,
): Promise<WelcomeRewardActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  // FormData de un <form action={action}>: enabled puede venir como 'on'
  // o como string 'true'/'false' según el control que use la UI. La coerción
  // del schema (z.coerce.boolean) trata cualquier no-empty como true, así
  // que normalizamos: solo es true si llega presente y distinto de ''.
  const enabledRaw = formData.get('enabled')
  const enabled = enabledRaw !== null && enabledRaw !== '' && enabledRaw !== 'false'

  const parsed = updateWelcomeRewardConfigSchema.safeParse({
    enabled,
    reward_id: formData.get('reward_id'),
    headline: formData.get('headline'),
    subtext: formData.get('subtext'),
    bonus_points: formData.get('bonus_points') ?? 0,
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()
  const userId = userResult.user?.id ?? null
  if (!userId) return { ok: false, message: 'No autenticado.' }

  // Si llegó reward_id, validar que pertenece al tenant y está activo.
  // Importante: la unique constraint vive en PK = tenant_id, así que un upsert
  // sin onConflict no es seguro. Validamos primero el reward, después upsert.
  if (parsed.data.reward_id !== null) {
    const { data: reward, error: rewardError } = await supabase
      .from('rewards')
      .select('id, active')
      .eq('id', parsed.data.reward_id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (rewardError) {
      console.error('[welcome-reward.update] reward lookup', rewardError.message)
      return { ok: false, message: 'No pudimos validar la recompensa.' }
    }
    if (!reward) {
      return {
        ok: false,
        message: 'La recompensa no existe o no pertenece a este bar.',
        fieldErrors: { reward_id: 'Recompensa inválida' },
      }
    }
    if (!reward.active) {
      return {
        ok: false,
        message: 'La recompensa está pausada — activala primero.',
        fieldErrors: { reward_id: 'Recompensa pausada' },
      }
    }
  }

  // Upsert por PK (tenant_id). Si no existe la fila la crea, si existe la pisa.
  const { error: upsertError } = await supabase
    // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados
    .from('welcome_reward_configs' as any)
    .upsert(
      {
        tenant_id: tenant.id,
        enabled: parsed.data.enabled,
        reward_id: parsed.data.reward_id,
        headline: parsed.data.headline,
        subtext: parsed.data.subtext,
        bonus_points: parsed.data.bonus_points,
        updated_by: userId,
      },
      { onConflict: 'tenant_id' },
    )

  if (upsertError) {
    console.error('[welcome-reward.update] upsert', upsertError.message)
    return { ok: false, message: 'No pudimos guardar la configuración.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId,
    action: 'welcome_reward.config_updated',
    entity: 'welcome_reward_config',
    entityId: tenant.id,
    payload: {
      enabled: parsed.data.enabled,
      reward_id: parsed.data.reward_id,
      headline: parsed.data.headline,
      subtext: parsed.data.subtext,
    },
  })

  // Revalidamos la página del club y la home del tenant (que puede
  // mostrar previews del welcome reward).
  revalidatePath(`/${slug}/club/bienvenida`)
  revalidatePath(`/${slug}`)

  return { ok: true, message: 'Configuración guardada.' }
}
