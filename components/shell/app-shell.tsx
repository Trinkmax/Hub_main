import { cookies } from 'next/headers'
import { getTenantFeatures } from '@/lib/platform/features'
import type { MembershipWithTenant, Tenant, TenantRole } from '@/lib/tenant/types'
import { ShellFrame } from './shell-frame'
import { SidebarContent } from './sidebar-content'
import { SIDEBAR_COOKIE, SidebarProvider } from './sidebar-state'
import { Topbar } from './topbar'

/**
 * Shell del manager. NO hace I/O a Supabase: todo lo que necesita (tenant, rol,
 * memberships, superadmin, email) ya lo trajo `requireTenantAccess` en el layout
 * en un solo round-trip. Antes el shell + topbar sumaban 3 hops más por
 * navegación (is_platform_admin, memberships, getUser).
 */
export async function AppShell({
  tenant,
  role,
  memberships,
  isPlatformAdmin,
  email,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url' | 'feature_flags'>
  role: TenantRole
  memberships: MembershipWithTenant[]
  isPlatformAdmin: boolean
  email: string
  children: React.ReactNode
}) {
  const features = getTenantFeatures(tenant)
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <SidebarProvider initialCollapsed={sidebarCollapsed}>
      {/* min-h-dvh (no screen/vh): en iOS 100vh es el viewport "grande" y deja
          la página scrolleable la altura de la barra del navegador */}
      <div className="bg-app-gradient relative min-h-dvh">
        <ShellFrame
          sidebar={
            <SidebarContent
              tenant={tenant}
              role={role}
              features={features}
              isPlatformAdmin={isPlatformAdmin}
            />
          }
        >
          <Topbar
            tenant={tenant}
            role={role}
            features={features}
            isPlatformAdmin={isPlatformAdmin}
            memberships={memberships}
            email={email}
          />
          <main className="flex-1">{children}</main>
        </ShellFrame>
      </div>
    </SidebarProvider>
  )
}
