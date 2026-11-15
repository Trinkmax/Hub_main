'use client'

import { CircleEllipsis } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { openTex } from '@/components/administracion/tex/open-tex'
import {
  DEFAULT_DOCK,
  type DockPlan,
  dockActiveKey,
  dockCookieName,
  MORE_KEY,
  planDock,
  serializeDockCookie,
} from '../dock/dock-items'
import { type DockItem, LiquidDock } from '../dock/liquid-dock'
import { computeActiveHrefs } from '../nav-active'
import type { ResolvedNavGroup } from '../nav-config'
import { NAV_ICONS } from '../nav-icons'
import { MORE_OPEN_EVENT } from './more-events'
import { MoreSheet, type MoreSheetViewer } from './more-sheet'
import { TexOrbFace } from './tex-orb'

/**
 * La barra de abajo del panel de gestión en el celular (debajo de 1024 px; en la compu manda el menú
 * lateral). Las pestañas las decide `planDock` (rol + lo que eligió cada socio): la primera vez en el
 * servidor, con la cookie, y después acá, apenas alguien las cambia desde «Más › Editar». La última es
 * «Más», que abre la hoja con todo lo demás. El círculo de la derecha es Tex.
 *
 * Mensajería es una app dentro de la app (el clon de WhatsApp) y trae su propia barra: ahí esta se va.
 */
export function ManagerDock({
  slug,
  tenantName,
  groups,
  plan: initialPlan,
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
  // Las que eligió esta persona: arrancan como vinieron del servidor y cambian al instante al editarlas.
  const [chosen, setChosen] = useState<string[]>(() => initialPlan.bar.map((item) => item.key))
  const plan = useMemo(
    () => planDock(groups, viewer.role, chosen) ?? initialPlan,
    [groups, viewer.role, chosen, initialPlan],
  )

  const saveBar = (keys: string[]) => {
    setChosen(keys)
    // biome-ignore lint/suspicious/noDocumentCookie: cookie no-httpOnly que el servidor lee en el primer render (mismo patrón que hub_sidebar); Cookie Store API aún no es universal
    document.cookie = `${dockCookieName(slug)}=${serializeDockCookie(keys)}; path=/; max-age=31536000; samesite=lax`
  }

  // Mensajería tiene su propia barra; su círculo abre esta hoja para ir a otra parte del panel.
  useEffect(() => {
    const open = () => setMoreOpen(true)
    window.addEventListener(MORE_OPEN_EVENT, open)
    return () => window.removeEventListener(MORE_OPEN_EVENT, open)
  }, [])

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
        // En el celular, adentro de Mensajería manda su propia barra (dock.css esconde esta debajo de 768 px).
        context={inMessaging ? 'wa' : undefined}
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
        bar={plan.bar.map((item) => item.key)}
        defaultBar={DEFAULT_DOCK[viewer.role] ?? []}
        onSaveBar={plan.more.length > 0 ? saveBar : undefined}
      />
    </>
  )
}
