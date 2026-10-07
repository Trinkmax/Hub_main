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
import { MAIN_ITEMS, SETTINGS_ITEMS, UnreadBadge, unreadLabel, visibleFor } from './wa-rail'

/**
 * Tabs de secciones abajo (solo mobile), como WhatsApp en el teléfono.
 * Dentro de un chat abierto se ocultan para dejar el composer al fondo.
 *
 * Piso de 12 px del kit: las etiquetas pasaron de 10 a 12 px y la cuenta de
 * sin leer de 9 a 12 (con su pastilla más grande). Para que entren cinco
 * tabs en 360 px, la etiqueta es corta («Automático») y se recorta si no entra.
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
        const showUnread = item.segment === 'inbox' && unreadTotal > 0
        return (
          <Link
            key={item.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(tabClass, active ? 'text-(--wa-accent-deep)' : 'text-(--wa-muted)')}
          >
            <span
              className={cn(
                'relative flex h-7 w-12 items-center justify-center rounded-full',
                active && 'bg-(--wa-accent-soft)',
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
              {showUnread ? (
                <UnreadBadge
                  count={unreadTotal}
                  className="absolute -top-1.5 -right-0.5 ring-2 ring-(--wa-panel)"
                />
              ) : null}
            </span>
            <span className="max-w-full truncate">
              {item.segment === 'flows' ? 'Automático' : item.label}
            </span>
            {showUnread ? <span className="sr-only">, {unreadLabel(unreadTotal)}</span> : null}
          </Link>
        )
      })}

      {settings.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Ajustes de mensajería"
            className={cn(
              tabClass,
              settingsActive ? 'text-(--wa-accent-deep)' : 'text-(--wa-muted)',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-12 items-center justify-center rounded-full',
                settingsActive && 'bg-(--wa-accent-soft)',
              )}
            >
              <Settings className="size-5" strokeWidth={settingsActive ? 2.2 : 1.8} aria-hidden />
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

// Cada tab: toda la columna es el objetivo (más de 44 px de alto). El foco va
// «adentro» (las tabs están pegadas entre sí) y es contorno, no sombra.
const tabClass =
  'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2 type-caption font-medium transition-colors outline-(--ring) -outline-offset-2 focus-visible:outline-2'
