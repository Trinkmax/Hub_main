'use client'

import { CircleEllipsis } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import { type DockItem, LiquidDock } from '@/components/shell/dock/liquid-dock'
import { AppSheet } from '@/components/shell/mobile/app-sheet'
import type { TenantFeatures } from '@/lib/platform/features'
import type { TenantRole } from '@/lib/tenant/types'
import { BARE, NO_TABBAR } from './salon-main'
import { type SalonTab, splitSalonTabs, visibleSalonTabs } from './salon-nav'

/** La clave de «Más» en la barra del salón. */
const MORE = 'more'

/**
 * La barra de abajo del salón: la misma de vidrio líquido que el panel (components/shell/dock), con las
 * pestañas de `salon-nav.ts` (fuente única, la comparte con el topbar).
 *
 * Lo que ocupa abajo (la barra flotando más su aire) es `--salon-tabbar-h` (globals.css), y el shell lo
 * usa como padding del `<main>`: las pantallas que calculan su alto (el mapa, la caja, el conteo de stock)
 * restan ese token y quedan justo por encima de la barra.
 *
 * Entran cinco pestañas. Si a alguien le tocan más (el dueño con el punto de venta las tiene todas), la
 * quinta es «Más» y abre el resto en una hoja: así ningún nombre se corta con «…».
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
  const tabs = useMemo(
    () => visibleSalonTabs({ role, features, isPlatformAdmin }),
    [role, features, isPlatformAdmin],
  )
  const { bar, more } = useMemo(() => splitSalonTabs(tabs), [tabs])

  const items = useMemo<DockItem[]>(() => {
    const list: DockItem[] = bar.map((tab) => ({
      key: tab.key,
      label: tab.label,
      title: tab.title !== tab.label ? tab.title : undefined,
      icon: tab.icon,
      href: tab.href(tenantSlug),
    }))
    if (more.length > 0) {
      list.push({
        key: MORE,
        label: 'Más',
        title: 'Más pantallas',
        icon: CircleEllipsis,
        onSelect: () => setMoreOpen(true),
        opensDialog: true,
      })
    }
    return list
  }, [bar, more, tenantSlug])

  if (tabs.length === 0 || BARE.test(pathname)) return null

  // Una sola pestaña activa: la primera que reconoce la ruta, esté en la barra o detrás de «Más».
  const activeKey = tabs.find((tab) => tab.match(pathname, tenantSlug))?.key ?? null
  const activeInMore = more.some((tab) => tab.key === activeKey)
  const shownKey = moreOpen || activeInMore ? MORE : activeKey

  return (
    <>
      <LiquidDock
        scope="salon"
        label="Navegación salón"
        items={items}
        activeKey={shownKey}
        // La mesa es una pantalla de un solo trabajo: la acción principal queda al borde del pulgar.
        hidden={NO_TABBAR.test(pathname)}
      />
      {more.length > 0 ? (
        <AppSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          title="Más pantallas"
          description="El resto de las pantallas del salón."
        >
          <div className="app-group app-group-list">
            {more.map((tab) => (
              <MoreRow
                key={tab.key}
                tab={tab}
                href={tab.href(tenantSlug)}
                active={tab.key === activeKey}
                onGo={() => setMoreOpen(false)}
              />
            ))}
          </div>
        </AppSheet>
      ) : null}
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
    <Link href={href} onClick={onGo} aria-current={active ? 'page' : undefined} className="app-row">
      <span className="app-row-icon" data-tone={active ? 'forest' : 'slate'}>
        <Icon aria-hidden />
      </span>
      <span className="flex-1 font-semibold">{tab.title}</span>
    </Link>
  )
}
