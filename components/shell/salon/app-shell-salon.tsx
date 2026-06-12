import { getTenantFeatures } from '@/lib/platform/features'
import { isPlatformAdmin } from '@/lib/platform/is-admin'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { BottomTabBar } from './bottom-tab-bar'
import { PwaInstallPrompt } from './install-prompt'
import { SalonTopbar } from './salon-topbar'
import { ServiceWorkerRegistration } from './service-worker-registration'

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
  const admin = await isPlatformAdmin()

  return (
    <div className="bg-app-gradient relative flex min-h-[100dvh] flex-col">
      <SalonTopbar tenant={tenant} />

      <main className="flex-1 pb-24 pt-2">
        <div className="mx-auto w-full max-w-screen-md px-4 sm:px-6">{children}</div>
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
