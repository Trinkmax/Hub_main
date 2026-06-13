'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { computeActiveHrefs } from './nav-active'
import type { ResolvedNavGroup, ResolvedNavItem } from './nav-config'
import { NAV_ICONS } from './nav-icons'

export function SidebarNav({
  groups,
  onNavigate,
}: {
  groups: ResolvedNavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  // `useSearchParams` para que los hijos por `?segment=` desempaten bien y no
  // queden dos seleccionados a la vez. El subtree se monta en rutas dynamic.
  const search = useSearchParams().toString()
  const activeHrefs = useMemo(
    () => computeActiveHrefs(pathname, search, groups),
    [pathname, search, groups],
  )

  return (
    <nav className="flex flex-1 flex-col gap-5 px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            {group.label}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) =>
              item.children?.length ? (
                <SidebarParent
                  key={item.label}
                  item={item}
                  activeHrefs={activeHrefs}
                  onNavigate={onNavigate}
                />
              ) : (
                <li key={item.label}>
                  <SidebarLink
                    item={item}
                    active={!item.newTab && activeHrefs.has(item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SidebarParent({
  item,
  activeHrefs,
  onNavigate,
}: {
  item: ResolvedNavItem
  activeHrefs: Set<string>
  onNavigate?: () => void
}) {
  const children = item.children ?? []
  const childActive = children.some((c) => activeHrefs.has(c.href))
  const selfActive = !item.newTab && activeHrefs.has(item.href)
  const [open, setOpen] = useState(selfActive || childActive)
  const Icon = NAV_ICONS[item.iconKey]

  return (
    <li>
      {item.expanderOnly ? (
        // Padre puro-agrupador: clickearlo SÓLO expande (no navega).
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            'group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-[colors,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
            childActive && !open
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
          )}
        >
          <Icon
            className={cn(
              'size-4 transition-colors',
              childActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
            )}
            aria-hidden
          />
          <span className="flex-1 truncate text-left">{item.label}</span>
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-[var(--duration-fast)]',
              open && 'rotate-90',
            )}
            aria-hidden
          />
        </button>
      ) : (
        <div className="flex items-center">
          <SidebarLink
            item={{ ...item, children: undefined }}
            active={selfActive && !childActive}
            onNavigate={onNavigate}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? `Contraer ${item.label}` : `Expandir ${item.label}`}
            aria-expanded={open}
            className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[--cream-tint] hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                'size-3.5 transition-transform duration-[var(--duration-fast)]',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          </button>
        </div>
      )}
      {open ? (
        <ul className="mt-0.5 space-y-0.5 border-l border-border/50 pl-3 ml-3.5">
          {children.map((child) => (
            <li key={child.label}>
              <SidebarLink
                item={child}
                active={!child.newTab && activeHrefs.has(child.href)}
                onNavigate={onNavigate}
                compact
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function SidebarLink({
  item,
  active,
  onNavigate,
  className,
  compact,
}: {
  item: ResolvedNavItem
  active: boolean
  onNavigate?: () => void
  className?: string
  compact?: boolean
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
        className={cn(
          'group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[--cream-tint] hover:text-foreground',
          className,
        )}
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
        'group relative flex items-center gap-2.5 rounded-md px-2.5 text-sm font-medium',
        compact ? 'h-8' : 'h-9',
        'transition-[colors,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
        className,
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
