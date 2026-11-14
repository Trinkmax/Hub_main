import { type AccountingAccess, isTenantRole, TENANT_ROLES, type TenantRole } from './types'

/**
 * «Ver como»: un superadmin que es dueño del bar mira el panel con el rol de otra persona del
 * equipo, para grabar tutoriales (pedido de Ignacio Baldovino del 13/11/2026). Ver
 * docs/features/ver-como.md.
 *
 * Vive en la app, no en la base, y SOLO BAJA permisos:
 *   · `requireTenantAccess` devuelve el rol elegido, así el menú, las pantallas y cada
 *     `requireRole` de las actions se comportan como para esa persona;
 *   · el proxy rutea con ese rol (al salón, a la carta, a Reservas…);
 *   · la sesión de Supabase sigue siendo la del dueño, así que la RLS lo deja hacer todo lo
 *     que hace un dueño: lo que la app ya no le muestra, la base igual se lo permitiría.
 *
 * Módulo PURO (sin `server-only`): lo usan el proxy, el server y los tests.
 */

/** La cookie: `<id del usuario>:<rol>`. httpOnly; la escribe y la borra `setViewAs`. */
export const VIEW_AS_COOKIE = 'hub_view_as'

/** 12 horas: alcanza para una tarde de grabación y no queda prendida días. */
export const VIEW_AS_MAX_AGE_SECONDS = 12 * 60 * 60

/** Los roles que se pueden mirar. «Dueño» no está: volver a dueño es salir del modo. */
export const VIEW_AS_ROLES: ReadonlyArray<TenantRole> = TENANT_ROLES.filter(
  (role) => role !== 'owner',
)

/**
 * Las opciones del selector, en el orden en que se muestran, con adónde lleva cada una: primero
 * los que trabajan en el panel y después los del salón. Dueño va primero: es volver a ver todo.
 */
export const VIEW_AS_CHOICES: ReadonlyArray<{ role: TenantRole; lands: string }> = [
  { role: 'owner', lands: 'Todo el panel' },
  { role: 'host', lands: 'Reservas' },
  { role: 'editor', lands: 'Carta' },
  { role: 'accountant', lands: 'Administración' },
  { role: 'cashier', lands: 'Salón' },
  { role: 'waiter', lands: 'Salón' },
  { role: 'kitchen', lands: 'Cocina' },
]

export function encodeViewAs(userId: string, role: TenantRole): string {
  return `${userId}:${role}`
}

/**
 * El rol que la cookie pide mirar, o `null`. Solo vale para el usuario que la pidió: si en la
 * misma compu después entra otra persona, no la hereda. Un rol que no existe, o «dueño», no
 * cuenta.
 */
export function readViewAs(
  raw: string | null | undefined,
  userId: string | null | undefined,
): TenantRole | null {
  if (!raw || !userId) return null
  const separator = raw.lastIndexOf(':')
  if (separator <= 0) return null
  if (raw.slice(0, separator) !== userId) return null
  const role = raw.slice(separator + 1)
  if (!isTenantRole(role) || role === 'owner') return null
  return role
}

/**
 * ¿Puede usar «Ver como» en este bar? Superadmin y dueño de ESE bar: así el rol que mira
 * siempre tiene menos permisos que el suyo.
 */
export function canViewAs(realRole: TenantRole, isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin && realRole === 'owner'
}

/**
 * Administración como la ve ese rol. La contadora lee (si el dueño lee) pero no carga, no
 * cierra meses ni da accesos; el resto del equipo no la ve.
 */
export function accountingAs(real: AccountingAccess, role: TenantRole): AccountingAccess {
  if (role === 'owner') return real
  return {
    enabled: real.enabled,
    setUp: real.setUp,
    read: role === 'accountant' && real.read,
    write: false,
    admin: false,
    canSetUp: false,
  }
}

export type ViewAsResolution = {
  /** El rol con el que la app muestra y autoriza. */
  role: TenantRole
  /** El rol de verdad en el bar. */
  realRole: TenantRole
  /** El rol que se está mirando, o null. */
  viewAs: TenantRole | null
  /** Puede usar el selector en este bar. */
  canViewAs: boolean
  /** Mirando otro rol no es superadmin: no se le abren los paneles ocultos del bar. */
  isPlatformAdmin: boolean
  accounting: AccountingAccess
}

/** Lo que devuelve la base + la cookie → con qué rol se ve el panel. */
export function resolveViewAs(input: {
  realRole: TenantRole
  isPlatformAdmin: boolean
  accounting: AccountingAccess
  cookie: string | null | undefined
  userId: string
}): ViewAsResolution {
  const allowed = canViewAs(input.realRole, input.isPlatformAdmin)
  const viewAs = allowed ? readViewAs(input.cookie, input.userId) : null
  if (!viewAs) {
    return {
      role: input.realRole,
      realRole: input.realRole,
      viewAs: null,
      canViewAs: allowed,
      isPlatformAdmin: input.isPlatformAdmin,
      accounting: input.accounting,
    }
  }
  return {
    role: viewAs,
    realRole: input.realRole,
    viewAs,
    canViewAs: true,
    isPlatformAdmin: false,
    accounting: accountingAs(input.accounting, viewAs),
  }
}

/**
 * El rol con el que el PROXY rutea. No puede saber si es superadmin (eso está en la base), así
 * que acepta la cookie de cualquier dueño: como solo baja permisos, alguien que se la fabrique
 * solo se manda a sí mismo a una pantalla menor. Las páginas, con la base, la ignoran si no es
 * superadmin.
 */
export function routingRole(
  claimRole: string | null,
  cookie: string | null | undefined,
  userId: string,
): string | null {
  if (claimRole !== 'owner') return claimRole
  return readViewAs(cookie, userId) ?? claimRole
}
