import type { FeatureKey, TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import type { NavIconKey } from './nav-icons'

export type NavItem = {
  label: string
  href: (slug: string) => string
  icon: NavIconKey
  /** Si está, sólo se muestra a estos roles. Si no, a todos. */
  roles?: TenantRole[]
  /** Match exacto (true) o prefijo (false, default). Vale también para `activePaths`. */
  exact?: boolean
  /** Abre en nueva pestaña (p. ej. "Salón en vivo" desde el manager). Nunca queda resaltado. */
  newTab?: boolean
  /** Si está, sólo se muestra cuando la feature está ON (o quien mira es superadmin). */
  feature?: FeatureKey
  /**
   * Administración (H.0): además del rol y del flag, el acceso por persona.
   * `read` = la ve quien tiene acceso de lectura (contadora o dueño
   * habilitado); `read_or_setup` = también el dueño que puede hacer la puesta
   * en marcha (la entrada lo lleva al asistente). El superadmin no saltea
   * esto: el acceso lo decide la base.
   */
  accounting?: 'read' | 'read_or_setup'
  /**
   * Otras rutas de la MISMA sección que también resaltan la entrada. Las
   * partes de una sección viven en pestañas arriba de la página, no en el
   * menú (p. ej. Clientes → /acreditar y /local/captura). Matchean igual que
   * el href: por prefijo con borde de segmento.
   */
  activePaths?: (slug: string) => string[]
}

export type NavGroup = {
  /**
   * Nombre del bloque. NO se muestra (los bloques se separan sólo por aire,
   * sin títulos ni desplegables): queda como nombre accesible de su lista.
   */
  label: string
  items: NavItem[]
  /** Se ancla al fondo del sidebar (Configuración). */
  pinned?: boolean
}

/** Versión "resuelta" — href ya evaluado, todo serializable para cruzar a Client Components. */
export type ResolvedNavItem = {
  label: string
  href: string
  iconKey: NavIconKey
  exact?: boolean
  newTab?: boolean
  activePaths?: string[]
}

export type ResolvedNavGroup = {
  label: string
  items: ResolvedNavItem[]
  pinned?: boolean
}

/**
 * Information architecture del Manager Workspace (loyalty-first).
 *
 * UNA entrada por sección: sin desplegables, sin flechitas, sin sub-ítems.
 * Pedido del dueño (07/10/2026): «se presta mucho a confusión los
 * desplegables, no se nota cuándo está plegado… la idea siempre es que haya
 * la menor cantidad posible». Las partes de cada sección son pestañas arriba
 * de la página (Clientes, Marketing, Estadísticas, Administración) o la
 * navegación interna que ya tenían (Club, Mensajería, Configuración), y
 * `activePaths` deja la entrada resaltada en todas ellas.
 *
 * Orden por el FLUJO del dueño, en bloques separados por aire: el hoy
 * (resumen, operativo, mensajería), la agenda y los clientes, el negocio
 * (carta, club, marketing, números, administración) y, anclada abajo, la
 * configuración. Lo de servicio de mesa (Salón) queda OCULTO detrás de
 * feature-flags de superadmin.
 *
 * Roles acotados (el proxy además limita sus rutas — lib/tenant/roles.ts):
 *   editor     → sólo Carta («Ver carta» es un botón de la página)
 *   host       → Operativo, Reservas, Calendario y Mis números
 *   accountant → sólo Administración
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
        // Hub de comunicación con el cliente. Su navegación interna
        // (Inbox/Difusiones/Flows/Audiencias/Config) vive en su propio riel.
        label: 'Mensajería',
        href: (s) => `/${s}/mensajeria`,
        icon: 'MessageCircle',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Agenda y clientes',
    items: [
      {
        // La lista del día / semana / mes: la anfitriona trabaja con la lista,
        // el filtro y «Pasar lista». El alta y la ficha (/reservas/nuevo,
        // /reservas/[id]) resaltan esta entrada por prefijo.
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
      {
        // Personas (con sus segmentos Reservas / Walk-in), Acreditar y el QR del
        // club: pestañas arriba de la página.
        label: 'Clientes',
        href: (s) => `/${s}/clientes`,
        icon: 'Users',
        roles: ['owner'],
        activePaths: (s) => [`/${s}/acreditar`, `/${s}/local/captura`],
      },
    ],
  },
  {
    label: 'Negocio',
    items: [
      {
        // Edita el menú público. «Ver carta» (como la ve el cliente) es un
        // botón de la página, para el dueño y para quien edita contenido.
        label: 'Carta',
        href: (s) => `/${s}/menu`,
        icon: 'UtensilsCrossed',
        roles: ['owner', 'editor'],
      },
      {
        // Su propio editor (/club) con pestañas internas (?tab=).
        label: 'Club',
        href: (s) => `/${s}/club`,
        icon: 'Star',
        roles: ['owner'],
      },
      {
        // Lo que el bar muestra puertas afuera y cómo se organiza el equipo
        // para producirlo: Tareas, Link de Instagram y Páginas son pestañas.
        // Owner-only: es la mesa de los socios.
        label: 'Marketing',
        href: (s) => `/${s}/tareas`,
        icon: 'ListChecks',
        roles: ['owner'],
        activePaths: (s) => [`/${s}/enlaces`, `/${s}/paginas`],
      },
      {
        // Resumen, Cómo nos fue, Señas, Comisiones y Reseñas (con su flag) son
        // pestañas arriba de la página.
        label: 'Estadísticas',
        href: (s) => `/${s}/estadisticas`,
        icon: 'BarChart3',
        roles: ['owner'],
        activePaths: (s) => [`/${s}/reviews`],
      },
      {
        // Lo que va ganando quien gestiona reservas (comisiones propias).
        label: 'Mis números',
        href: (s) => `/${s}/mis-numeros`,
        icon: 'Coins',
        roles: ['host'],
      },
      {
        // Contabilidad de la SAS (Sprint 1). Solo con el flag `accounting` y el
        // acceso por persona; la contadora ve SOLO esta entrada. Compras,
        // Ventas, Cajas, Libros y Plan de cuentas son pestañas de la sección,
        // así que resalta en cualquier /administracion/*.
        label: 'Administración',
        href: (s) => `/${s}/administracion`,
        icon: 'Landmark',
        roles: ['owner', 'accountant'],
        feature: 'accounting',
        accounting: 'read_or_setup',
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
  {
    // Anclado al fondo: siempre a un toque, nunca en el medio. La
    // Documentación es una sección más adentro de Configuración.
    label: 'Ajustes',
    pinned: true,
    items: [
      {
        label: 'Configuración',
        href: (s) => `/${s}/configuracion`,
        icon: 'Settings2',
        roles: ['owner'],
        activePaths: (s) => [`/${s}/docs`],
      },
    ],
  },
]

/** Sin Administración: lo que se usa si quien llama no pasa el acceso. */
export const NO_ACCOUNTING: AccountingAccess = {
  enabled: false,
  setUp: false,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}

/**
 * Las puertas de una entrada del menú o de una pestaña de sección
 * (section-tabs-config.ts): rol, feature y acceso a Administración. Ver los
 * campos homónimos de `NavItem`.
 */
export type NavGate = {
  roles?: readonly TenantRole[]
  feature?: FeatureKey
  accounting?: 'read' | 'read_or_setup'
}

/** Quién mira, tal como sale de `requireTenantAccess`. */
export type NavViewer = {
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  accounting: AccountingAccess
}

/**
 * ¿Ve esta entrada (o pestaña)? UNA sola regla para el menú y para las
 * pestañas de sección, así no se separan con el tiempo. Sólo decide qué se
 * muestra: la página y la base vuelven a decidir todo.
 */
export function gateAllows(gate: NavGate, viewer: NavViewer): boolean {
  const roleOk = !gate.roles || gate.roles.includes(viewer.role)
  // El flag de Administración no se saltea por ser superadmin (lo decide la base).
  const featureOk =
    !gate.feature ||
    (gate.feature !== 'accounting' && viewer.isPlatformAdmin) ||
    viewer.features[gate.feature]
  return roleOk && featureOk && accountingOk(gate, viewer.accounting)
}

function accountingOk(gate: NavGate, accounting: AccountingAccess): boolean {
  if (!gate.accounting) return true
  // `read` y `canSetUp` ya traen el flag del bar adentro (parseAccountingAccess),
  // pero se pide `enabled` igual: fail-closed si alguien arma el objeto a mano.
  if (!accounting.enabled) return false
  return gate.accounting === 'read' ? accounting.read : accounting.read || accounting.canSetUp
}

/**
 * Filtra los grupos por rol + feature-flag (+ superadmin bypass) + acceso a
 * Administración. Un grupo sin entradas visibles desaparece.
 */
export function visibleGroups(
  role: TenantRole,
  features: TenantFeatures,
  isPlatformAdmin: boolean,
  accounting: AccountingAccess = NO_ACCOUNTING,
): NavGroup[] {
  const viewer: NavViewer = { role, features, isPlatformAdmin, accounting }
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => gateAllows(item, viewer)),
  })).filter((group) => group.items.length > 0)
}

/**
 * Resuelve los grupos a estructuras serializables (href y `activePaths`
 * ejecutados con el slug, icon como key). Llamar con (role, slug, features,
 * isPlatformAdmin, accounting); features, isPlatformAdmin y accounting vienen
 * de `requireTenantAccess` (un round-trip).
 */
export function resolveNavGroups(
  role: TenantRole,
  slug: string,
  features: TenantFeatures,
  isPlatformAdmin: boolean,
  accounting: AccountingAccess = NO_ACCOUNTING,
): ResolvedNavGroup[] {
  return visibleGroups(role, features, isPlatformAdmin, accounting).map((group) => ({
    label: group.label,
    pinned: group.pinned,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href(slug),
      iconKey: item.icon,
      exact: item.exact,
      newTab: item.newTab,
      activePaths: item.activePaths?.(slug),
    })),
  }))
}
