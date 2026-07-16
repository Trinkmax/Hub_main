import { CommandPalette } from '@/components/command-palette/command-palette'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import type { TenantFeatures } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import { getMembershipsForUser } from '@/lib/tenant'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { MobileShell } from './mobile-shell'
import { TenantSwitcherChip } from './tenant-switcher-chip'
import { UserMenu } from './user-menu'

export async function Topbar({
  tenant,
  role,
  features,
  isPlatformAdmin,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
}) {
  const memberships = await getMembershipsForUser()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? ''

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 sm:px-6">
      <MobileShell
        tenant={tenant}
        role={role}
        memberships={memberships}
        features={features}
        isPlatformAdmin={isPlatformAdmin}
      />

      <div className="hidden flex-1 items-center md:flex">
        <CommandPalette
          tenantSlug={tenant.slug}
          role={role}
          features={features}
          isPlatformAdmin={isPlatformAdmin}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <TenantSwitcherChip current={tenant} memberships={memberships} />
        <ThemeToggle />
        <UserMenu email={email} role={ROLE_LABELS[role]} />
      </div>
    </header>
  )
}
