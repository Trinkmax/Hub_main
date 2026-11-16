import type { Metadata, Viewport } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ClaimsRefresher } from '@/components/shell/claims-refresher'
import { RefreshOnReturn } from '@/components/shell/refresh-on-return'
import { AppShellSalon } from '@/components/shell/salon/app-shell-salon'
import { getEffectiveFeatures } from '@/lib/platform/features'
import { getActiveBranch } from '@/lib/pos/queries'
import { requireTenantAccess, TenantNotFoundError, UnauthenticatedError } from '@/lib/tenant'
import { roleForSlug } from '@/lib/tenant/claims'

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HUB!',
    startupImage: '/icons/icon-512.png',
  },
  applicationName: 'HUB! Salón',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  // Un solo color: el salón es light-only (ver lib/workspace.ts). Con el par
  // light/dark, un celular en modo oscuro pintaba la barra de estado verde
  // noche arriba de un panel crema.
  themeColor: '#f5edd7',
  width: 'device-width',
  initialScale: 1,
  // Hasta los bordes: la barra de abajo flota sobre el área segura del iPhone (env() deja de valer 0).
  viewportFit: 'cover',
  // Sin `maximumScale`/`userScalable: false`: bloquear el zoom rompe WCAG 1.4.4
  // y en un salón oscuro el mozo a veces necesita agrandar. El auto-zoom de iOS
  // al enfocar un input ya está cubierto por el `text-base` de <Input>.
}

export default async function SalonLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=/${tenantSlug}/salon`)
    }
    throw error
  }

  // El proxy rutea por el rol del JWT (≤1 h de antigüedad). Si difiere del rol
  // real que devolvió la DB, refrescar la sesión desde el browser (una vez/min).
  // Contra el rol REAL: con «Ver como» el rol que se muestra es otro a propósito.
  const claimRole = access.user.tenants ? roleForSlug(access.user.tenants, tenantSlug) : null
  const claimsStale = access.user.tenants !== null && claimRole !== access.realRole

  // Con el punto de venta, la compu que tiene la comandera imprime sola desde cualquier pantalla del
  // salón: el marco necesita las sucursales del bar (cada dispositivo guarda en cuál imprime). Una
  // lectura, y solo en los bares que lo usan (el marco no se vuelve a armar al cambiar de pantalla).
  const printBranches = getEffectiveFeatures(access.tenant).pos
    ? (await getActiveBranch(access.tenant.id)).branches.map((branch) => branch.id)
    : []

  return (
    <AppShellSalon
      tenant={access.tenant}
      role={access.role}
      isPlatformAdmin={access.isPlatformAdmin}
      email={access.user.email ?? ''}
      viewAs={access.canViewAs ? { slug: tenantSlug, viewAs: access.viewAs } : null}
      printStation={
        printBranches.length > 0
          ? {
              branchIds: printBranches,
              timeZone: access.tenant.timezone || 'America/Argentina/Cordoba',
            }
          : null
      }
    >
      {claimsStale ? <ClaimsRefresher /> : null}
      <RefreshOnReturn />
      {children}
    </AppShellSalon>
  )
}
