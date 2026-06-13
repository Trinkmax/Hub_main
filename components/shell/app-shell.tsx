import { getTenantFeatures } from '@/lib/platform/features'
import { isPlatformAdmin } from '@/lib/platform/is-admin'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { SidebarContent } from './sidebar-content'
import { Topbar } from './topbar'

export async function AppShell({
  tenant,
  role,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url' | 'feature_flags'>
  role: TenantRole
  children: React.ReactNode
}) {
  const features = getTenantFeatures(tenant)
  const admin = await isPlatformAdmin()

  return (
    <div className="bg-app-gradient relative min-h-screen">
      {/* Sidebar fija — desktop */}
      <aside
        aria-label="Navegación principal"
        className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-border/60 bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/65 lg:flex"
      >
        <SidebarContent tenant={tenant} role={role} features={features} isPlatformAdmin={admin} />
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[260px]">
        <Topbar tenant={tenant} role={role} features={features} isPlatformAdmin={admin} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
