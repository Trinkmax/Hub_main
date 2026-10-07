import { CommandPalette } from '@/components/command-palette/command-palette'
import type { TenantFeatures } from '@/lib/platform/features'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { AccountingAccess, Tenant, TenantRole } from '@/lib/tenant/types'
import { MobileShell } from './mobile-shell'
import { SidebarToggle } from './sidebar-state'
import { UserMenu } from './user-menu'

/**
 * La barra de arriba del panel (§4.3): papel sólido con un pelo abajo (sin
 * vidrio: el desenfoque costaba al scrollear listas largas) y `--topbar-h` de
 * alto, la misma medida que usan los `sticky` de las páginas.
 *
 * Izquierda: el menú (cajón, debajo de `lg`) y «Ocultar menú» (desde `lg`).
 * Después, ⌘K: un campo desde `md` y una lupa en el celular, que antes no
 * tenía forma de buscar. Derecha: el menú de la cuenta (con el tema adentro).
 */
export function Topbar({
  tenant,
  role,
  features,
  isPlatformAdmin,
  accounting,
  email,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  accounting: AccountingAccess
  email: string
}) {
  return (
    <header className="sticky top-0 z-20 flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:px-6">
      <MobileShell
        tenant={tenant}
        role={role}
        features={features}
        isPlatformAdmin={isPlatformAdmin}
        accounting={accounting}
      />

      <SidebarToggle />

      <div className="flex min-w-0 flex-1 items-center">
        <CommandPalette
          tenantSlug={tenant.slug}
          role={role}
          features={features}
          isPlatformAdmin={isPlatformAdmin}
          accounting={accounting}
        />
      </div>

      <UserMenu
        email={email}
        roleLabel={ROLE_LABELS[role]}
        tenantName={tenant.name}
        docsHref={role === 'owner' ? `/${tenant.slug}/docs` : undefined}
      />
    </header>
  )
}
