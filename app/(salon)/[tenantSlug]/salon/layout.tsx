import type { Metadata, Viewport } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BranchGate } from '@/components/branches/branch-gate'
import { AppVersionWatcher } from '@/components/shell/app-version-watcher'
import { ClaimsRefresher } from '@/components/shell/claims-refresher'
import { RefreshOnReturn } from '@/components/shell/refresh-on-return'
import { AppShellSalon } from '@/components/shell/salon/app-shell-salon'
import { signOutAction } from '@/components/shell/sign-out-action'
import { currentDeploymentId } from '@/lib/app-version/deployment'
import { getBranchPulses } from '@/lib/branches/pulse'
import { getBranchScope } from '@/lib/branches/scope'
import { toClientScope } from '@/lib/branches/types'
import { getEffectiveFeatures } from '@/lib/platform/features'
import { getActiveBranch } from '@/lib/pos/queries'
import {
  POS_FLOOR_ROLES,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
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
    ? (
        await getActiveBranch(
          access.tenant.id,
          null,
          access.branches.map((branch) => branch.id),
        )
      ).branches.map((branch) => branch.id)
    : []

  // El salón es un lugar: con más de una sucursal y sin haber elegido en este equipo, primero «¿Dónde trabajás
  // hoy?» (una vez; después se cambia desde arriba). Un link con ?sucursal= (la tele) no pregunta.
  const branchScope = await getBranchScope(tenantSlug, 'device')
  if (branchScope.needsChoice) {
    const pulses = await getBranchPulses(
      access.tenant.id,
      branchScope.branches.map((branch) => branch.id),
    )
    return (
      <>
        {claimsStale ? <ClaimsRefresher /> : null}
        <BranchGate
          slug={tenantSlug}
          tenantName={access.tenant.name}
          branches={branchScope.branches}
          canAll={false}
          pulses={pulses}
          email={access.user.email ?? ''}
          signOut={signOutAction}
          surface="device"
        />
      </>
    )
  }

  return (
    <AppShellSalon
      branchScope={toClientScope(branchScope)}
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
              logoUrl: access.tenant.logo_url ?? null,
            }
          : null
      }
      // Los avisos de cocina son de quien atiende mesas (con «Ver como» no: sonarían los de otra persona).
      waiterNotices={
        printBranches.length > 0 && POS_FLOOR_ROLES.includes(access.realRole)
          ? {
              userId: access.user.id,
              branchIds: printBranches,
              // Al mozo se le ofrecen al entrar; al resto, recién cuando atiende una mesa.
              askOnEntry: access.realRole === 'waiter',
            }
          : null
      }
    >
      {claimsStale ? <ClaimsRefresher /> : null}
      <RefreshOnReturn />
      {/* Con una versión nueva publicada, la app se recarga sola cuando no le saca nada de las manos a nadie. */}
      <AppVersionWatcher servedId={currentDeploymentId()} workspace="salon" />
      {children}
    </AppShellSalon>
  )
}
