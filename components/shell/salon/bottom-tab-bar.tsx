'use client'

import { ChefHat, ClipboardList, Inbox, type LucideIcon, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'

type Tab = {
  label: string
  icon: LucideIcon
  href: (slug: string) => string
  match: (pathname: string, slug: string) => boolean
  roles?: TenantRole[]
}

const TABS: Tab[] = [
  {
    label: 'Mesas',
    icon: ClipboardList,
    href: (s) => `/${s}/salon/mesas`,
    match: (p, s) =>
      p === `/${s}/salon` || p === `/${s}/salon/mesas` || p.startsWith(`/${s}/salon/mesas/`),
  },
  {
    label: 'Cocina',
    icon: ChefHat,
    href: (s) => `/${s}/salon/cocina`,
    match: (p, s) => p.startsWith(`/${s}/salon/cocina`),
    roles: ['owner', 'cashier', 'kitchen'],
  },
  {
    label: 'Bandeja',
    icon: Inbox,
    href: (s) => `/${s}/salon/bandeja`,
    match: (p, s) => p.startsWith(`/${s}/salon/bandeja`),
  },
  {
    label: 'Mi turno',
    icon: User,
    href: (s) => `/${s}/salon/mi-turno`,
    match: (p, s) => p.startsWith(`/${s}/salon/mi-turno`),
  },
]

export function BottomTabBar({ tenantSlug, role }: { tenantSlug: string; role: TenantRole }) {
  const pathname = usePathname()
  const visibleTabs = TABS.filter((tab) => !tab.roles || tab.roles.includes(role))

  return (
    <nav
      aria-label="Navegación salón"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/65"
    >
      <ul
        className="mx-auto grid max-w-screen-md text-xs"
        style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
      >
        {visibleTabs.map((tab) => {
          const href = tab.href(tenantSlug)
          const active = tab.match(pathname, tenantSlug)
          const Icon = tab.icon

          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 px-2 py-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-colors',
                    active ? 'bg-[--cream-tint]' : 'bg-transparent',
                  )}
                >
                  <Icon
                    className={cn('size-5 transition-transform', active && 'scale-110')}
                    aria-hidden
                    strokeWidth={active ? 2.5 : 2}
                  />
                </span>
                <span className={cn('text-[11px]', active && 'font-semibold')}>{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
