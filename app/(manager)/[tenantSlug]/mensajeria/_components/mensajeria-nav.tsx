'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type MessagingNavGroup, visibleMessagingNav } from '@/components/shell/messaging-nav'
import { NAV_ICONS } from '@/components/shell/nav-icons'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'

export function MensajeriaNav({ tenantSlug, role }: { tenantSlug: string; role: TenantRole }) {
  const pathname = usePathname()
  const groups: MessagingNavGroup[] = visibleMessagingNav(role)

  return (
    <nav className="w-60 space-y-5">
      {groups.map((group, gi) => (
        <div key={group.label ?? `hero-${gi}`} className="space-y-1.5">
          {group.label ? (
            <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              {group.label}
            </div>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const href = `/${tenantSlug}/mensajeria/${item.segment}`
              const active = pathname === href || pathname.startsWith(`${href}/`)
              const Icon = NAV_ICONS[item.icon]
              return (
                <li key={item.segment}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                      active
                        ? 'bg-secondary font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
