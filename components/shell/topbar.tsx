import { CommandPalette } from '@/components/command-palette/command-palette'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import type { TenantFeatures } from '@/lib/platform/features'
import { homePathForRole, ROLE_LABELS } from '@/lib/tenant/roles'
import type { AccountingAccess, Tenant, TenantRole } from '@/lib/tenant/types'
import { MobileAccountButton, MobileTopbarTitle } from './mobile/mobile-topbar'
import { SidebarToggle } from './sidebar-state'
import { UserMenu } from './user-menu'

/**
 * La barra de arriba del panel. En la compu (desde 1024 px): el botón del menú lateral, ⌘K, el tema y tu
 * cuenta, igual que siempre. En el celular cambia de forma: sin hamburguesa (la navegación está en la barra
 * de abajo), transparente arriba de todo y de vidrio al correr la página, con la marca del bar que se funde
 * con el título de la pantalla, y tu cuenta en el avatar. Mide lo mismo en los dos (h-14): hay pantallas
 * que se pegan justo debajo (`top-14`).
 */

export function Topbar({
  tenant,
  role,
  features,
  isPlatformAdmin,
  email,
  accounting,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  email: string
  accounting?: AccountingAccess
}) {
  return (
    <header
      data-app-topbar
      className="sticky top-0 z-20 flex h-14 items-center gap-3 px-4 sm:px-6 lg:border-b lg:border-border/60 lg:bg-background/85 lg:backdrop-blur-xl lg:supports-[backdrop-filter]:bg-background/65"
    >
      <MobileTopbarTitle
        homeHref={homePathForRole(role, tenant.slug)}
        tenantName={tenant.name}
        logoUrl={tenant.logo_url}
      />

      <SidebarToggle />

      <div className="hidden flex-1 items-center md:flex">
        <CommandPalette
          tenantSlug={tenant.slug}
          role={role}
          features={features}
          isPlatformAdmin={isPlatformAdmin}
          accounting={accounting}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          <UserMenu email={email} role={ROLE_LABELS[role]} />
        </div>
        <MobileAccountButton email={email} roleLabel={ROLE_LABELS[role]} tenantName={tenant.name} />
      </div>
    </header>
  )
}
