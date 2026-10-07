'use server'

/**
 * Administración desde la plataforma (B.4): el superadmin, en
 * `/admin/[tenantId]`, prende el flag `accounting` (FeatureToggleGrid) y elige
 * qué dueño la configura; si un bar se queda sin nadie que dé accesos, repite
 * la designación para recuperarlo.
 *
 * Doble chequeo: `isPlatformAdmin()` acá y `acc_platform_designate_admin` en la
 * base (exige `is_platform_admin()`, que el elegido sea dueño, y que el módulo
 * esté sin configurar o sin administradores vigentes). Todo queda en
 * `audit_log` dentro de la RPC.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mapAccError } from '@/lib/accounting/errors'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isPlatformAdmin } from './is-admin'

const designateSchema = z.object({
  tenantId: z.uuid({ message: 'Bar inválido.' }),
  userId: z.uuid({ message: 'Elegí quién la configura.' }),
})

export type DesignateAccountingAdminResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

/** «¿Quién configura Administración?»: designa (o recupera) al administrador de accesos. */
export async function designateAccountingAdminAction(input: {
  tenantId: string
  userId: string
}): Promise<DesignateAccountingAdminResult> {
  try {
    const parsed = designateSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
    }
    if (!(await isPlatformAdmin())) return { ok: false, error: 'No autorizado.' }
    const { tenantId, userId } = parsed.data

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_platform_designate_admin', {
      p_tenant_id: tenantId,
      p_user_id: userId,
    })
    if (error) {
      const state = mapAccError(error)
      if (state.code === 'error') {
        console.error('[platform.designateAccountingAdmin]', error.code, state.detail?.key ?? '')
      }
      return { ok: false, error: state.message }
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('slug')
      .eq('id', tenantId)
      .maybeSingle()
    revalidatePath(`/admin/${tenantId}`)
    const slug = (tenant as { slug?: unknown } | null)?.slug
    if (typeof slug === 'string' && slug !== '') revalidatePath(`/${slug}`, 'layout')

    return { ok: true, message: 'Listo: esa persona ya puede configurar Administración.' }
  } catch (error) {
    console.error(
      '[platform.designateAccountingAdmin] inesperado',
      error instanceof Error ? error.message : 'unknown',
    )
    return { ok: false, error: 'No se pudo guardar. Probá de nuevo.' }
  }
}

// ─── Lo que muestra la tarjeta del superadmin ───────────────────────────────

export type AccountingDesignationOwner = {
  userId: string
  email: string | null
  /** Nombre del perfil (metadata), si tiene. */
  name: string | null
  /** Tiene acceso vigente a Administración. */
  hasAccess: boolean
  /** Da accesos (administrador). */
  isAdmin: boolean
  /** El nombre que se ve en Administración, si tiene acceso. */
  accessName: string | null
}

export type AccountingDesignation = {
  /** El bar tiene prendido el flag `accounting`. */
  enabled: boolean
  /** Ya se hizo la puesta en marcha. */
  setUp: boolean
  /** Se puede designar: sin configurar, o configurado pero sin ningún administrador vigente. */
  canDesignate: boolean
  /** Dueños del bar: administradores primero, después con acceso, después el resto. */
  owners: AccountingDesignationOwner[]
}

const tenantIdSchema = z.uuid()

function metaName(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null
  const m = meta as Record<string, unknown>
  for (const key of ['full_name', 'name']) {
    const v = m[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

/**
 * Dueños del bar con su situación en Administración, para la tarjeta
 * «¿Quién configura Administración?». Lee con el cliente de servicio (los
 * emails viven en `auth.users`) DESPUÉS de verificar que quien pide es
 * superadmin.
 */
export async function getAccountingDesignation(
  tenantId: string,
): Promise<{ ok: true; data: AccountingDesignation } | { ok: false; error: string }> {
  try {
    if (!tenantIdSchema.safeParse(tenantId).success) return { ok: false, error: 'Bar inválido.' }
    if (!(await isPlatformAdmin())) return { ok: false, error: 'No autorizado.' }

    const service = createServiceClient()
    const [tenantRes, settingsRes, ownersRes, accessRes] = await Promise.all([
      service.from('tenants').select('feature_flags').eq('id', tenantId).maybeSingle(),
      service.from('acc_settings').select('tenant_id').eq('tenant_id', tenantId).maybeSingle(),
      service
        .from('memberships')
        .select('user_id, created_at')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .order('created_at'),
      service
        .from('acc_access')
        .select('user_id, display_name, is_admin')
        .eq('tenant_id', tenantId)
        .is('revoked_at', null),
    ])
    const failed = [tenantRes, settingsRes, ownersRes, accessRes].find((r) => r.error)
    if (failed?.error) {
      console.error('[platform.accountingDesignation]', failed.error.code, failed.error.message)
      return { ok: false, error: 'No se pudo leer el bar.' }
    }
    if (!tenantRes.data) return { ok: false, error: 'Bar no encontrado.' }

    const flags = (tenantRes.data as { feature_flags?: unknown }).feature_flags
    const enabled =
      typeof flags === 'object' &&
      flags !== null &&
      (flags as Record<string, unknown>).accounting === true
    const setUp = settingsRes.data !== null

    const access = new Map<string, { displayName: string | null; isAdmin: boolean }>()
    for (const row of (accessRes.data ?? []) as Array<{
      user_id: string
      display_name: string | null
      is_admin: boolean
    }>) {
      access.set(row.user_id, { displayName: row.display_name, isAdmin: row.is_admin === true })
    }

    const ownerIds = ((ownersRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
    const users = await Promise.all(ownerIds.map((id) => service.auth.admin.getUserById(id)))
    const owners: AccountingDesignationOwner[] = ownerIds.map((userId, i) => {
      const user = users[i]?.data.user ?? null
      const acc = access.get(userId)
      return {
        userId,
        email: user?.email ?? null,
        name: metaName(user?.user_metadata),
        hasAccess: acc !== undefined,
        isAdmin: acc?.isAdmin ?? false,
        accessName: acc?.displayName ?? null,
      }
    })
    const rank = (o: AccountingDesignationOwner) => (o.isAdmin ? 0 : o.hasAccess ? 1 : 2)
    owners.sort((a, b) => rank(a) - rank(b))

    // Un administrador vigente tiene que seguir siendo dueño (lo cruza la base igual).
    const adminsActive = owners.some((o) => o.isAdmin)
    return {
      ok: true,
      data: { enabled, setUp, canDesignate: !setUp || !adminsActive, owners },
    }
  } catch (error) {
    console.error(
      '[platform.accountingDesignation] inesperado',
      error instanceof Error ? error.message : 'unknown',
    )
    return { ok: false, error: 'No se pudo leer el bar.' }
  }
}
