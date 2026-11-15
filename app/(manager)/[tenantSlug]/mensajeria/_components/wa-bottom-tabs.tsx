'use client'

import { ChevronRight, CircleEllipsis, LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { type DockItem, LiquidDock } from '@/components/shell/dock/liquid-dock'
import { AppSheet } from '@/components/shell/mobile/app-sheet'
import { openMoreSheet } from '@/components/shell/mobile/more-events'
import type { TenantRole } from '@/lib/tenant/types'
import { MAIN_ITEMS, SETTINGS_ITEMS, visibleFor } from './wa-rail'

/**
 * Las secciones de Mensajería abajo (solo en el celular), como WhatsApp en el teléfono: la misma barra de
 * vidrio líquido del resto del panel (components/shell/dock), con sus pestañas (Chats, Difusiones,
 * Automático, Audiencias). El círculo de la derecha es el «Más» de Mensajería: sus ajustes y la salida al
 * resto del panel (la barra del panel se va mientras estás acá).
 *
 * Con un chat abierto la barra se va, para dejar el composer al fondo, como WhatsApp.
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
  const [moreOpen, setMoreOpen] = useState(false)

  const main = useMemo(() => visibleFor(MAIN_ITEMS, role), [role])
  const settings = useMemo(() => visibleFor(SETTINGS_ITEMS, role), [role])

  const items = useMemo<DockItem[]>(
    () =>
      main.map((item) => ({
        key: item.segment,
        label: item.segment === 'flows' ? 'Automático' : item.label,
        title: item.segment === 'flows' ? item.label : undefined,
        icon: item.icon,
        href: `/${tenantSlug}/mensajeria/${item.segment}`,
        badge: item.segment === 'inbox' ? unreadTotal : null,
      })),
    [main, tenantSlug, unreadTotal],
  )

  // Con un chat abierto el composer va al fondo, como WhatsApp.
  const inChat = pathname.endsWith('/mensajeria/inbox') && searchParams.has('c')
  const activeKey =
    main.find((item) => {
      const href = `/${tenantSlug}/mensajeria/${item.segment}`
      return pathname === href || pathname.startsWith(`${href}/`)
    })?.segment ?? null

  return (
    <>
      <LiquidDock
        scope="wa"
        label="Secciones de mensajería"
        items={items}
        activeKey={activeKey}
        hidden={inChat}
        orb={{
          label: 'Más: ajustes de mensajería y el resto del panel',
          content: <CircleEllipsis aria-hidden className="size-[24px]" strokeWidth={1.9} />,
          onPress: () => setMoreOpen(true),
        }}
      />
      <AppSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="Mensajería"
        description="Los ajustes de mensajería y el resto del panel."
      >
        {settings.length > 0 ? (
          <>
            <h3 className="app-group-label mt-1">Ajustes</h3>
            <div className="app-group app-group-list">
              {settings.map((item) => {
                const Icon = item.icon
                const href = `/${tenantSlug}/mensajeria/${item.segment}`
                const active = pathname.startsWith(href)
                return (
                  <Link
                    key={item.segment}
                    href={href}
                    className="app-row"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMoreOpen(false)}
                  >
                    <span className="app-row-icon">
                      <Icon aria-hidden />
                    </span>
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight aria-hidden className="app-row-chevron" />
                  </Link>
                )
              })}
            </div>
          </>
        ) : null}
        <h3 className="app-group-label">El panel</h3>
        <div className="app-group app-group-list">
          <button
            type="button"
            className="app-row"
            onClick={() => {
              setMoreOpen(false)
              // Que esta hoja termine de bajar antes de que suba la del panel.
              setTimeout(openMoreSheet, 220)
            }}
          >
            <span className="app-row-icon">
              <LayoutGrid aria-hidden />
            </span>
            <span className="flex-1 text-left">Ir a otra parte del panel</span>
            <ChevronRight aria-hidden className="app-row-chevron" />
          </button>
        </div>
      </AppSheet>
    </>
  )
}
