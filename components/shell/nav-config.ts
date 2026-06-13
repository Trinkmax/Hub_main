import type { FeatureKey, TenantFeatures } from '@/lib/platform/features'
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
  /** Abre en nueva pestaña (p. ej. "Salón en vivo" desde el manager). */
  newTab?: boolean
  /** Si está, sólo se muestra cuando la feature está ON (o quien mira es superadmin). */
  feature?: FeatureKey
  /** Sub-items anidados (1 nivel). El padre además navega a su propio href. */
  children?: NavItem[]
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
  children?: ResolvedNavItem[]
}

export type ResolvedNavGroup = {
  label: string
  items: ResolvedNavItem[]
}

/**
 * Information architecture del Manager Workspace para el producto loyalty-first.
 * Orden por el FLUJO del dueño: primero el hoy (resumen, operativo del día,
 * mensajería), después la agenda (calendario + reservas), el CRM (personas +
 * acreditar puntos), el crecimiento (marketing, menú, club de beneficios), el
 * negocio (estadísticas, ajustes) y, OCULTO detrás de feature-flags de superadmin,
 * todo lo de servicio de mesa (Salón).
 *
 * Items con 🔁: rutas que se repuntan en fases siguientes (hoy apuntan a lo que
 * ya existe para no dejar links muertos):
 *   - Operativo → /salon/reservas-operativo (F5: /operativo manager)
 *   - Marketing (padre) → /difusiones      (F5: hub /marketing)
 *   - Club (padre) → /puntos               (F2: hub /club + Niveles/Recompensas/Bienvenida)
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Hoy',
    items: [
      { label: 'Resumen', href: (s) => `/${s}`, icon: 'LayoutDashboard', exact: true },
      { label: 'Operativo', href: (s) => `/${s}/operativo`, icon: 'MonitorSmartphone' },
      { label: 'Mensajería', href: (s) => `/${s}/bandeja`, icon: 'Inbox' },
    ],
  },
  {
    label: 'Agenda',
    items: [
      { label: 'Calendario', href: (s) => `/${s}/eventos/programados`, icon: 'CalendarDays' },
      { label: 'Reservas', href: (s) => `/${s}/reservas`, icon: 'CalendarCheck' },
    ],
  },
  {
    label: 'Clientes',
    items: [
      {
        label: 'Personas',
        href: (s) => `/${s}/clientes`,
        icon: 'Users',
        children: [
          {
            label: 'Reservas',
            href: (s) => `/${s}/clientes?segment=reserva`,
            icon: 'CalendarCheck',
          },
          { label: 'Walk-in', href: (s) => `/${s}/clientes?segment=walkin`, icon: 'Receipt' },
        ],
      },
      { label: 'Acreditar', href: (s) => `/${s}/acreditar`, icon: 'ScanLine' },
      {
        label: 'QR del club',
        href: (s) => `/${s}/local/captura`,
        icon: 'QrCode',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Crecimiento',
    items: [
      {
        label: 'Marketing',
        href: (s) => `/${s}/marketing`,
        icon: 'Megaphone',
        roles: ['owner'],
        children: [
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
          { label: 'Flows', href: (s) => `/${s}/flows`, icon: 'Workflow', roles: ['owner'] },
        ],
      },
      { label: 'Menú', href: (s) => `/${s}/menu`, icon: 'UtensilsCrossed', roles: ['owner'] },
      {
        label: 'Club de beneficios',
        href: (s) => `/${s}/club`,
        icon: 'Star',
        roles: ['owner'],
        children: [
          {
            label: 'Niveles',
            href: (s) => `/${s}/club/niveles`,
            icon: 'Sparkles',
            roles: ['owner'],
          },
          {
            label: 'Puntos y recompensas',
            href: (s) => `/${s}/club/puntos`,
            icon: 'Gift',
            roles: ['owner'],
          },
          {
            label: 'Punch cards',
            href: (s) => `/${s}/club/punch-cards`,
            icon: 'Stamp',
            roles: ['owner'],
          },
          {
            label: 'Bienvenida',
            href: (s) => `/${s}/club/bienvenida`,
            icon: 'Star',
            roles: ['owner'],
          },
        ],
      },
    ],
  },
  {
    label: 'Negocio',
    items: [
      {
        label: 'Estadísticas',
        href: (s) => `/${s}/estadisticas`,
        icon: 'BarChart3',
        roles: ['owner'],
        children: [
          {
            label: 'Comisiones',
            href: (s) => `/${s}/estadisticas/comisiones`,
            icon: 'Coins',
            roles: ['owner'],
          },
        ],
      },
      {
        label: 'Reseñas',
        href: (s) => `/${s}/reviews`,
        icon: 'Star',
        roles: ['owner'],
        feature: 'reviews',
      },
      {
        label: 'Configuración',
        href: (s) => `/${s}/configuracion`,
        icon: 'Settings2',
        roles: ['owner'],
        children: [
          { label: 'Documentación', href: (s) => `/${s}/docs`, icon: 'BookOpen', roles: ['owner'] },
        ],
      },
    ],
  },
  {
    label: 'Salón',
    items: [
      {
        label: 'Salón en vivo',
        href: (s) => `/${s}/salon/mesas`,
        icon: 'ClipboardList',
        roles: ['owner'],
        newTab: true,
        feature: 'table_service',
      },
      {
        label: 'Cocina',
        href: (s) => `/${s}/salon/cocina`,
        icon: 'ChefHat',
        roles: ['owner'],
        newTab: true,
        feature: 'kitchen',
      },
      {
        label: 'Plano y QRs de mesa',
        href: (s) => `/${s}/local/mesas`,
        icon: 'LayoutGrid',
        roles: ['owner'],
        feature: 'floor_plan',
      },
      {
        label: 'Auto-aceptación',
        href: (s) => `/${s}/local/auto-aceptacion`,
        icon: 'Zap',
        roles: ['owner'],
        feature: 'auto_accept',
      },
    ],
  },
]

function itemVisible(
  item: NavItem,
  role: TenantRole,
  features: TenantFeatures,
  isPlatformAdmin: boolean,
): boolean {
  const roleOk = !item.roles || item.roles.includes(role)
  const featureOk = !item.feature || isPlatformAdmin || features[item.feature]
  return roleOk && featureOk
}

/**
 * Filtra los grupos por rol + feature-flag (+ superadmin bypass), recursando en
 * los children. Un padre se mantiene si él pasa o si le sobrevive algún hijo.
 */
