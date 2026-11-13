'use client'

import { Ellipsis } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { TenantFeatures } from '@/lib/platform/features'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { BARE, NO_TABBAR } from './salon-main'
import { type SalonTab, splitSalonTabs, visibleSalonTabs } from './salon-nav'

/**
 * Nav inferior del salón. Los tabs salen de `salon-nav.ts` (fuente única, la
 * comparte con el topbar).
 *
 * La barra declara su propio alto en `--salon-tabbar-h` y el shell lo usa como
 * padding del `<main>`: antes el shell hardcodeaba `pb-24` (96px) contra una
 * barra que mide ~68px + safe-area, y cada pantalla que quiso calcular altos
 * inventó su propio número. Ese desfasaje era la mitad de los "scrolls raros".
 *
 * Entran cinco pestañas. Si a alguien le tocan más (el dueño con el punto de
 * venta las tiene todas), la quinta es «Más» y abre el resto en una hoja: antes
 * se apretaban y «Sumar puntos» quedaba en «Sumar p…».
 */
export function BottomTabBar({
  tenantSlug,
  role,
  features,
  isPlatformAdmin,
}: {
  tenantSlug: string
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
}) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const tabs = visibleSalonTabs({ role, features, isPlatformAdmin })
  if (tabs.length === 0 || BARE.test(pathname) || NO_TABBAR.test(pathname)) return null

  const { bar, more } = splitSalonTabs(tabs)
  // Una sola pestaña activa: la primera que reconoce la ruta, esté en la barra o detrás de «Más».
  const activeKey = tabs.find((tab) => tab.match(pathname, tenantSlug))?.key ?? null
  const activeInMore = more.find((tab) => tab.key === activeKey) ?? null

  return (
    <nav
      aria-label="Navegación salón"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75"
    >
      <ul
        className="mx-auto grid max-w-screen-md"
        style={{
          gridTemplateColumns: `repeat(${bar.length + (more.length > 0 ? 1 : 0)}, minmax(0, 1fr))`,
        }}
      >
        {bar.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href(tenantSlug)}
              aria-current={tab.key === activeKey ? 'page' : undefined}
              className={slotClass(tab.key === activeKey)}
            >
              <TabFace icon={tab.icon} label={tab.label} active={tab.key === activeKey} />
            </Link>
          </li>
        ))}

        {more.length > 0 ? (
          <li>
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className={cn(slotClass(activeInMore !== null), 'w-full')}
                  aria-label={
                    activeInMore ? `Más pantallas. Estás en ${activeInMore.title}` : 'Más pantallas'
                  }
                >
                  <TabFace icon={Ellipsis} label="Más" active={activeInMore !== null} />
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="gap-0 pb-[env(safe-area-inset-bottom)]">
                <SheetHeader className="text-left">
                  <SheetTitle>Más pantallas</SheetTitle>
                  <SheetDescription className="sr-only">
                    El resto de las pantallas del salón.
                  </SheetDescription>
                </SheetHeader>
                <ul className="grid gap-1 px-3 pb-4">
                  {more.map((tab) => (
                    <li key={tab.key}>
                      <MoreRow
                        tab={tab}
                        href={tab.href(tenantSlug)}
                        active={tab.key === activeKey}
                        onGo={() => setMoreOpen(false)}
                      />
                    </li>
                  ))}
                </ul>
              </SheetContent>
            </Sheet>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}

function slotClass(active: boolean) {
  return cn(
    'flex h-[4.25rem] flex-col items-center justify-center gap-1 px-1 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
  )
}

function TabFace({
  icon: Icon,
  label,
  active,
}: {
  icon: SalonTab['icon']
  label: string
  active: boolean
}) {
  return (
    <>
      <span
        className={cn(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-[var(--duration-base)]',
          active ? 'bg-primary/12' : 'bg-transparent',
        )}
      >
        <Icon
          className={cn('size-5 transition-transform', active && 'scale-110')}
          aria-hidden
          strokeWidth={active ? 2.4 : 1.9}
        />
      </span>
      <span
        className={cn(
          'max-w-full truncate text-[11px] leading-none',
          active ? 'font-semibold' : 'font-medium',
        )}
      >
        {label}
      </span>
    </>
  )
}

/** Una fila de la hoja «Más»: alta, para el dedo, con el nombre entero de la pantalla. */
function MoreRow({
  tab,
  href,
  active,
  onGo,
}: {
  tab: SalonTab
  href: string
  active: boolean
  onGo: () => void
}) {
  const Icon = tab.icon
  return (
    <Link
      href={href}
      onClick={onGo}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-xl px-3 text-base transition-colors duration-[var(--duration-fast)]',
        active
          ? 'bg-primary/10 font-semibold text-primary'
          : 'font-medium text-foreground active:bg-secondary',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          active ? 'bg-primary/12' : 'bg-secondary',
        )}
      >
        <Icon className="size-5" aria-hidden strokeWidth={active ? 2.4 : 1.9} />
      </span>
      {tab.title}
    </Link>
  )
}
