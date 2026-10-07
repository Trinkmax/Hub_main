'use client'

import {
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Radio,
  Settings,
  Tag,
  UsersRound,
  Workflow,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'

export type RailItem = {
  segment: string
  label: string
  icon: typeof MessageCircle
  roles?: TenantRole[]
}

/** Iconos principales del rail, estilo WhatsApp: Chats arriba de todo. */
export const MAIN_ITEMS: RailItem[] = [
  { segment: 'inbox', label: 'Chats', icon: MessageCircle },
  { segment: 'difusiones', label: 'Difusiones', icon: Megaphone, roles: ['owner'] },
  { segment: 'flows', label: 'Automatizaciones', icon: Workflow, roles: ['owner'] },
  { segment: 'audiencias', label: 'Audiencias', icon: UsersRound, roles: ['owner'] },
]

/** Ajustes de mensajería que viven en el engranaje de abajo. */
export const SETTINGS_ITEMS: RailItem[] = [
  { segment: 'canales', label: 'Canales conectados', icon: Radio, roles: ['owner'] },
  { segment: 'plantillas', label: 'Plantillas', icon: MessageSquareText, roles: ['owner'] },
  {
    segment: 'mensajes-rapidos',
    label: 'Mensajes rápidos',
    icon: Zap,
    roles: ['owner', 'cashier'],
  },
  { segment: 'etiquetas', label: 'Etiquetas', icon: Tag, roles: ['owner', 'cashier'] },
]

export function visibleFor(items: RailItem[], role: TenantRole): RailItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role))
}

export function WaRail({
  tenantSlug,
  role,
  unreadTotal,
}: {
  tenantSlug: string
  role: TenantRole
  unreadTotal: number
}) {
  const pathname = usePathname()
  const main = visibleFor(MAIN_ITEMS, role)
  const settings = visibleFor(SETTINGS_ITEMS, role)
  const settingsActive = settings.some((item) =>
    pathname.startsWith(`/${tenantSlug}/mensajeria/${item.segment}`),
  )

  // El TooltipProvider lo monta el shell del panel una sola vez (400 ms el
  // primero, los siguientes al toque): acá no va otro.
  return (
    <nav
      aria-label="Secciones de mensajería"
      className="hidden w-16 shrink-0 flex-col items-center gap-1.5 border-r border-(--wa-border) bg-(--wa-rail) py-3 md:flex"
    >
      {main.map((item) => {
        const href = `/${tenantSlug}/mensajeria/${item.segment}`
        const active =
          pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`)
        const Icon = item.icon
        return (
          <Tooltip key={item.segment}>
            <TooltipTrigger asChild>
              <Link
                href={href}
                aria-label={
                  item.segment === 'inbox' && unreadTotal > 0
                    ? `${item.label}, ${unreadLabel(unreadTotal)}`
                    : item.label
                }
                aria-current={active ? 'page' : undefined}
                className={cn(railItemClass, active ? railActiveClass : railIdleClass)}
              >
                <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                {item.segment === 'inbox' && unreadTotal > 0 ? (
                  <UnreadBadge
                    count={unreadTotal}
                    className="absolute -top-1 -right-1 ring-2 ring-(--wa-rail)"
                  />
                ) : null}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}

      <div className="flex-1" />

      {settings.length > 0 ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label="Ajustes de mensajería"
                className={cn(railItemClass, settingsActive ? railActiveClass : railIdleClass)}
              >
                <Settings className="size-[22px]" strokeWidth={1.8} aria-hidden />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Ajustes</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuLabel>Ajustes de mensajería</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {settings.map((item) => {
              const Icon = item.icon
              return (
                <DropdownMenuItem key={item.segment} asChild>
                  <Link href={`/${tenantSlug}/mensajeria/${item.segment}`}>
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  )
}

// Ítems del rail: 44 px, como el objetivo táctil del kit. El foco es el del
// panel (contorno de 2 px, regla base de globals.css), nunca un anillo de sombra.
const railItemClass =
  'relative flex size-11 items-center justify-center rounded-xl transition-colors duration-(--duration-quick)'
const railActiveClass = 'bg-(--wa-rail-active) text-(--wa-text)'
const railIdleClass = 'text-(--wa-rail-icon) hover:bg-(--wa-hover) hover:text-(--wa-text)'

/** «3 chats sin leer», para el nombre accesible (el número solo no dice qué es). */
export function unreadLabel(count: number): string {
  return count === 1 ? '1 chat sin leer' : `${count > 99 ? 'más de 99' : count} chats sin leer`
}

/**
 * Cuenta de sin leer: 12 px como mínimo (piso del kit). Verde profundo con el
 * texto del panel: el verde claro con blanco de antes daba 3,0:1 en claro y
 * 2,4:1 en oscuro; este par da 4,8 y 7,5.
 */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 min-w-5 items-center justify-center rounded-full bg-(--wa-accent-deep) px-1 type-caption font-bold tabular-nums text-(--wa-panel)',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