export function visibleGroups(
  role: TenantRole,
  features: TenantFeatures,
  isPlatformAdmin: boolean,
): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .map((item) => {
        const children = item.children?.filter((child) =>
          itemVisible(child, role, features, isPlatformAdmin),
        )
        return { item, children }
      })
      .filter(
        ({ item, children }) =>
          itemVisible(item, role, features, isPlatformAdmin) || (children?.length ?? 0) > 0,
      )
      .map(({ item, children }) => ({ ...item, children })),
  })).filter((group) => group.items.length > 0)
}

/**
 * Resuelve los grupos a estructuras serializables (href ejecutado, icon como key).
 * Llamar con (role, slug, features, isPlatformAdmin); features/isPlatformAdmin
 * vienen del tenant (requireTenantAccess) + lib/platform/is-admin.
 */
export function resolveNavGroups(
  role: TenantRole,
  slug: string,
  features: TenantFeatures,
  isPlatformAdmin: boolean,
): ResolvedNavGroup[] {
  return visibleGroups(role, features, isPlatformAdmin).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href(slug),
      iconKey: item.icon,
      exact: item.exact,
      newTab: item.newTab,
      children: item.children?.map((child) => ({
        label: child.label,
        href: child.href(slug),
        iconKey: child.icon,
        exact: child.exact,
        newTab: child.newTab,
      })),
    })),
  }))
}
