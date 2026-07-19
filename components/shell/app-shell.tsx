import { cookies } from 'next/headers'
import { getTenantFeatures } from '@/lib/platform/features'
import { isPlatformAdmin } from '@/lib/platform/is-admin'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { ShellFrame } from './shell-frame'
import { SidebarContent } from './sidebar-content'
import { SIDEBAR_COOKIE, SidebarProvider } from './sidebar-state'
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
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <SidebarProvider initialCollapsed={sidebarCollapsed}>
      <div className="bg-app-gradient relative min-h-screen">
        <ShellFrame
          sidebar={
            <SidebarContent
              tenant={tenant}
              role={role}
              features={features}
              isPlatformAdmin={admin}
            />
          }
        >
          <Topbar tenant={tenant} role={role} features={features} isPlatformAdmin={admin} />
          <main className="flex-1">{children}</main>
        </ShellFrame>
      </div>
    </SidebarProvider>
  )
}
