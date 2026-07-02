import type { TenantRole } from '@/lib/tenant/types'
import type { NavIconKey } from './nav-icons'

export type MessagingNavItem = {
  label: string
  /** Segmento bajo /mensajeria (ej. 'inbox', 'difusiones'). */
  segment: string
  icon: NavIconKey
  /** Si está, sólo estos roles lo ven. Si no, todos. */
  roles?: TenantRole[]
}

export type MessagingNavGroup = {
  /** Rótulo del grupo. Sin rótulo = grupo hero (Inbox). */
  label?: string
  items: MessagingNavItem[]
}

export const MESSAGING_NAV: MessagingNavGroup[] = [
  { items: [{ label: 'Inbox', segment: 'inbox', icon: 'Inbox' }] },
  {
    label: 'Campañas',
    items: [
      { label: 'Difusiones', segment: 'difusiones', icon: 'Megaphone', roles: ['owner'] },
      { label: 'Flows', segment: 'flows', icon: 'Workflow', roles: ['owner'] },
      { label: 'Audiencias', segment: 'audiencias', icon: 'UsersRound', roles: ['owner'] },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { label: 'Canales', segment: 'canales', icon: 'Settings2', roles: ['owner'] },
      { label: 'Plantillas', segment: 'plantillas', icon: 'MessageSquareText', roles: ['owner'] },
      {
        label: 'Mensajes rápidos',
        segment: 'mensajes-rapidos',
        icon: 'Zap',
        roles: ['owner', 'cashier'],
      },
      { label: 'Etiquetas', segment: 'etiquetas', icon: 'Tag', roles: ['owner', 'cashier'] },
    ],
  },
]

/** Filtra por rol y descarta grupos que quedan vacíos. */
export function visibleMessagingNav(role: TenantRole): MessagingNavGroup[] {
  return MESSAGING_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)
}
