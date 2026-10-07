import { cookies } from 'next/headers'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { PortalContainerProvider } from '@/components/ui/portal-container'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getTenantFeatures } from '@/lib/platform/features'
import { homePathForRole } from '@/lib/tenant/roles'
import type { AccountingAccess, MembershipWithTenant, Tenant, TenantRole } from '@/lib/tenant/types'
import { ShellFrame } from './shell-frame'
import { MAIN_CONTENT_ID, SIDEBAR_COOKIE } from './shell-ids'
import { ShellInfoProvider } from './shell-info'
import { SidebarContent } from './sidebar-content'
import { SidebarProvider } from './sidebar-state'
import { Topbar } from './topbar'

/**
 * Shell del manager. NO hace I/O a Supabase: todo lo que necesita (tenant, rol,
 * memberships, superadmin, acceso a Administración, email) ya lo trajo
 * `requireTenantAccess` en el layout en un solo round-trip. Antes el shell +
 * topbar sumaban 3 hops más por navegación (is_platform_admin, memberships,
 * getUser).
 *
 * Monta una sola vez lo que comparten todas las pantallas del panel (§4.1):
 * - `TooltipProvider` (400 ms el primero, 300 de gracia: el siguiente aparece
 *   al toque).
 * - `ConfirmProvider`: el diálogo de `useConfirm()` vive acá y no adentro del
 *   menú que lo pide (si no, se desmonta con el menú antes de confirmar).
 * - `PortalContainerProvider` con su default: los overlays del panel van al
 *   `<body>`, que hereda el tema del `<html>`. Las vistas previas congeladas
 *   (`enlaces`, `club/simular`) ponen el suyo en su envoltorio `.force-light`.
 */
export async function AppShell({
  tenant,
  role,
  isPlatformAdmin,
  accounting,
  email,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url' | 'feature_flags'>
  role: TenantRole
  /**
   * Reservado para el selector de bar (pendiente en BACKLOG: una contadora o
   * un dueño con varios bares). Hoy el shell no lo usa.
   */
  memberships?: MembershipWithTenant[]
  isPlatformAdmin: boolean
  /** `TenantAccess.accounting`: viene adentro de `requireTenantAccess`, sin otra consulta. */
  accounting: AccountingAccess
  email: string
  children: React.ReactNode
}) {
  const features = getTenantFeatures(tenant)
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <ShellInfoProvider tenantSlug={tenant.slug} homeHref={homePathForRole(role, tenant.slug)}>
      <PortalContainerProvider container={null}>
        <TooltipProvider>
          <ConfirmProvider>
            <SidebarProvider initialCollapsed={sidebarCollapsed}>
              {/* Lo primero que se enfoca con Tab: saltea el menú y el topbar. */}
              <a
                href={`#${MAIN_CONTENT_ID}`}
                className="sr-only rounded-md border border-border bg-popover px-3 py-2 type-label text-foreground shadow-float outline-(--ring) outline-offset-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus-visible:outline-2"
              >
                Saltar al contenido
              </a>
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
                  accounting={accounting}
                  email={email}
                />
                {/* `tabIndex={-1}`: destino del «Saltar al contenido» y del foco
                    al navegar desde el cajón. Sin anillo: no es un control. */}
                <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
                  {children}
                </main>
              </ShellFrame>
            </SidebarProvider>
          </ConfirmProvider>
        </TooltipProvider>
      </PortalContainerProvider>
    </ShellInfoProvider>
  )
}
