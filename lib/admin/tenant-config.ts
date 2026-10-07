'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

const configSchema = z.object({
  guest_idle_hours_to_rescan: z.coerce.number().int().min(1).max(24),
  session_auto_abandon_hours: z.coerce.number().int().min(1).max(72),
  ticket_auto_accept_enabled: z.coerce.boolean().default(false),
  ticket_auto_accept_max_cents: z
    .union([z.coerce.number().int().min(1), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  ticket_auto_accept_max_items: z
    .union([z.coerce.number().int().min(1).max(100), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  kitchen_flow_enabled: z.coerce.boolean().default(false),
})

export type TenantConfigState =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { tenant, role }
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

export async function getTenantConfig(slug: string) {
  const access = await authorize(slug)
  if (!access) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select(
      'guest_idle_hours_to_rescan, session_auto_abandon_hours, ticket_auto_accept_enabled, ticket_auto_accept_max_cents, ticket_auto_accept_max_items, kitchen_flow_enabled',
    )
    .eq('id', access.tenant.id)
    .maybeSingle()
  return data
}

export async function updateTenantConfig(
  slug: string,
  _prev: TenantConfigState,
  formData: FormData,
): Promise<TenantConfigState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = configSchema.safeParse({
    guest_idle_hours_to_rescan: formData.get('guest_idle_hours_to_rescan'),
    session_auto_abandon_hours: formData.get('session_auto_abandon_hours'),
    ticket_auto_accept_enabled: formData.get('ticket_auto_accept_enabled') === 'on',
    ticket_auto_accept_max_cents: formData.get('ticket_auto_accept_max_cents'),
    ticket_auto_accept_max_items: formData.get('ticket_auto_accept_max_items'),
    kitchen_flow_enabled: formData.get('kitchen_flow_enabled') === 'on',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('tenants').update(parsed.data).eq('id', access.tenant.id)
  if (error) {
    console.error('[admin.updateConfig]', error.message)
    return { ok: false, message: 'No se pudo guardar.' }
  }
  revalidatePath(`/${slug}/configuracion`)
  return { ok: true, message: 'Guardado.' }
}
