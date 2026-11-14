import { cookies } from 'next/headers'
import { getEffectiveFeatures } from '@/lib/platform/features'
import type { AccountingAccess, MembershipWithTenant, Tenant, TenantRole } from '@/lib/tenant/types'
import { ShellFrame } from './shell-frame'
import { SidebarContent } from './sidebar-content'
import { SIDEBAR_COOKIE, SidebarProvider } from './sidebar-state'
import { Topbar } from './topbar'
import { ViewAsProvider, type ViewAsState } from './view-as'

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
  accounting,
  viewAs = null,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url' | 'feature_flags'>
  role: TenantRole
  memberships: MembershipWithTenant[]
  isPlatformAdmin: boolean
  email: string
  /** Administración para esta persona: la entrada del menú y las de ⌘K. */
  accounting?: AccountingAccess
  /** «Ver como» para el menú de usuario; null si esta persona no puede usarlo. */
  viewAs?: ViewAsState | null
  children: React.ReactNode
}) {
  const features = getEffectiveFeatures(tenant)
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <ViewAsProvider value={viewAs}>
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
                accounting={accounting}
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
              accounting={accounting}
            />
            <main className="flex-1">{children}</main>
          </ShellFrame>
        </div>
      </SidebarProvider>
    </ViewAsProvider>
  )
}
