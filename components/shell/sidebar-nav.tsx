'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ResolvedNavGroup, ResolvedNavItem } from './nav-config'
import { NAV_ICONS } from './nav-icons'

function matches(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href
  if (pathname === href) return true
  return pathname.startsWith(`${href}/`)
}

/**
 * Sólo el item con el `href` más largo (= más específico) gana cuando varios
 * matchean. Evita que `/estadisticas/comisiones` active además a `Estadísticas`
 * cuyo href `/estadisticas` también es prefix válido.
 */
function computeActiveHrefs(pathname: string, groups: ResolvedNavGroup[]): Set<string> {
  let maxLen = 0
  for (const g of groups) {
    for (const item of g.items) {
      if (item.newTab) continue
      if (matches(pathname, item.href, item.exact) && item.href.length > maxLen) {
        maxLen = item.href.length
      }
    }
  }
  const active = new Set<string>()
  if (maxLen === 0) return active
  for (const g of groups) {
    for (const item of g.items) {
      if (item.newTab) continue
      if (matches(pathname, item.href, item.exact) && item.href.length === maxLen) {
        active.add(item.href)
      }
    }
  }
  return active
}

export function SidebarNav({
  groups,
  onNavigate,
}: {
  groups: ResolvedNavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const activeHrefs = useMemo(() => computeActiveHrefs(pathname, groups), [pathname, groups])

  return (
    <nav className="flex flex-1 flex-col gap-5 px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            {group.label}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.label}>
                <SidebarLink
                  item={item}
                  active={!item.newTab && activeHrefs.has(item.href)}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: ResolvedNavItem
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = NAV_ICONS[item.iconKey]
  const ArrowOut = NAV_ICONS.ArrowUpRight

  if (item.newTab) {
    return (
      <Link
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className="group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[--cream-tint] hover:text-foreground"
      >
        <Icon className="size-4 transition-colors group-hover:text-primary" aria-hidden />
        <span className="truncate">{item.label}</span>
        <ArrowOut
          className="ml-auto size-3.5 text-muted-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
          aria-hidden
        />
      </Link>
    )
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium',
        'transition-[colors,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
      )}
    >
      {active ? (
        <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
      ) : null}
      <Icon
        className={cn(
          'size-4 transition-colors',
          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
        )}
        aria-hidden
      />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
