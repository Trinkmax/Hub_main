import { CommandPalette } from '@/components/command-palette/command-palette'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { createClient } from '@/lib/supabase/server'
import { getMembershipsForUser } from '@/lib/tenant'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { MobileShell } from './mobile-shell'
import { TenantSwitcherChip } from './tenant-switcher-chip'
import { UserMenu } from './user-menu'

export async function Topbar({
  tenant,
  role,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
}) {
  const memberships = await getMembershipsForUser()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? ''

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 sm:px-6">
      <MobileShell tenant={tenant} role={role} memberships={memberships} />

      <div className="hidden flex-1 items-center md:flex">
        <CommandPalette tenantSlug={tenant.slug} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <TenantSwitcherChip current={tenant} memberships={memberships} />
        <ThemeToggle />
        <UserMenu email={email} role={role} />
      </div>
    </header>
  )
}
