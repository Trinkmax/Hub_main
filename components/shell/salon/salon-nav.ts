import {
  Banknote,
  Boxes,
  CalendarCheck,
  ChefHat,
  ClipboardList,
  DoorOpen,
  LayoutGrid,
  type LucideIcon,
  QrCode,
  ScanLine,
  User,
} from 'lucide-react'
import type { FeatureKey, TenantFeatures } from '@/lib/platform/features'
import { POS_CASH_ROLES } from '@/lib/pos/cash/roles'
import {
  POS_FLOOR_ROLES,
  POS_KITCHEN_ROLES,
  PURCHASING_KITCHEN_ROLES,
  REDEMPTION_STAFF_ROLES,
  SALON_READ_ROLES,
  TICKET_DOOR_ROLES,
} from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'

/**
 * Fuente ÚNICA de la navegación del salón.
 *
 * La consumen la tab bar (íconos) y el topbar (título de la pantalla actual).
 * Antes el título vivía duplicado en el `PageHeader` de cada página: el mozo
 * leía "HUB! · Hub" arriba y "Validar" abajo, dos barras de chrome para decir
 * lo mismo, y perdía ~120px de pantalla útil en un celular.
 *
 * El orden es el de la operativa real del bar, no el alfabético:
 *   1. Sumar puntos — escanear el QR del socio es lo que más se hace.
 *   2. QR del club  — el mozo lo muestra al cerrar la cuenta.
 *   3. Reservas     — el pase de lista de la noche.
 *   4. Puerta       — las noches de cine: validar las entradas con QR.
 *   5. Stock        — la cocina cuenta el stock y recibe lo que llega (Compras).
 *
 * Con el punto de venta prendido el orden cambia (`POS_ORDER`): manda el salón en vivo, y sumar puntos
 * deja de ser lo primero porque los puntos se suman solos al cobrar.
 *
 * En un celular entran cinco pestañas. Si a alguien le tocan más (el dueño las tiene todas), la quinta
 * es «Más» y abre el resto: ningún nombre se corta con «…» (`splitSalonTabs`).
 */
export type SalonTab = {
  key: string
  /** Label de la tab bar. Corto: entra en ~5rem. */
  label: string
  /** Título que muestra el topbar. Puede ser más descriptivo que el label. */
  title: string
  icon: LucideIcon
  href: (slug: string) => string
  match: (pathname: string, slug: string) => boolean
  roles?: ReadonlyArray<TenantRole>
  feature?: FeatureKey
}

