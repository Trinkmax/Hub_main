import { cookies } from 'next/headers'
import { getEffectiveFeatures } from '@/lib/platform/features'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { AccountingAccess, MembershipWithTenant, Tenant, TenantRole } from '@/lib/tenant/types'
import { DockFlatProvider } from './dock/dock-flat-context'
import {
  type DockSections,
  dockCookieName,
  flattenedSections,
  parseDockCookie,
  planDock,
} from './dock/dock-items'
import { ManagerDock } from './mobile/manager-dock'
import { NO_ACCOUNTING, resolveNavGroups } from './nav-config'
import { resolveSection } from './section-tabs-config'
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
  isPlatformAdmin,
  email,
  accounting,
  viewAs = null,
  tex = false,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url' | 'feature_flags'>
  role: TenantRole
  /** Los bares de esta persona (hoy no se muestran: queda para cambiar de bar desde la cuenta). */
  memberships?: MembershipWithTenant[]
  isPlatformAdmin: boolean
  email: string
  /** Administración para esta persona: la entrada del menú y las de ⌘K. */
  accounting?: AccountingAccess
  /** «Ver como» para el menú de usuario; null si esta persona no puede usarlo. */
  viewAs?: ViewAsState | null
  /** ¿Está Tex en este panel? En el celular vive en el círculo de la barra de abajo. */
  tex?: boolean
  children: React.ReactNode
}) {
  const features = getEffectiveFeatures(tenant)
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'
  // La barra de abajo del celular: las pestañas que eligió esta persona (o las de su rol) y el resto en «Más».
  const groups = resolveNavGroups(role, tenant.slug, features, isPlatformAdmin, accounting)
  // Las pestañas de adentro de cada sección, con las mismas puertas que las de arriba de la página: quien
  // tiene una o dos secciones (la anfitriona) las lleva sueltas en la barra.
  const viewer = { role, features, isPlatformAdmin, accounting: accounting ?? NO_ACCOUNTING }
  const sections: DockSections = {}
  for (const item of groups.flatMap((group) => group.items)) {
    if (item.section) sections[item.section] = resolveSection(item.section, tenant.slug, viewer)
  }
  const dock = planDock(
    groups,
    role,
    parseDockCookie(cookieStore.get(dockCookieName(tenant.slug))?.value),
    sections,
  )

  return (
    <ViewAsProvider value={viewAs}>
      <SidebarProvider initialCollapsed={sidebarCollapsed}>
        {/* min-h-dvh (no screen/vh): en iOS 100vh es el viewport "grande" y deja
          la página scrolleable la altura de la barra del navegador */}
        <div className="bg-app-gradient relative min-h-dvh pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
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
              email={email}
              accounting={accounting}
            />
            {/* En el celular deja lugar abajo para la barra flotante (en la compu --dock-space vale 0). */}
            <main className="flex-1 pb-(--dock-space)">
              <DockFlatProvider sections={flattenedSections(dock)}>{children}</DockFlatProvider>
            </main>
          </ShellFrame>
          {dock ? (
            <ManagerDock
              slug={tenant.slug}
              tenantName={tenant.name}
              groups={groups}
              sections={sections}
              plan={dock}
              tex={tex}
              viewer={{
                role,
                roleLabel: ROLE_LABELS[role],
                features,
                isPlatformAdmin,
                accounting: accounting ?? NO_ACCOUNTING,
                email,
              }}
            />
          ) : null}
        </div>
      </SidebarProvider>
    </ViewAsProvider>
  )
}
