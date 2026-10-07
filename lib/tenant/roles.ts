import { type AccountingAccess, isTenantRole, TENANT_ROLES, type TenantRole } from './types'

/**
 * Fuente ÚNICA de metadata y capacidades por rol. Antes cada página/action
 * hardcodeaba su array de roles y cada form duplicaba sus labels; agregar un
 * rol nuevo era una cacería. Ahora: el enum vive en la DB (tenant_role), los
 * labels y capacidades viven acá, y las RLS espejan estos mismos conjuntos
 * (migración 20260716120100).
 */

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Dueño',
  cashier: 'Cajero',
  waiter: 'Mozo',
  kitchen: 'Cocina',
  editor: 'Contenido',
  host: 'Anfitrión',
  accountant: 'Contabilidad',
}

export const ROLE_DESCRIPTIONS: Record<TenantRole, string> = {
  owner: 'Acceso total: configuración, estadísticas, equipo y todo lo demás.',
  cashier: 'Opera el salón: cierra mesas, carga consumo y gestiona reservas.',
  waiter: 'Atiende mesas: registra clientes y check-in en eventos.',
  kitchen: 'Pantalla de cocina: ve y avanza comandas.',
  editor: 'Edita la carta: fotos, videos, textos, precios y etiquetas. No ve el resto.',
  host: 'Gestiona reservas y eventos, y ve sus propias comisiones.',
  accountant:
    'Ve y exporta Administración: libros, IVA, cuentas corrientes y cajas. No carga ni cambia nada y no ve el resto del panel.',
}

/**
 * Label para mostrar un rol que llega como texto (la vista previa de una
 * invitación, un prop `string`). Un valor que no conocemos se muestra tal cual
 * en vez de romper la pantalla.
 */
export function roleLabel(role: string): string {
  return isTenantRole(role) ? ROLE_LABELS[role] : role
}

/** Roles que operan desde el workspace mobile /salon (bottom tabs). */
export const SALON_ROLES: ReadonlyArray<TenantRole> = ['cashier', 'waiter', 'kitchen']

// ──────────────────────────────────────────────────────────
// Capacidades (importar SIEMPRE estos sets en requireRole,
// nunca arrays inline — las RLS asumen exactamente esto)
// ──────────────────────────────────────────────────────────

/** Edición de la carta: categorías, ítems, media, tags. */
export const MENU_EDIT_ROLES: ReadonlyArray<TenantRole> = ['owner', 'editor']

/** CRUD de reservas + eventos del calendario (instancias). */
export const RESERVATION_STAFF_ROLES: ReadonlyArray<TenantRole> = ['owner', 'cashier', 'host']

/**
 * Catálogo de formatos de evento (`scheduled_event_templates`): crear y editar.
 * El anfitrión arma la agenda del bar, así que también define los formatos —
 * poder crear un "Sushi Libre" pero no corregirle el nombre no es una capacidad
 * usable. Borrar queda del owner (policy `set_owner_write`). Espeja exactamente
 * las policies `set_staff_insert` + `set_host_update` de la DB.
 */
export const TEMPLATE_EDIT_ROLES: ReadonlyArray<TenantRole> = ['owner', 'host']

/** Transiciones de estado / cantidad real de personas (incluye mozos). */
export const RESERVATION_OPERATOR_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'cashier',
  'waiter',
  'host',
]

/** Lecturas operativas del día (capacidad, timeline, eventos del día). */
export const SALON_READ_ROLES: ReadonlyArray<TenantRole> = ['owner', 'cashier', 'waiter', 'host']

/**
 * Validar y entregar un canje del club (escanear el QR del socio, sellar tarjetas).
 * Espeja exactamente lo que enforcean `get_redemption_by_token`,
 * `deliver_reward_redemption` y `add_punch_stamp` en la DB. `host` queda afuera a
 * propósito (gestiona reservas, no la caja); `editor` y `kitchen` tampoco.
 */
export const REDEMPTION_STAFF_ROLES: ReadonlyArray<TenantRole> = ['owner', 'cashier', 'waiter']

/**
 * Administración: prerrequisito de ROL. No alcanza con el rol: además hace
 * falta el acceso por persona (`acc_access`, que llega en
 * `TenantAccess.accounting`) y el flag del bar. La contadora lee y exporta; no
 * escribe nada, tampoco por la base.
 */
