import 'server-only'
import { notFound } from 'next/navigation'
import type { Tenant } from '@/lib/tenant/types'
import { type FeatureKey, isFeatureEnabled } from './features'
import { actsAsPlatformAdmin } from './is-admin'

/**
 * Corta con notFound() cuando la feature está OFF para el tenant.
 * Los superadmins siempre pasan (pueden ver los paneles ocultos), salvo mirando el panel con
 * otro rol («Ver como»): ahí ven lo mismo que esa persona.
 * Usar en page/layout DESPUÉS de requireTenantAccess (que ya trae feature_flags).
 */
export async function requireFeature(
  tenant: Pick<Tenant, 'feature_flags'>,
  key: FeatureKey,
): Promise<void> {
  if (isFeatureEnabled(tenant, key)) return
  if (await actsAsPlatformAdmin()) return
  notFound()
}
