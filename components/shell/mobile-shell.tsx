'use client'

import { Menu } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { TenantFeatures } from '@/lib/platform/features'
import type { MembershipWithTenant, Tenant, TenantRole } from '@/lib/tenant/types'
import { SidebarContent } from './sidebar-content'

export function MobileShell({
  tenant,
  role,
  features,
  isPlatformAdmin,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  memberships: MembershipWithTenant[]
  features: TenantFeatures
  isPlatformAdmin: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[280px] flex-col gap-0 bg-surface p-0 sm:max-w-[280px]"
      >
        <SheetTitle className="sr-only">Navegación</SheetTitle>
        <SidebarContent
          tenant={tenant}
          role={role}
          features={features}
          isPlatformAdmin={isPlatformAdmin}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
