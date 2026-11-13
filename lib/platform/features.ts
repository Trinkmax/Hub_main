import type { Tenant } from '@/lib/tenant/types'

/**
 * Feature flags = "panel de visibilidad" controlado por superadmins.
 *
 * Defaults viven ACÁ (no en DB). En `tenants.feature_flags` solo se guardan los
 * overrides → agregar una key nueva no requiere backfill: lo no guardado cae al
 * default del registry. Módulo PURO (sin I/O) para poder usarse en el render de
 * la nav sin round-trips extra (el tenant ya viene de requireTenantAccess).
 */
export type FeatureKey =
  | 'table_service' // salón en vivo (mesas) + mi-turno
  | 'floor_plan' // editor de plano /local/mesas
  | 'table_qr' // QRs por mesa /local/captura + /print/qr* + auto-pedido /m
  | 'auto_accept' // auto-aceptación de comandas /local/auto-aceptacion
  | 'kitchen' // pantalla de cocina /salon/cocina
  | 'reviews' // panel de reseñas del manager (Fase 4)
  | 'accounting' // Administración: contabilidad de la SAS /administracion (Sprint 1)
  | 'ticket_door' // puerta: validar con QR las entradas compradas online /salon/puerta
  | 'purchasing' // compras: conteo de stock, pedidos a proveedores y recepción /compras + /salon/stock
  | 'pos' // punto de venta: mapa en vivo, comanda, cocina, cobro y caja (docs/features/pos.md)

export type FeatureGroup = 'Salón' | 'Fidelización' | 'Administración'

export type FeatureDef = {
  key: FeatureKey
  label: string
  description: string
  group: FeatureGroup
  /** Las features operativas arrancan OFF en el producto loyalty-first. */
  defaultEnabled: boolean
}

export const FEATURE_REGISTRY: Readonly<Record<FeatureKey, FeatureDef>> = {
  table_service: {
    key: 'table_service',
    label: 'Servicio de mesa',
    description: 'Salón en vivo, sesiones de mesa y "mi turno" del staff.',
    group: 'Salón',
    defaultEnabled: false,
  },
  floor_plan: {
    key: 'floor_plan',
    label: 'Plano del salón',
    description: 'Editor de plano y disposición de mesas.',
    group: 'Salón',
    defaultEnabled: false,
  },
  table_qr: {
    key: 'table_qr',
    label: 'QR por mesa',
    description: 'Generación/impresión de QRs de mesa y auto-pedido (/m).',
    group: 'Salón',
    defaultEnabled: false,
  },
  auto_accept: {
    key: 'auto_accept',
    label: 'Auto-aceptación',
    description: 'Aceptación automática de comandas bajo umbral.',
    group: 'Salón',
    defaultEnabled: false,
  },
  kitchen: {
    key: 'kitchen',
    label: 'Cocina',
    description: 'Pantalla de cocina y flujo de tickets.',
    group: 'Salón',
    defaultEnabled: false,
  },
  reviews: {
    key: 'reviews',
    label: 'Reseñas',
    description: 'Panel de reseñas y pedido de reseña al cliente.',
    group: 'Fidelización',
    defaultEnabled: false,
  },
  ticket_door: {
    key: 'ticket_door',
    label: 'Puerta (entradas con QR)',
    description: 'Pestaña del salón para validar con QR las entradas compradas online.',
    group: 'Salón',
    defaultEnabled: false,
  },
  purchasing: {
    key: 'purchasing',
    label: 'Compras',
    description:
      'La cocina cuenta el stock y recibe la mercadería; el dueño revisa los pedidos y los manda por WhatsApp.',
    group: 'Administración',
    defaultEnabled: false,
  },
  pos: {
    key: 'pos',
    label: 'Punto de venta',
    description:
      'El salón en vivo: mapa de mesas por sucursal, comanda del mozo, pantalla de cocina, cobro y caja por turno. Trae el plano del salón.',
    group: 'Salón',
    defaultEnabled: false,
  },
  // El interruptor de emergencia de todo el módulo: apagado, las RLS no
  // devuelven nada, las RPC dan `accounting_not_enabled` y /administracion da
  // 404. A diferencia del resto, prenderlo no le abre nada al superadmin por
  // serlo: además tiene que ser dueño con acceso (lo decide la base).
  accounting: {
    key: 'accounting',
    label: 'Administración',
    description: 'Contabilidad de la SAS: compras, pagos, ventas, cajas, IVA y libros.',
    group: 'Administración',
    defaultEnabled: false,
  },
} as const

export const FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[]

export type TenantFeatures = Record<FeatureKey, boolean>

/** Merge de overrides guardados sobre los defaults de código. Puro y síncrono. */
export function getTenantFeatures(tenant: Pick<Tenant, 'feature_flags'>): TenantFeatures {
  const stored = (tenant.feature_flags ?? {}) as Partial<Record<FeatureKey, boolean>>
  const out = {} as TenantFeatures
  for (const key of FEATURE_KEYS) {
    out[key] =
      typeof stored[key] === 'boolean'
        ? (stored[key] as boolean)
        : FEATURE_REGISTRY[key].defaultEnabled
  }
  return out
}

/**
 * Lo que un interruptor trae consigo. El punto de venta no existe sin el plano del salón (el mapa en vivo
 * se dibuja ahí): prenderlo alcanza, no hace falta acordarse de prender también el plano.
 */
const INCLUDES: Partial<Record<FeatureKey, readonly FeatureKey[]>> = {
  pos: ['floor_plan'],
}

/**
 * Lo que el bar tiene de verdad: sus interruptores más lo que cada uno trae. Es lo que miran los menús,
 * el buscador y las guardas. `getTenantFeatures` sigue siendo la posición de cada interruptor, que es lo
 * que muestra (y cambia) el panel de superadmin.
 */
export function getEffectiveFeatures(tenant: Pick<Tenant, 'feature_flags'>): TenantFeatures {
  const out = getTenantFeatures(tenant)
  for (const key of FEATURE_KEYS) {
    if (!out[key]) continue
    for (const included of INCLUDES[key] ?? []) out[included] = true
  }
  return out
}

export function isFeatureEnabled(tenant: Pick<Tenant, 'feature_flags'>, key: FeatureKey): boolean {
  return getEffectiveFeatures(tenant)[key]
}

/** Agrupa el registry para la grilla de toggles del panel /admin. */
export function featuresByGroup(): Record<FeatureGroup, FeatureDef[]> {
  const groups = {} as Record<FeatureGroup, FeatureDef[]>
  for (const key of FEATURE_KEYS) {
    const def = FEATURE_REGISTRY[key]
    const list = groups[def.group] ?? []
    list.push(def)
    groups[def.group] = list
  }
  return groups
}
