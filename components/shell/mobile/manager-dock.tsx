'use client'

import { CircleEllipsis } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import { openTex } from '@/components/administracion/tex/open-tex'
import { type DockPlan, dockActiveKey, MORE_KEY } from '../dock/dock-items'
import { type DockItem, LiquidDock } from '../dock/liquid-dock'
import { computeActiveHrefs } from '../nav-active'
import type { ResolvedNavGroup } from '../nav-config'
import { NAV_ICONS } from '../nav-icons'
import { MoreSheet, type MoreSheetViewer } from './more-sheet'
import { TexOrbFace } from './tex-orb'

/**
 * La barra de abajo del panel de gestión en el celular (debajo de 1024 px; en la compu manda el menú
 * lateral). Las pestañas las decide `planDock` en el servidor (rol + lo que eligió cada socio). La última
 * es «Más», que abre la hoja con todo lo demás. El círculo de la derecha es Tex.
 *
 * Mensajería es una app dentro de la app (el clon de WhatsApp) y trae su propia barra: ahí esta se va.
 */
export function ManagerDock({
  slug,
  tenantName,
  groups,
  plan,
  viewer,
  tex,
}: {
  slug: string
  tenantName: string
  groups: ResolvedNavGroup[]
  plan: DockPlan
  viewer: MoreSheetViewer
  tex: boolean
}) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const activeHref = useMemo(
    () => [...computeActiveHrefs(pathname, '', groups)][0] ?? null,
    [pathname, groups],
  )

  const items = useMemo<DockItem[]>(() => {
    const tabs: DockItem[] = plan.bar.map((item) => ({
      key: item.key,
      label: item.short ?? item.label,
      title: item.short && item.short !== item.label ? item.label : undefined,
      icon: NAV_ICONS[item.iconKey],
      href: item.href,
    }))
    if (plan.more.length > 0) {
      tabs.push({
        key: MORE_KEY,
        label: 'Más',
        title: 'Más secciones, buscar y tu cuenta',
        icon: CircleEllipsis,
        onSelect: () => setMoreOpen(true),
        opensDialog: true,
      })
    }
    return tabs
  }, [plan])

  // Con la hoja abierta, «Más» queda marcado (como la pestaña «Más» de iOS mientras mirás su lista).
  const activeKey = moreOpen ? MORE_KEY : dockActiveKey(plan, activeHref)
  const inMessaging =
    pathname === `/${slug}/mensajeria` || pathname.startsWith(`/${slug}/mensajeria/`)

  return (
    <>
      <LiquidDock
        scope="app"
        mobileOnly
        label="Secciones del panel"
        items={items}
        activeKey={activeKey}
        hidden={inMessaging}
        orb={
          tex
            ? {
                label: 'Abrir a Tex, el asistente',
                content: <TexOrbFace />,
                onPress: () => openTex(),
              }
            : null
        }
      />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        slug={slug}
        tenantName={tenantName}
        groups={groups}
        activeHref={activeHref}
        viewer={viewer}
        tex={tex}
      />
    </>
  )
}
