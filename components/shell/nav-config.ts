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
  /**
   * El padre NO navega: al clickearlo sólo expande/colapsa sus hijos. Para
   * categorías-madre que son puro agrupador (ej. "Personas") y cuya "vista
   * todo" ya es uno de los hijos.
   */
  expanderOnly?: boolean
  /** Sub-items anidados (1 nivel). El padre además navega a su propio href. */
  children?: NavItem[]
}

export type NavGroup = {
  label: string
  items: NavItem[]
  /**
   * El header del grupo colapsa/expande sus items (accordion). El grupo con la
   * ruta activa se auto-expande; el estado elegido persiste en localStorage.
   * "Hoy" no colapsa: es el cockpit diario, siempre a mano.
   */
  collapsible?: boolean
  /** Se ancla al fondo del sidebar, sin header de grupo (ej. Configuración). */
  pinned?: boolean
}

/** Versión "resuelta" — href ya evaluado, todo serializable para cruzar a Client Components. */
export type ResolvedNavItem = {
  label: string
  href: string
  iconKey: NavIconKey
  exact?: boolean
  newTab?: boolean
  expanderOnly?: boolean
  children?: ResolvedNavItem[]
}

export type ResolvedNavGroup = {
  label: string
  items: ResolvedNavItem[]
  collapsible?: boolean
  pinned?: boolean
}

/**
 * Information architecture del Manager Workspace para el producto loyalty-first.
 * Orden por el FLUJO del dueño: primero el hoy (resumen, operativo del día,
 * mensajería), después la agenda (calendario + reservas), el CRM (personas +
 * acreditar puntos), el crecimiento (carta, club de beneficios), el negocio
 * (estadísticas) y, anclada abajo, la configuración. Lo de servicio de mesa
 * (Salón) queda OCULTO detrás de feature-flags de superadmin.
 *
 * Roles acotados (el proxy además limita sus rutas — lib/tenant/roles.ts):
 *   editor → sólo Carta (+ ver la carta pública)
 *   host   → Operativo, Calendario, Reservas y Mis números
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
        roles: ['owner'],
      },
      {
        label: 'Operativo',
        href: (s) => `/${s}/operativo`,
        icon: 'MonitorSmartphone',
        roles: ['owner', 'host'],
      },
      {
        // Hub de comunicación con el cliente. Navega a la sección; su navegación
        // interna (Inbox/Difusiones/Flows/Audiencias/Config) vive en el sub-nav.
        label: 'Mensajería',
        href: (s) => `/${s}/mensajeria`,
        icon: 'MessageCircle',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Agenda',
    collapsible: true,
    items: [
      {
        label: 'Reservas',
        href: (s) => `/${s}/reservas`,
        icon: 'CalendarCheck',
        roles: ['owner', 'host'],
      },
      {
        label: 'Calendario',
        href: (s) => `/${s}/eventos/programados`,
        icon: 'CalendarDays',
        roles: ['owner', 'host'],
      },
    ],
  },
  {
    label: 'Clientes',
    collapsible: true,
    items: [
      {
        label: 'Personas',
        href: (s) => `/${s}/clientes`,
        icon: 'Users',
        roles: ['owner'],
        // El padre no navega: expande y te deja elegir Todos / Reservas / Walk-in.
        expanderOnly: true,
        children: [
          { label: 'Todos', href: (s) => `/${s}/clientes`, icon: 'Users', roles: ['owner'] },
          {
            label: 'Reservas',
            href: (s) => `/${s}/clientes?segment=reserva`,
            icon: 'CalendarCheck',
            roles: ['owner'],
          },
          {
            label: 'Walk-in',
            href: (s) => `/${s}/clientes?segment=walkin`,
            icon: 'Receipt',
            roles: ['owner'],
          },
        ],
      },
      { label: 'Acreditar', href: (s) => `/${s}/acreditar`, icon: 'ScanLine', roles: ['owner'] },
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
    collapsible: true,
    items: [
      // Difusiones / Audiencias / Flows se movieron al hub "Mensajería" (grupo Hoy).
      {
        // "Carta" edita el menú público (/menu). El Club vive en su propia ruta
        // (/club) — paths distintos, resaltado naturalmente excluyente.
        label: 'Carta',
        href: (s) => `/${s}/menu`,
        icon: 'UtensilsCrossed',
        roles: ['owner', 'editor'],
      },
      {
        // La carta como la ve el cliente — clave para quien carga fotos/videos.
        label: 'Ver carta',
        href: (s) => `/carta/${s}`,
        icon: 'ArrowUpRight',
        roles: ['owner', 'editor'],
        newTab: true,
      },
      {
        // El Club es su propio editor (/club) con tabs internos. Los hijos hacen
        // deep-link a cada tab (?tab=). El padre, sin query, resalta en cualquier
        // /club/* y su highlight se suprime cuando un hijo está activo.
        label: 'Club de beneficios',
        href: (s) => `/${s}/club`,
        icon: 'Star',
        roles: ['owner'],
        children: [
          {
            label: 'Puntos y niveles',
            href: (s) => `/${s}/club?tab=programa`,
            icon: 'Sparkles',
            roles: ['owner'],
          },
          {
            label: 'Aliados',
            href: (s) => `/${s}/club?tab=aliados`,
            icon: 'Handshake',
            roles: ['owner'],
          },
          {
            label: 'Bienvenida',
            href: (s) => `/${s}/club?tab=bienvenida`,
            icon: 'Star',
            roles: ['owner'],
          },
          {
            label: 'Punch cards',
            href: (s) => `/${s}/club?tab=punch`,
            icon: 'Stamp',
            roles: ['owner'],
          },
        ],
      },
    ],
  },
  {
    label: 'Negocio',
    collapsible: true,
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
        // Lo que va ganando quien gestiona reservas (comisiones propias).
        label: 'Mis números',
        href: (s) => `/${s}/mis-numeros`,
        icon: 'Coins',
        roles: ['host'],
      },
      {
        label: 'Reseñas',
        href: (s) => `/${s}/reviews`,
        icon: 'Star',
        roles: ['owner'],
        feature: 'reviews',
      },
    ],
  },
  {
    label: 'Salón',
    collapsible: true,
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
  {
    // Anclado al fondo, sin header: siempre a un click, nunca en el medio.
    label: 'Sistema',
    pinned: true,
    items: [
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
 *
 * Si al rol le quedan pocos items (editor/host), los grupos dejan de colapsar:
 * no tiene sentido esconder 3 entradas detrás de accordions.
 */
export function resolveNavGroups(
  role: TenantRole,
  slug: string,
  features: TenantFeatures,
  isPlatformAdmin: boolean,
): ResolvedNavGroup[] {
  const groups = visibleGroups(role, features, isPlatformAdmin)
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0)
  const fewItems = totalItems <= 8

  return groups.map((group) => ({
    label: group.label,
    collapsible: fewItems ? false : group.collapsible,
    pinned: group.pinned,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href(slug),
      iconKey: item.icon,
      exact: item.exact,
      newTab: item.newTab,
      expanderOnly: item.expanderOnly,
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
