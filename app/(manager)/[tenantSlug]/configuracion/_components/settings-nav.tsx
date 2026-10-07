'use client'

import { Armchair, type LucideIcon, Palette, Star, UsersRound } from 'lucide-react'
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

// Reseñas y Comisiones existían pero no estaban linkeadas en ningún lado: el
// único acceso era el botón "Configurar" de /reviews. El dueño nunca encontró
// la pantalla donde se carga el enlace de Google (por eso las 5★ no derivaban).
const GROUPS: Group[] = [
  {
    label: 'Equipo',
    icon: UsersRound,
    items: [
      { label: 'Miembros', href: (s) => `/${s}/configuracion/equipo` },
      { label: 'Comisiones', href: (s) => `/${s}/configuracion/comisiones` },
    ],
  },
  {
    // Capacidad del salón existía desde el arranque pero nadie la linkeó: la
    // única forma de llegar era escribir la URL. Ahora vive con Tortas, que es
    // lo otro que define cómo se toma una reserva.
    label: 'Salón',
    icon: Armchair,
    items: [
      { label: 'Capacidad', href: (s) => `/${s}/configuracion/salon` },
      { label: 'Tortas de cumpleaños', href: (s) => `/${s}/configuracion/tortas` },
    ],
  },
  {
    label: 'Reseñas',
    icon: Star,
    items: [{ label: 'Google y WhatsApp', href: (s) => `/${s}/configuracion/resenas` }],
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
                          : 'text-muted-foreground hover:bg-(--cream-tint) hover:text-foreground',
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
