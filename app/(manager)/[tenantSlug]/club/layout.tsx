import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ClubNav } from './_components/club-nav'

/**
 * Shell del Club de beneficios: una sola IA con sub-nav por tabs (Resumen,
 * Niveles, Puntos y recompensas, Punch cards, Bienvenida). Todo vive bajo
 * /club/* para que el navbar marque "Club de beneficios" como activo y la
 * fidelización se sienta como un solo lugar, no piezas sueltas.
 *
 * Owner-only (mismo guard que cada página) para no mostrar la sub-nav a quien
 * no corresponde — `requireTenantAccess` está cache()'d, así que no agrega hops.
 */
export default async function ClubLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    const { role } = await requireTenantAccess(tenantSlug)
    requireRole(role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <ClubNav tenantSlug={tenantSlug} />
      {children}
    </div>
  )
}
