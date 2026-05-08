'use client'

import { Check, ChevronsUpDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setActiveTenant } from '@/lib/tenant/actions'
import type { MembershipWithTenant, Tenant } from '@/lib/tenant/types'

/**
 * Chip compacto de tenant para mostrar en el topbar (no en sidebar).
 * Si el usuario tiene un solo bar, muestra avatar + nombre sin dropdown.
 * Si tiene varios, abre dropdown para cambiar.
 */
export function TenantSwitcherChip({
  current,
  memberships,
}: {
  current: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  memberships: MembershipWithTenant[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleSelect = (tenantId: string, slug: string) => {
    if (tenantId === current.id) return
    startTransition(async () => {
      const result = await setActiveTenant(tenantId)
      if (!result.ok) {
        toast.error('No pudimos cambiar de bar.')
        return
      }
      router.push(`/${slug}`)
      router.refresh()
    })
  }

  if (memberships.length <= 1) {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 sm:flex">
        <Avatar className="size-5">
          {current.logo_url ? <AvatarImage src={current.logo_url} alt={current.name} /> : null}
          <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
            {current.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="max-w-[160px] truncate text-xs font-medium text-foreground">
          {current.name}
        </span>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          className="hidden h-9 gap-2 rounded-full border-border/60 bg-card/60 pl-1.5 pr-2.5 sm:inline-flex"
          aria-label="Cambiar de bar"
        >
          <Avatar className="size-6">
            {current.logo_url ? <AvatarImage src={current.logo_url} alt={current.name} /> : null}
            <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
              {current.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[140px] truncate text-xs font-medium">{current.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tus bares
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map(({ tenant, role }) => (
          <DropdownMenuItem
            key={tenant.id}
            onSelect={() => handleSelect(tenant.id, tenant.slug)}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="size-6">
                {tenant.logo_url ? <AvatarImage src={tenant.logo_url} alt={tenant.name} /> : null}
                <AvatarFallback className="text-[10px] font-semibold">
                  {tenant.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm leading-tight">{tenant.name}</p>
                <p className="truncate text-[10px] capitalize leading-tight text-muted-foreground">
                  {role}
                </p>
              </div>
            </div>
            {tenant.id === current.id ? (
              <Check className="size-4 shrink-0 text-primary" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
