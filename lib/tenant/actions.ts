'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { UnauthenticatedError } from './errors'

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
