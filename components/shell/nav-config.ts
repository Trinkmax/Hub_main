import type { TenantRole } from '@/lib/tenant/types'
import type { NavIconKey } from './nav-icons'

export type NavItem = {
  label: string
  href: (slug: string) => string
  icon: NavIconKey
  /** Si está, sólo se muestra a estos roles. Si no, a todos. */
  roles?: TenantRole[]
  /** Match exacto (true) o prefijo (false, default). */
  exact?: boolean
  /** Abre en nueva pestaña. Para "Salón en vivo" desde el manager. */
  newTab?: boolean
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

/** Versión "resuelta" — href ya evaluado, todo serializable para cruzar a Client Components. */
export type ResolvedNavItem = {
  label: string
  href: string
  iconKey: NavIconKey
  exact?: boolean
  newTab?: boolean
}

export type ResolvedNavGroup = {
  label: string
  items: ResolvedNavItem[]
}

/**
 * Information architecture del Manager Workspace, ordenada por el FLUJO DE TRABAJO
 * del dueño (no por dominio técnico): primero el día, después se arma el mes
 * (Calendario), se gestionan las Reservas que caen, se prepara el Salón físico,
 * se atiende al Cliente, se hace Marketing para traerlos de vuelta, se mantiene
 * el Catálogo, se miran los Insights y al final los Ajustes.
 *
 *   HOY        — qué está pasando ahora (resumen, salón en vivo, bandeja, acreditar)
 *   CALENDARIO — el mes de eventos programados (Sushi/Pizza Libre); los "Eventos"
 *                (ex-Templates) son una PESTAÑA adentro, no un item de nav
 *   RESERVAS   — quién reservó para esas fechas
 *   SALÓN      — disposición física: plano, QRs de mesa, flujo de comandas
 *   CLIENTES   — el CRM: quién viene y su historial
 *   MARKETING  — cómo los traigo de vuelta (shows, difusiones, audiencias, flows)
 *   CATÁLOGO   — qué vendo y cómo premio la recurrencia
 *   INSIGHTS   — qué entiendo del negocio
 *   AYUDA / AJUSTES
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Hoy',
    items: [
      {
        label: 'Resumen',
        href: (s) => `/${s}`,
        icon: 'LayoutDashboard',
        exact: true,
      },
      {
        label: 'Operativo',
        href: (s) => `/${s}/salon/reservas-operativo`,
        icon: 'MonitorSmartphone',
        newTab: true,
      },
      {
        label: 'Bandeja',
        href: (s) => `/${s}/bandeja`,
        icon: 'Inbox',
      },
      {
        label: 'Acreditar',
        href: (s) => `/${s}/acreditar`,
        icon: 'ScanLine',
      },
    ],
  },
  {
    label: 'Calendario',
    items: [
      {
        label: 'Calendario',
        href: (s) => `/${s}/eventos/programados`,
        icon: 'CalendarDays',
      },
    ],
  },
  {
    label: 'Reservas',
    items: [
      {
        label: 'Reservas',
        href: (s) => `/${s}/reservas`,
        icon: 'CalendarCheck',
      },
    ],
  },
  {
    label: 'Salón',
    items: [
      {
        label: 'Plano',
        href: (s) => `/${s}/local/mesas`,
        icon: 'LayoutGrid',
        roles: ['owner'],
      },
      {
        label: 'Captura QRs',
        href: (s) => `/${s}/local/captura`,
        icon: 'QrCode',
        roles: ['owner'],
      },
      {
        label: 'Auto-aceptación',
        href: (s) => `/${s}/local/auto-aceptacion`,
        icon: 'Zap',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Clientes',
    items: [
      {
        label: 'Personas',
        href: (s) => `/${s}/clientes`,
        icon: 'Users',
      },
      {
        label: 'Visitas',
        href: (s) => `/${s}/visitas/nueva`,
        icon: 'Receipt',
      },
    ],
  },
  {
    label: 'Marketing',
    items: [
      {
        label: 'Shows y fiestas',
        href: (s) => `/${s}/eventos`,
        icon: 'PartyPopper',
        roles: ['owner'],
      },
      {
        label: 'Difusiones',
        href: (s) => `/${s}/difusiones`,
        icon: 'Megaphone',
        roles: ['owner'],
      },
      {
        label: 'Audiencias',
        href: (s) => `/${s}/audiencias`,
        icon: 'UsersRound',
        roles: ['owner'],
      },
      {
        label: 'Flows',
        href: (s) => `/${s}/flows`,
        icon: 'Workflow',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      {
        label: 'Menú',
        href: (s) => `/${s}/menu`,
        icon: 'UtensilsCrossed',
        roles: ['owner'],
      },
      {
        label: 'Puntos',
        href: (s) => `/${s}/puntos`,
        icon: 'Star',
        roles: ['owner'],
      },
      {
        label: 'Punch cards',
        href: (s) => `/${s}/punch-cards`,
        icon: 'Stamp',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        label: 'Estadísticas',
        href: (s) => `/${s}/estadisticas`,
        icon: 'BarChart3',
        roles: ['owner'],
      },
      {
        label: 'Comisiones',
        href: (s) => `/${s}/estadisticas/comisiones`,
        icon: 'Coins',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Ayuda',
    items: [
      {
        label: 'Documentación',
        href: (s) => `/${s}/docs`,
        icon: 'BookOpen',
      },
    ],
  },
  {
    label: 'Ajustes',
    items: [
      {
        label: 'Configuración',
        href: (s) => `/${s}/configuracion`,
        icon: 'Settings2',
        roles: ['owner'],
      },
    ],
  },
]

export function visibleGroups(role: TenantRole): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)
}

/**
 * Resuelve los grupos a estructuras serializables (href ejecutado, icon como
 * key string). Llamar **server-side** antes de pasar a un Client Component.
 */
export function resolveNavGroups(role: TenantRole, slug: string): ResolvedNavGroup[] {
  return visibleGroups(role).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href(slug),
      iconKey: item.icon,
      exact: item.exact,
      newTab: item.newTab,
    })),
  }))
}
