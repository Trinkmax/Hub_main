'use client'

import { Gift, type LucideIcon, MessageCircle, Palette, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type SubItem = {
  label: string
  href: (slug: string) => string
}

type Group = {
  label: string
  icon: LucideIcon
  items: SubItem[]
}

const GROUPS: Group[] = [
  {
    label: 'Equipo',
    icon: UsersRound,
    items: [{ label: 'Miembros', href: (s) => `/${s}/configuracion/equipo` }],
  },
  {
    label: 'Fidelización',
    icon: Gift,
    items: [
      { label: 'Regalo de bienvenida', href: (s) => `/${s}/configuracion/bienvenida` },
      { label: 'Reseñas', href: (s) => `/${s}/configuracion/resenas` },
    ],
  },
  {
    label: 'Mensajería',
    icon: MessageCircle,
    items: [
      { label: 'Canales (WA · IG)', href: (s) => `/${s}/configuracion/canales` },
      { label: 'Plantillas WhatsApp', href: (s) => `/${s}/configuracion/templates` },
      { label: 'Tags de carta', href: (s) => `/${s}/configuracion/tags` },
    ],
  },
  {
    label: 'Apariencia',
    icon: Palette,
    items: [{ label: 'General', href: (s) => `/${s}/configuracion/apariencia` }],
  },
]

export function SettingsNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname()

  return (
    <nav className="space-y-5">
      {GROUPS.map((group) => {
        const Icon = group.icon
        return (
          <div key={group.label} className="space-y-1.5">
            <div className="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              <Icon className="size-3" aria-hidden />
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const href = item.href(tenantSlug)
                const active = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <li key={item.label}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                        active
                          ? 'bg-secondary font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
