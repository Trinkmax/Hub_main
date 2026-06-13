'use client'

import { Gift, type LucideIcon, Sparkles, Stamp, Star, Trophy } from 'lucide-react'
// Iconos alineados con los hijos de "Club de beneficios" en el sidebar (nav-config).
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type Tab = {
  label: string
  icon: LucideIcon
  href: (slug: string) => string
  /** Match exacto: el Resumen (raíz del club) no debe quedar activo en sub-rutas. */
  exact?: boolean
}

const TABS: Tab[] = [
  { label: 'Resumen', icon: Trophy, href: (s) => `/${s}/club`, exact: true },
  { label: 'Niveles', icon: Sparkles, href: (s) => `/${s}/club/niveles` },
  { label: 'Puntos y recompensas', icon: Gift, href: (s) => `/${s}/club/puntos` },
  { label: 'Punch cards', icon: Stamp, href: (s) => `/${s}/club/punch-cards` },
  { label: 'Bienvenida', icon: Star, href: (s) => `/${s}/club/bienvenida` },
]

export function ClubNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Secciones del club"
      className="-mx-1 flex items-center gap-1 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const href = tab.href(tenantSlug)
        const active = tab.exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`)
        const Icon = tab.icon
        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
              active
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'size-4 transition-colors',
                active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
              )}
              aria-hidden
            />
            <span className="whitespace-nowrap">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
