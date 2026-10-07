import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { todayInCordoba } from '@/lib/dates/zone'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ComponentCatalog } from './_components/catalog/component-catalog'

export const metadata: Metadata = {
  title: 'Componentes',
  robots: { index: false },
}

/**
 * El catálogo interno del kit HUB (§6.1). Solo el dueño (y el superadmin de
 * la plataforma): no está en el menú lateral ni en el de la cuenta, se llega
 * desde Documentación y desde ⌘K. Los roles acotados ni siquiera llegan acá
 * (el proxy no tiene `docs` en sus prefijos). Sin datos reales ni consultas:
 * lo único que hace el server es validar el acceso y fijar «hoy» en Córdoba
 * para que el server y el cliente dibujen las mismas fechas de ejemplo.
 */
export default async function ComponentCatalogPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    const access = await requireTenantAccess(tenantSlug)
    if (!access.isPlatformAdmin) requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  return <ComponentCatalog tenantSlug={tenantSlug} today={todayInCordoba()} />
}