export const SALON_TABS: ReadonlyArray<SalonTab> = [
  {
    // Punto de venta: el mapa en vivo es el inicio del salón (docs/features/pos.md).
    key: 'mapa',
    label: 'Salón',
    title: 'Salón',
    icon: LayoutGrid,
    href: (s) => `/${s}/salon/mapa`,
    match: (p, s) => p.startsWith(`/${s}/salon/mapa`) || p.startsWith(`/${s}/salon/mesa/`),
    roles: POS_FLOOR_ROLES,
    feature: 'pos',
  },
  {
    // La caja del turno: abrir, lo que entró por cada medio, retiros y cerrar contando los billetes.
    key: 'caja',
    label: 'Caja',
    title: 'Caja',
    icon: Banknote,
    href: (s) => `/${s}/salon/caja`,
    match: (p, s) => p.startsWith(`/${s}/salon/caja`),
    roles: POS_CASH_ROLES,
    feature: 'pos',
  },
  {
    // La pantalla de cocina del punto de venta: la misma que va en la tele, desde cualquier celular.
    key: 'tele',
    label: 'Cocina',
    title: 'Cocina',
    icon: ChefHat,
    href: (s) => `/${s}/salon/tele`,
    match: (p, s) => p.startsWith(`/${s}/salon/tele`),
    roles: POS_KITCHEN_ROLES,
    feature: 'pos',
  },
  {
    key: 'escanear',
    label: 'Sumar puntos',
    title: 'Sumar puntos',
    icon: ScanLine,
    href: (s) => `/${s}/salon/escanear`,
    match: (p, s) => p.startsWith(`/${s}/salon/escanear`) || p.startsWith(`/${s}/salon/validar`),
    // Sin `feature`: el club es fidelización, no servicio de mesa. Detrás de
    // `table_service` —apagado en HUB— no aparecería nunca.
    roles: REDEMPTION_STAFF_ROLES,
  },
  {
    key: 'qr-club',
    label: 'QR del club',
    title: 'QR del club',
    icon: QrCode,
    href: (s) => `/${s}/salon/qr-club`,
    match: (p, s) => p.startsWith(`/${s}/salon/qr-club`),
    roles: REDEMPTION_STAFF_ROLES,
  },
  {
    key: 'reservas',
    label: 'Reservas',
    title: 'Reservas de hoy',
    icon: CalendarCheck,
    href: (s) => `/${s}/salon/reservas-operativo`,
    match: (p, s) => p === `/${s}/salon` || p.startsWith(`/${s}/salon/reservas-operativo`),
    // Los mismos que la página deja entrar: la cocina no ve las reservas.
    roles: SALON_READ_ROLES,
  },
  {
    key: 'puerta',
    label: 'Puerta',
    title: 'Puerta',
    icon: DoorOpen,
    href: (s) => `/${s}/salon/puerta`,
    match: (p, s) => p.startsWith(`/${s}/salon/puerta`),
    roles: TICKET_DOOR_ROLES,
    feature: 'ticket_door',
  },
  {
    // Compras: la cocina cuenta el stock y recibe la mercadería (docs/features/compras.md).
    key: 'stock',
    label: 'Stock',
    title: 'Stock y mercadería',
    icon: Boxes,
    href: (s) => `/${s}/salon/stock`,
    match: (p, s) => p.startsWith(`/${s}/salon/stock`),
    roles: PURCHASING_KITCHEN_ROLES,
    feature: 'purchasing',
  },
  {
    key: 'mesas',
    label: 'Mesas',
    title: 'Mesas',
    icon: ClipboardList,
    href: (s) => `/${s}/salon/mesas`,
    match: (p, s) => p === `/${s}/salon/mesas` || p.startsWith(`/${s}/salon/mesas/`),
    feature: 'table_service',
  },
  {
    key: 'cocina',
    label: 'Cocina',
    title: 'Cocina',
    icon: ChefHat,
    href: (s) => `/${s}/salon/cocina`,
    match: (p, s) => p.startsWith(`/${s}/salon/cocina`),
    roles: ['owner', 'cashier', 'kitchen'],
    feature: 'kitchen',
  },
  {
    key: 'mi-turno',
    label: 'Mi turno',
    title: 'Mi turno',
    icon: User,
    href: (s) => `/${s}/salon/mi-turno`,
    match: (p, s) => p.startsWith(`/${s}/salon/mi-turno`),
    feature: 'table_service',
  },
]

/**
 * El orden con el punto de venta: el salón, la plata, quién llega, la cocina; después lo del club y lo
 * que es de algunas noches. Lo que no figura acá queda al final, en su orden de siempre.
 */
const POS_ORDER: ReadonlyArray<string> = [
  'mapa',
  'caja',
  'reservas',
  'tele',
  'escanear',
  'qr-club',
  'puerta',
  'stock',
]

export function visibleSalonTabs(opts: {
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
}): SalonTab[] {
  const tabs = SALON_TABS.filter((tab) => {
    const roleOk = !tab.roles || tab.roles.includes(opts.role)
    const featureOk = !tab.feature || opts.isPlatformAdmin || opts.features[tab.feature]
    return roleOk && featureOk
  })
  if (!tabs.some((tab) => tab.feature === 'pos')) return tabs
  const rank = (key: string) => {
    const at = POS_ORDER.indexOf(key)
    return at === -1 ? POS_ORDER.length : at
  }
  // `sort` es estable: lo que empata (lo que no está en la lista) conserva su orden.
  return [...tabs].sort((a, b) => rank(a.key) - rank(b.key))
}

/** Cuántas pestañas entran abajo en un celular sin cortar ningún nombre. */
export const SALON_TABBAR_SLOTS = 5

/**
 * Qué va en la barra y qué detrás de «Más». Con cinco o menos, todas en la barra. Con más, cuatro y
 * «Más»: las primeras del orden, que son las que más se usan.
 */
export function splitSalonTabs(tabs: ReadonlyArray<SalonTab>): {
  bar: SalonTab[]
  more: SalonTab[]
} {
  if (tabs.length <= SALON_TABBAR_SLOTS) return { bar: [...tabs], more: [] }
  return {
    bar: tabs.slice(0, SALON_TABBAR_SLOTS - 1),
    more: tabs.slice(SALON_TABBAR_SLOTS - 1),
  }
}

/** Título de la pantalla actual para el topbar. `null` = usar el nombre del bar. */
export function salonTitleFor(pathname: string, slug: string): string | null {
  return SALON_TABS.find((t) => t.match(pathname, slug))?.title ?? null
}
