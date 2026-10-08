'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { computeActiveHrefs } from './nav-active'
import type { ResolvedNavGroup, ResolvedNavItem } from './nav-config'
import { NAV_ICONS } from './nav-icons'

/**
 * El menú del panel: UNA entrada por sección, siempre a la vista — sin
 * desplegables ni sub-ítems (las partes de cada sección son pestañas arriba
 * de la página). Los bloques se separan sólo por aire; su nombre queda para
 * los lectores de pantalla.
 *
 * Un solo `<nav>` con dos zonas: la lista (scrollea si no entra) y lo anclado
 * al fondo (Configuración). El resaltado se calcula una vez sobre las dos, así
 * nunca quedan dos entradas activas.
 */
export function SidebarNav({
  groups,
  onNavigate,
}: {
  groups: ResolvedNavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  // Hoy ninguna entrada pide query (las partes de cada sección son pestañas),
  // pero el matcher la soporta para un `href`/`activePaths` con `?…`. El
  // subtree se monta en rutas dynamic y arriba hay un Suspense.
  const search = useSearchParams().toString()
  const activeHrefs = useMemo(
    () => computeActiveHrefs(pathname, search, groups),
    [pathname, search, groups],
  )
  const mainGroups = groups.filter((g) => !g.pinned)
  const pinnedGroups = groups.filter((g) => g.pinned)

  return (
    <nav aria-label="Menú principal" className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <NavClusters
          groups={mainGroups}
          activeHrefs={activeHrefs}
          onNavigate={onNavigate}
          className="py-4"
        />
      </div>
      {pinnedGroups.length > 0 ? (
        <div className="border-t border-border/60">
          <NavClusters
            groups={pinnedGroups}
            activeHrefs={activeHrefs}
            onNavigate={onNavigate}
            className="py-2"
          />
        </div>
      ) : null}
    </nav>
  )
}

function NavClusters({
  groups,
  activeHrefs,
  onNavigate,
  className,
}: {
  groups: ResolvedNavGroup[]
  activeHrefs: Set<string>
  onNavigate?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4 px-3', className)}>
      {groups.map((group) => (
        // Sin título visible: el nombre del bloque es para lectores («Hoy, lista, 3 elementos»).
        <ul key={group.label} aria-label={group.label} className="space-y-0.5">
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
      ))}
    </div>
  )
}

/** Alto de la fila: 44 px en el menú del celular (se toca con el dedo), 36 px en desktop. */
const ROW_HEIGHT = 'h-11 lg:h-9'
/** Foco de teclado visible (mismo anillo que las pestañas de sección). */
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-ring'

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
        className={cn(
          'group relative flex items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-(--cream-tint) hover:text-foreground',
          ROW_HEIGHT,
          FOCUS_RING,
        )}
      >
        <Icon className="size-4 transition-colors group-hover:text-primary" aria-hidden />
        <span className="truncate">{item.label}</span>
        <span className="sr-only"> (se abre en otra pestaña)</span>
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
        ROW_HEIGHT,
        'transition-[colors,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        FOCUS_RING,
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-(--cream-tint) hover:text-foreground',
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
