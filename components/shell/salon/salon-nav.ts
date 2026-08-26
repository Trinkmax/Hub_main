import {
  CalendarCheck,
  ChefHat,
  ClipboardList,
  type LucideIcon,
  QrCode,
  ScanLine,
  User,
} from 'lucide-react'
import type { FeatureKey, TenantFeatures } from '@/lib/platform/features'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
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

export function visibleSalonTabs(opts: {
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
}): SalonTab[] {
  return SALON_TABS.filter((tab) => {
    const roleOk = !tab.roles || tab.roles.includes(opts.role)
    const featureOk = !tab.feature || opts.isPlatformAdmin || opts.features[tab.feature]
    return roleOk && featureOk
  })
}

/** Título de la pantalla actual para el topbar. `null` = usar el nombre del bar. */
export function salonTitleFor(pathname: string, slug: string): string | null {
  return SALON_TABS.find((t) => t.match(pathname, slug))?.title ?? null
}
