import { signOutAction } from '@/components/shell/sign-out-action'
import { getTenantFeatures } from '@/lib/platform/features'
import { isPlatformAdmin } from '@/lib/platform/is-admin'
import { createClient } from '@/lib/supabase/server'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { AccountSheet } from './account-sheet'
import { BottomTabBar } from './bottom-tab-bar'
import { PwaInstallPrompt } from './install-prompt'
import { PullToRefresh } from './pull-to-refresh'
import { SalonTopbar } from './salon-topbar'
import { ServiceWorkerRegistration } from './service-worker-registration'

/**
 * Shell del salón. Define el CONTRATO DE SCROLL del workspace:
 *
 *   → scrollea el documento, y nada más.
 *
 * Ninguna página del salón puede abrir su propio `h-[100dvh]` ni su propio
 * `overflow-auto`: eso era exactamente lo que producía el doble scroll (el
 * operativo de reservas metía un `100dvh` DENTRO de un main que ya tenía topbar
 * + padding, así que el documento medía 100dvh + 160px y adentro había otra
 * región scrolleable). Con el documento como único scroller, además, funciona
 * el pull-to-refresh, que escucha `window.scrollY`.
 *
 * Los altos del chrome son tokens (`--salon-topbar-h`, `--salon-tabbar-h`), no
 * números sueltos: la tab bar declara el suyo y el contenido lo consume.
 */
export async function AppShellSalon({
  tenant,
  role,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'feature_flags'>
  role: TenantRole
  children: React.ReactNode
}) {
  const features = getTenantFeatures(tenant)
  const supabase = await createClient()
  const [admin, { data: userData }] = await Promise.all([
    isPlatformAdmin(),
    supabase.auth.getUser(),
  ])

  return (
    <div className="bg-app-gradient relative flex min-h-[100dvh] flex-col">
      <SalonTopbar
        tenant={tenant}
        account={
          <AccountSheet
            email={userData.user?.email ?? ''}
            role={role}
            tenantName={tenant.name}
            tenantSlug={tenant.slug}
            signOut={signOutAction}
          />
        }
      />

      <main className="flex-1 pb-[calc(var(--salon-tabbar-h)+1rem)] pt-3">
        <PullToRefresh>
          <div className="mx-auto w-full max-w-screen-md px-4">{children}</div>
        </PullToRefresh>
      </main>

      <BottomTabBar
        tenantSlug={tenant.slug}
        role={role}
        features={features}
        isPlatformAdmin={admin}
      />

      <ServiceWorkerRegistration />
      <PwaInstallPrompt />
    </div>
  )
}
