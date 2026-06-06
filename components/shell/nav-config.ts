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
 * Information architecture del Manager Workspace — 7 dominios.
 * Cada dominio agrupa por job-to-be-done del owner:
 *   HOY       — qué está pasando ahora
 *   CLIENTES  — quién viene
 *   MARKETING — cómo los traigo de vuelta
 *   LOCAL     — cómo está armado el salón
 *   CATÁLOGO  — qué vendo y cómo se premia
 *   INSIGHTS  — qué entiendo
 *   AJUSTES   — cómo lo configuro
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
        label: 'Acreditar',
        href: (s) => `/${s}/acreditar`,
        icon: 'ScanLine',
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
        label: 'Reservas',
        href: (s) => `/${s}/reservas`,
        icon: 'CalendarCheck',
      },
    ],
  },
  {
    label: 'Eventos',
    items: [
      {
        label: 'Calendario',
        href: (s) => `/${s}/eventos/programados`,
        icon: 'CalendarDays',
      },
      {
        label: 'Templates',
        href: (s) => `/${s}/eventos/templates`,
        icon: 'Sparkles',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Local',
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
