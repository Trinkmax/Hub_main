import type { FeatureKey, TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import type { NavIconKey } from './nav-icons'
import type { SectionKey } from './section-tabs-config'

export type NavItem = {
  /** Identificador estable (la barra de abajo del celular lo guarda en una cookie). */
  key: string
  label: string
  /**
   * Nombre corto para la barra de abajo del celular, donde cada pestaña mide ~56 px. La grilla de «Más»
   * y el menú lateral usan `label`.
   */
  short?: string
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
  /**
   * Sus pestañas (section-tabs-config.ts). La barra de abajo del celular las usa para «aplanar» la
   * sección cuando la persona tiene una o dos (la anfitriona: las pestañas de Reservas son su barra).
   */
  section?: SectionKey
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
  key: string
  label: string
  short?: string
  href: string
  iconKey: NavIconKey
  exact?: boolean
  newTab?: boolean
  activePaths?: string[]
  section?: SectionKey
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
 * de la página (`section`, ver section-tabs-config.ts) o la navegación interna
 * que ya tenían (Mensajería, Administración, Configuración), y `activePaths`
 * deja la entrada resaltada en todas ellas.
 *
 * 15/11/2026 (pedido del dueño: «anidarlas para reducir el ruido visual y jugar
 * con las pestañas dentro de las secciones»): de 14 entradas a 10. Reservas
 * junta Operativo, Calendario y Ventas online (quién viene y cuándo) y Clientes
 * suma el Club (todo lo de fidelización junto). Las URLs no cambiaron.
 *
 * Bloques separados por aire (en «Más», en el celular, sus nombres son los
 * títulos de cada grupo de íconos), por el trabajo del dueño: el inicio; la
 * agenda y los clientes (reservas, clientes, mensajería); el negocio (carta,
 * marketing, números); la gestión (compras, administración) y, anclada abajo,
 * la configuración. Lo de servicio de mesa (Salón) queda OCULTO detrás de
 * feature-flags de superadmin.
 *
 * Roles acotados (el proxy además limita sus rutas — lib/tenant/roles.ts):
 *   editor     → Carta («Ver carta» es un botón de la página) y Tareas
 *   host       → Reservas (con sus cuatro pestañas), Mis números y Tareas
 *   accountant → sólo Administración
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Inicio',
    items: [
      {
        key: 'resumen',
        label: 'Resumen',
        href: (s) => `/${s}`,
        icon: 'LayoutDashboard',
        exact: true,
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Agenda y clientes',
    items: [
      {
        // Quién viene y cuándo: la lista (alta y ficha por prefijo), el Operativo (el tablero de la
        // noche), el Calendario y las Ventas online son pestañas arriba de la página.
        key: 'reservas',
        label: 'Reservas',
        href: (s) => `/${s}/reservas`,
        icon: 'CalendarCheck',
        roles: ['owner', 'host'],
        section: 'reservas',
        activePaths: (s) => [`/${s}/operativo`, `/${s}/eventos`, `/${s}/ventas-online`],
      },
      {
        // Personas (con sus segmentos Reservas / Walk-in), el Club, Acreditar y el QR del club:
        // pestañas arriba de la página.
        key: 'clientes',
        label: 'Clientes',
        href: (s) => `/${s}/clientes`,
        icon: 'Users',
        roles: ['owner'],
        section: 'clientes',
        activePaths: (s) => [`/${s}/club`, `/${s}/acreditar`, `/${s}/local/captura`],
      },
      {
        // Hub de comunicación con el cliente. Su navegación interna
        // (Inbox/Difusiones/Flows/Audiencias/Config) vive en su propio riel.
        key: 'mensajeria',
        label: 'Mensajería',
        short: 'Mensajes',
        href: (s) => `/${s}/mensajeria`,
        icon: 'MessageCircle',
        roles: ['owner'],
      },
      {
        // Lo que va ganando quien gestiona reservas (comisiones propias).
        key: 'mis-numeros',
        label: 'Mis números',
        short: 'Números',
        href: (s) => `/${s}/mis-numeros`,
        icon: 'Coins',
        roles: ['host'],
      },
    ],
  },
  {
    label: 'Negocio',
    items: [
      {
        // Edita el menú público. «Ver carta» (como la ve el cliente) es un
        // botón de la página, para el dueño y para quien edita contenido.
        key: 'carta',
        label: 'Carta',
        href: (s) => `/${s}/menu`,
        icon: 'UtensilsCrossed',
        roles: ['owner', 'editor'],
      },
      {
        // El tablero de tareas de marketing para quien no es dueño (15/11/2026): Contenido y la
        // anfitriona trabajan sus tareas. El dueño entra por «Marketing», donde Tareas es la
        // primera pestaña. Sin `section`: para ellos la sección tendría una sola pestaña.
        key: 'tareas',
        label: 'Tareas',
        href: (s) => `/${s}/tareas`,
        icon: 'ListChecks',
        roles: ['editor', 'host'],
      },
      {
        // Lo que el bar muestra puertas afuera y cómo se organiza el equipo
        // para producirlo: Tareas, Link de Instagram, Páginas y Entradas son
        // pestañas. Owner-only: es la mesa de los socios.
        key: 'marketing',
        label: 'Marketing',
        href: (s) => `/${s}/tareas`,
        icon: 'ListChecks',
        roles: ['owner'],
        section: 'marketing',
        activePaths: (s) => [`/${s}/enlaces`, `/${s}/paginas`, `/${s}/entradas`],
      },
      {
        // Resumen, Cómo nos fue, Señas, Comisiones y Reseñas (con su flag) son
        // pestañas arriba de la página.
        key: 'estadisticas',
        label: 'Estadísticas',
        short: 'Números',
        href: (s) => `/${s}/estadisticas`,
        icon: 'BarChart3',
        roles: ['owner'],
        section: 'estadisticas',
        activePaths: (s) => [`/${s}/reviews`],
      },
    ],
  },
  {
    label: 'Gestión',
    items: [
      {
        // Compras (docs/features/compras.md): los pedidos a proveedores que arma el conteo de la
        // cocina. Insumos, Recetas y Proveedores son pestañas. La cocina cuenta y recibe desde el
        // salón (/salon/stock).
        key: 'compras',
        label: 'Compras',
        href: (s) => `/${s}/compras`,
        icon: 'ShoppingBasket',
        roles: ['owner'],
        feature: 'purchasing',
        section: 'compras',
      },
      {
        // Contabilidad de la SAS (Sprint 1). Solo con el flag `accounting` y el
        // acceso por persona; la contadora ve SOLO esta entrada. Las seis palabras
        // (Resumen, Compras y pagos, Gastos y sueldos, Ventas, Caja, Contabilidad)
        // las dibuja la sección, así que resalta en cualquier /administracion/*.
        key: 'administracion',
        label: 'Administración',
        short: 'Admin',
        href: (s) => `/${s}/administracion`,
        icon: 'Landmark',
        roles: ['owner', 'accountant'],
        feature: 'accounting',
        accounting: 'read_or_setup',
        section: 'administracion',
      },
    ],
  },
  {
    label: 'Salón',
    items: [
      {
        key: 'salon-en-vivo',
        label: 'Salón en vivo',
        short: 'Salón',
        href: (s) => `/${s}/salon/mesas`,
        icon: 'ClipboardList',
        roles: ['owner'],
        newTab: true,
        feature: 'table_service',
      },
      {
        key: 'cocina',
        label: 'Cocina',
        href: (s) => `/${s}/salon/cocina`,
        icon: 'ChefHat',
        roles: ['owner'],
        newTab: true,
        feature: 'kitchen',
      },
      {
        // Punto de venta: cómo va el día en el salón (ventas, medios de pago, per cápita, cajas).
        key: 'hoy-en-vivo',
        label: 'Hoy en vivo',
        short: 'En vivo',
        href: (s) => `/${s}/local/hoy`,
        icon: 'Activity',
        roles: ['owner'],
        feature: 'pos',
      },
      {
        // Punto de venta: los locales del bar, su lista de apertura y los ajustes de cobro.
        key: 'sucursales',
        label: 'Sucursales',
        href: (s) => `/${s}/local/sucursales`,
        icon: 'Store',
        roles: ['owner'],
        feature: 'pos',
      },
      {
        key: 'plano',
        label: 'Plano y QRs de mesa',
        short: 'Plano',
        href: (s) => `/${s}/local/mesas`,
        icon: 'LayoutGrid',
        roles: ['owner'],
        feature: 'floor_plan',
      },
      {
        key: 'auto-aceptacion',
        label: 'Auto-aceptación',
        short: 'Auto',
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
        key: 'configuracion',
        label: 'Configuración',
        short: 'Ajustes',
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
      key: item.key,
      label: item.label,
      short: item.short,
      href: item.href(slug),
      iconKey: item.icon,
      exact: item.exact,
      newTab: item.newTab,
      activePaths: item.activePaths?.(slug),
      section: item.section,
    })),
  }))
}
