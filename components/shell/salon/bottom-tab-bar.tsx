'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { TenantFeatures } from '@/lib/platform/features'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { visibleSalonTabs } from './salon-nav'

/**
 * Nav inferior del salón. Los tabs salen de `salon-nav.ts` (fuente única, la
 * comparte con el topbar).
 *
 * La barra declara su propio alto en `--salon-tabbar-h` y el shell lo usa como
 * padding del `<main>`: antes el shell hardcodeaba `pb-24` (96px) contra una
 * barra que mide ~68px + safe-area, y cada pantalla que quiso calcular altos
 * inventó su propio número. Ese desfasaje era la mitad de los "scrolls raros".
 */
export function BottomTabBar({
  tenantSlug,
  role,
  features,
  isPlatformAdmin,
}: {
  tenantSlug: string
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
}) {
  const pathname = usePathname()
  const tabs = visibleSalonTabs({ role, features, isPlatformAdmin })
  if (tabs.length === 0) return null

  return (
    <nav
      aria-label="Navegación salón"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75"
    >
      <ul
        className="mx-auto grid max-w-screen-md"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const active = tab.match(pathname, tenantSlug)
          const Icon = tab.icon

          return (
            <li key={tab.key}>
              <Link
                href={tab.href(tenantSlug)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[4.25rem] flex-col items-center justify-center gap-1 px-1 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                  active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-[var(--duration-base)]',
                    active ? 'bg-primary/12' : 'bg-transparent',
                  )}
                >
                  <Icon
                    className={cn('size-5 transition-transform', active && 'scale-110')}
                    aria-hidden
                    strokeWidth={active ? 2.4 : 1.9}
                  />
                </span>
                <span
                  className={cn(
                    'max-w-full truncate text-[11px] leading-none',
                    active ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