export const ACCOUNTING_READ_ROLES: ReadonlyArray<TenantRole> = ['owner', 'accountant']
export const ACCOUNTING_WRITE_ROLES: ReadonlyArray<TenantRole> = ['owner']

/**
 * ¿Puede sumar a alguien como «Contabilidad»? Solo quien administra los accesos
 * de Administración, con el módulo prendido. Lo usan las actions de Equipo
 * (antes de tocar nada con el cliente de servicio, que saltea los triggers) y
 * sus formularios, que esconden la opción si da `false`.
 */
export function canManageAccountant(accounting: Pick<AccountingAccess, 'enabled' | 'admin'>) {
  return accounting.enabled && accounting.admin
}

/**
 * Roles que Equipo ofrece en sus selects, en el orden de `TENANT_ROLES`.
 * «Contabilidad» aparece solo para quien puede sumarla; `keep` lo mantiene
 * igual en la lista (el rol actual de una fila) para que el select no quede en
 * blanco.
 */
export function assignableRoles(canAddAccountant: boolean, keep?: TenantRole): TenantRole[] {
  return TENANT_ROLES.filter((role) => role !== 'accountant' || canAddAccountant || role === keep)
}

// ──────────────────────────────────────────────────────────
// Ruteo del workspace manager por rol
// ──────────────────────────────────────────────────────────

/** Roles acotados del manager: TODOS tienen que tener prefijos (lo chequea el compilador abajo). */
export const SCOPED_MANAGER_ROLES = [
  'editor',
  'host',
  'accountant',
] as const satisfies ReadonlyArray<TenantRole>

type ScopedManagerRole = (typeof SCOPED_MANAGER_ROLES)[number]

/** Home de cada rol al loguearse o al caer en una ruta que no le corresponde. */
export function homePathForRole(role: string, slug: string): string {
  switch (role) {
    case 'editor':
      return `/${slug}/menu`
    case 'host':
      // La anfitriona arranca en la lista de Reservas: es donde trabaja el día
      // (buscar, filtrar, pasar lista). El calendario queda a un toque.
      return `/${slug}/reservas`
    case 'accountant':
      // La contadora vive en Administración: no ve nada más del panel.
      return `/${slug}/administracion`
    case 'cashier':
    case 'waiter':
    case 'kitchen':
      return `/${slug}/salon`
    default:
      return `/${slug}`
  }
}

/**
 * Prefijos (primer segmento después del slug) permitidos en el workspace
 * manager para los roles acotados. El proxy redirige cualquier otra ruta al
 * home del rol; el layout del panel repite el chequeo con el rol real de la
 * base (el JWT puede traer un rol viejo hasta 1 h), y las páginas + RLS siguen
 * siendo la defensa en profundidad. `owner` no aparece: navega libre. Los roles
 * de salón tampoco: viven en /salon.
 *
 * `canAccessManagerPath` mira solo el primer segmento: 'reservas' abre para el
 * host la lista (su home), el alta (/reservas/nuevo) y la ficha
 * (/reservas/[id]); 'eventos', el calendario, desde donde también reserva.
 */
export const MANAGER_SCOPED_PREFIXES: Partial<Record<TenantRole, ReadonlyArray<string>>> = {
  editor: ['menu'],
  host: ['reservas', 'eventos', 'operativo', 'mis-numeros'],
  accountant: ['administracion'],
} satisfies Record<ScopedManagerRole, ReadonlyArray<string>>

/** ¿Puede este rol ver esta ruta del workspace manager? (rest = segmentos post-slug) */
export function canAccessManagerPath(role: string, rest: ReadonlyArray<string>): boolean {
  const scoped = MANAGER_SCOPED_PREFIXES[role as TenantRole]
  if (!scoped) return true
  const head = rest[0]
  if (!head) return false // el home "/" del manager es del owner; los acotados van al suyo
  return scoped.includes(head)
}

/**
 * Sub-rutas de /salon accesibles para roles que NO viven en el salón. El host
 * usa el panel operativo (vista en vivo de reservas) durante el servicio —
 * misma capacidad de lectura que SALON_READ_ROLES.
 */
export function canAccessSalonPath(role: string, rest: ReadonlyArray<string>): boolean {
  if (role === 'host') return rest[1] === 'reservas-operativo'
  return false
}
