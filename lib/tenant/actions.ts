'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireTenantAccess } from './access'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from './errors'

const tenantIdSchema = z.string().uuid()

export type SetActiveTenantResult = { ok: true } | { ok: false; error: string }

export async function setActiveTenant(tenantId: string): Promise<SetActiveTenantResult> {
  const parsed = tenantIdSchema.safeParse(tenantId)
  if (!parsed.success) return { ok: false, error: 'invalid_tenant_id' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new UnauthenticatedError()

  const { error: rpcError } = await supabase.rpc('set_active_tenant', {
    p_tenant: parsed.data,
  })
  if (rpcError) return { ok: false, error: rpcError.message }

  // Forzamos refresh del JWT para que el hook reinyecte active_tenant_id
  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) return { ok: false, error: refreshError.message }

  revalidatePath('/', 'layout')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Total seats (capacidad declarativa del bar)
// ──────────────────────────────────────────────────────────

const totalSeatsSchema = z
  .union([
    z.coerce.number().int().min(1, 'Mínimo 1 lugar').max(2000, 'Demasiados lugares'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (typeof v === 'number' ? v : null))

export type UpdateTotalSeatsResult =
  | { ok: true; totalSeats: number | null }
  | { ok: false; message: string }

export async function updateTotalSeatsAction(
  slug: string,
  raw: FormDataEntryValue | number | null | undefined,
): Promise<UpdateTotalSeatsResult> {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])

    const parsed = totalSeatsSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Valor inválido' }
    }

    const supabase = await createClient()
    // total_seats se agrega en la migración 20260527 — cast hasta regenerar types.
    const { error } = await supabase
      .from('tenants')
      .update({ total_seats: parsed.data } as never)
      .eq('id', tenant.id)
    if (error) {
      console.error('[tenant.updateTotalSeats]', error.message)
      return { ok: false, message: 'No se pudo guardar.' }
    }

    revalidatePath(`/${slug}/configuracion/salon`)
    revalidatePath(`/${slug}/salon/mesas`)
    return { ok: true, totalSeats: parsed.data }
  } catch (e) {
    if (
      e instanceof UnauthenticatedError ||
      e instanceof TenantNotFoundError ||
      e instanceof RoleRequiredError
    ) {
      return { ok: false, message: 'No tenés permiso.' }
    }
    throw e
  }
}
