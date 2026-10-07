'use client'

import { Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { MAIN_ITEMS, SETTINGS_ITEMS, visibleFor } from './wa-rail'

/**
 * Tabs de secciones abajo (solo mobile), como WhatsApp en el teléfono.
 * Dentro de un chat abierto se ocultan para dejar el composer al fondo.
 */
export function WaBottomTabs({
  tenantSlug,
  role,
  unreadTotal,
}: {
  tenantSlug: string
  role: TenantRole
  unreadTotal: number
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Con un chat abierto el composer va al fondo, como WhatsApp
  const inChat = pathname.endsWith('/mensajeria/inbox') && searchParams.has('c')
  if (inChat) return null

  const main = visibleFor(MAIN_ITEMS, role)
  const settings = visibleFor(SETTINGS_ITEMS, role)
  const settingsActive = settings.some((item) =>
    pathname.startsWith(`/${tenantSlug}/mensajeria/${item.segment}`),
  )

  return (
    <nav
      aria-label="Secciones de mensajería"
      className="flex shrink-0 items-stretch justify-around border-t border-(--wa-border) bg-(--wa-panel) pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {main.map((item) => {
        const href = `/${tenantSlug}/mensajeria/${item.segment}`
        const active = pathname === href || pathname.startsWith(`${href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              active ? 'text-(--wa-accent-deep)' : 'text-(--wa-muted)',
            )}
          >
            <span
              className={cn(
                'relative flex h-7 w-12 items-center justify-center rounded-full',
                active && 'bg-(--wa-accent-soft)',
              )}
            >
              <Icon className="size-[20px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
              {item.segment === 'inbox' && unreadTotal > 0 ? (
                <span className="absolute -top-0.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--wa-unread) px-1 text-[9px] font-bold tabular-nums text-white">
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">
              {item.segment === 'flows' ? 'Automático' : item.label}
            </span>
          </Link>
        )
      })}

      {settings.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Ajustes de mensajería"
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors focus-visible:outline-none',
              settingsActive ? 'text-(--wa-accent-deep)' : 'text-(--wa-muted)',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-12 items-center justify-center rounded-full',
                settingsActive && 'bg-(--wa-accent-soft)',
              )}
            >
              <Settings
                className="size-[20px]"
                strokeWidth={settingsActive ? 2.2 : 1.8}
                aria-hidden
              />
            </span>
            <span className="max-w-full truncate">Ajustes</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-56">
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
