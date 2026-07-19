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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'

type RailItem = {
  segment: string
  label: string
  icon: typeof MessageCircle
  roles?: TenantRole[]
}

/** Iconos principales del rail, estilo WhatsApp: Chats arriba de todo. */
const MAIN_ITEMS: RailItem[] = [
  { segment: 'inbox', label: 'Chats', icon: MessageCircle },
  { segment: 'difusiones', label: 'Difusiones', icon: Megaphone, roles: ['owner'] },
  { segment: 'flows', label: 'Automatizaciones', icon: Workflow, roles: ['owner'] },
  { segment: 'audiencias', label: 'Audiencias', icon: UsersRound, roles: ['owner'] },
]

/** Ajustes de mensajería que viven en el engranaje de abajo. */
const SETTINGS_ITEMS: RailItem[] = [
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

function visibleFor(items: RailItem[], role: TenantRole): RailItem[] {
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

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Secciones de mensajería"
        className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-(--wa-border) bg-(--wa-rail) py-3"
      >
        {main.map((item) => {
          const href = `/${tenantSlug}/mensajeria/${item.segment}`
          const active =
            pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`)
          const Icon = item.icon
          return (
            <Tooltip key={item.segment} delayDuration={300}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex size-11 items-center justify-center rounded-xl transition-colors duration-[var(--duration-fast)]',
                    active
                      ? 'bg-(--wa-rail-active) text-(--wa-text)'
                      : 'text-(--wa-rail-icon) hover:bg-(--wa-hover) hover:text-(--wa-text)',
                  )}
                >
                  <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  {item.segment === 'inbox' && unreadTotal > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-(--wa-unread) px-1 text-[10px] font-bold tabular-nums text-white">
                      {unreadTotal > 99 ? '99+' : unreadTotal}
                    </span>
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
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger
                  aria-label="Ajustes de mensajería"
                  className={cn(
                    'flex size-11 items-center justify-center rounded-xl transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)',
                    settingsActive
                      ? 'bg-(--wa-rail-active) text-(--wa-text)'
                      : 'text-(--wa-rail-icon) hover:bg-(--wa-hover) hover:text-(--wa-text)',
                  )}
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
    </TooltipProvider>
  )
}
