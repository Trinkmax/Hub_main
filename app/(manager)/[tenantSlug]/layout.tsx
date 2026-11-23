import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Tex } from '@/components/administracion/tex/tex'
import { BranchGate } from '@/components/branches/branch-gate'
import { AppShell } from '@/components/shell/app-shell'
import { ClaimsRefresher } from '@/components/shell/claims-refresher'
import { RefreshOnReturn } from '@/components/shell/refresh-on-return'
import { signOutAction } from '@/components/shell/sign-out-action'
import { getBranchPulses } from '@/lib/branches/pulse'
import { getBranchScope } from '@/lib/branches/scope'
import { branchShortLabel, toClientScope } from '@/lib/branches/types'
import {
  canAccessManagerPath,
  getMembershipsForUser,
  homePathForRole,
  MANAGER_SCOPED_PREFIXES,
  requireTenantAccess,
  SALON_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { roleForSlug } from '@/lib/tenant/claims'
import { texEnabled } from '@/lib/tex/enabled'
import { PATH_HEADER } from '@/lib/workspace'

// El panel se puede agregar a la pantalla de inicio del celular y abrirse como una app (sin la barra del
// navegador). El mismo manifiesto que el salón: `/` lleva a cada uno a su espacio según su rol.
const PANEL_METADATA: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HUB!',
  },
  applicationName: 'HUB!',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

/**
 * La pestaña del navegador dice qué sucursal se mira («Reservas · Cerro · HUB»): con dos pestañas abiertas, una por
 * sucursal, se distinguen sin entrar.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  try {
    const scope = await getBranchScope(tenantSlug)
    if (!scope.multi || scope.needsChoice) return PANEL_METADATA
    const where = scope.isAll ? 'Todas' : scope.current ? branchShortLabel(scope.current) : null
    return where
      ? { ...PANEL_METADATA, title: { template: `%s · ${where} · HUB`, default: `${where} · HUB` } }
      : PANEL_METADATA
  } catch {
    // Sin sesión o sin acceso: el layout redirige; el título no importa.
    return PANEL_METADATA
  }
}

// En el celular el panel se usa como una app: con `cover` la página llega hasta los bordes y
// `env(safe-area-inset-*)` deja de valer 0 (la barra de abajo flota sobre el área segura del iPhone).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5edd7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f2a20' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function DashboardLayout({
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
    // reason=session: le dice al proxy que NO rebote de vuelta a home si todavía
    // ve una cookie válida (PostgREST rechazó el JWT → sin esto, loop).
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=/${tenantSlug}`)
    }
    if (error instanceof TenantNotFoundError) {
      // El user está logueado pero no es miembro de este bar. En vez de 404,
      // lo llevamos a su primer bar disponible (o a onboarding si no tiene).
      const memberships = await getMembershipsForUser()
      const fallback = memberships[0]?.tenant.slug
      redirect(fallback ? `/${fallback}` : '/onboarding')
    }
    throw error
  }

  // Backstop con el rol REAL de la DB: el proxy rutea por el rol del JWT, que
  // puede quedar viejo hasta 1 h si el owner cambió el rol de esta persona.
  if (SALON_ROLES.includes(access.role)) redirect(`/${tenantSlug}/salon`)
  // Lo mismo para los roles acotados (editor, anfitrión, contadora): solo sus
  // prefijos. Sin el header del proxy no se decide nada (nunca rebotar a ciegas).
  if (MANAGER_SCOPED_PREFIXES[access.role]) {
    const path = (await headers()).get(PATH_HEADER)
    const rest = path ? path.split('/').filter(Boolean).slice(1) : null
    if (rest && !canAccessManagerPath(access.role, rest)) {
      redirect(homePathForRole(access.role, tenantSlug))
    }
  }

  // Si el JWT trae un rol distinto al de la DB, forzar un refresh de sesión
  // desde el browser para que el hook re-inyecte los claims (una vez/min).
  // Contra el rol REAL: con «Ver como» el rol que se muestra es otro a propósito.
  const claimRole = access.user.tenants ? roleForSlug(access.user.tenants, tenantSlug) : null
  const claimsStale = access.user.tenants !== null && claimRole !== access.realRole

  // «¿A dónde entrás hoy?»: con más de una sucursal y sin haber elegido en este equipo, la entrada va antes del panel
  // (en su lugar, no en otra dirección: al elegir se vuelve a pedir esta misma pantalla).
  const branchScope = await getBranchScope(tenantSlug)
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
          canAll={branchScope.canAll}
          pulses={pulses}
          email={access.user.email ?? ''}
          signOut={signOutAction}
        />
      </>
    )
  }

  return (
    <AppShell
      branchScope={toClientScope(branchScope)}
      tenant={access.tenant}
      role={access.role}
      memberships={access.memberships}
      isPlatformAdmin={access.isPlatformAdmin}
      email={access.user.email ?? ''}
      accounting={access.accounting}
      viewAs={access.canViewAs ? { slug: tenantSlug, viewAs: access.viewAs } : null}
      tex={texEnabled()}
    >
      {claimsStale ? <ClaimsRefresher /> : null}
      <RefreshOnReturn />
      {children}
      {/* En todo el panel de gestión; el salón (mozos, caja, cocina) es otro espacio. */}
      {texEnabled() ? (
        <Tex
          slug={tenantSlug}
          role={access.role}
          canAttach={access.accounting.write}
          accounting={access.accounting.enabled && access.accounting.read}
        />
      ) : null}
    </AppShell>
  )
}
