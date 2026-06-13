import 'server-only'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import type { Tenant } from '@/lib/tenant/types'
import { type FeatureKey, getTenantFeatures, isFeatureEnabled } from './features'
import { isPlatformAdmin } from './is-admin'

/**
 * Corta con notFound() cuando la feature está OFF para el tenant.
 * Los superadmins siempre pasan (pueden ver los paneles ocultos).
 * Usar en page/layout DESPUÉS de requireTenantAccess (que ya trae feature_flags).
 */
export async function requireFeature(
  tenant: Pick<Tenant, 'feature_flags'>,
  key: FeatureKey,
): Promise<void> {
  if (isFeatureEnabled(tenant, key)) return
  if (await isPlatformAdmin()) return
  notFound()
}

/**
 * Variante para rutas que resuelven el tenant por id vía service-role (ej. páginas
 * públicas/print que no usan requireTenantAccess). Lee feature_flags con el service
 * client (bypass RLS) y aplica la misma regla (flag ON o superadmin).
 */
export async function requireFeatureByTenantId(tenantId: string, key: FeatureKey): Promise<void> {
  const service = createServiceClient()
  const { data } = await service
    .from('tenants')
    .select('feature_flags')
    .eq('id', tenantId)
    .maybeSingle()
  const features = getTenantFeatures({
    feature_flags: (data?.feature_flags ?? {}) as Record<string, boolean>,
  })
  if (features[key]) return
  if (await isPlatformAdmin()) return
  notFound()
}
