import 'server-only'
import { notFound } from 'next/navigation'
import { isFeatureEnabled } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
} from '@/lib/tenant'

/**
 * La puerta de cada página de Compras: el rol (cocina o dueño, según la pantalla) y la función prendida
 * en el bar. Si falta algo, 404: no se muestra que la sección existe. El superadmin la ve aunque el bar la
 * tenga apagada (para probarla), como el resto de las funciones.
 */
export async function requirePurchasingPage(tenantSlug: string, roles: ReadonlyArray<TenantRole>) {
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, roles)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  if (!access.isPlatformAdmin && !isFeatureEnabled(access.tenant, 'purchasing')) notFound()
  return access
}

/** El nombre de pila de quien mira, para «Hola, Gustavo» y «Quién cuenta». Sale del JWT (sin viaje). */
export async function viewerFirstName(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const meta: unknown = data?.claims?.user_metadata
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).full_name ?? (meta as Record<string, unknown>).name
  if (typeof raw !== 'string') return null
  const first = raw.trim().split(/\s+/)[0] ?? ''
  return first ? first.slice(0, 40) : null
}
