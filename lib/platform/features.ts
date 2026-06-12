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

export type FeatureGroup = 'Salón' | 'Fidelización'

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

export function isFeatureEnabled(tenant: Pick<Tenant, 'feature_flags'>, key: FeatureKey): boolean {
  return getTenantFeatures(tenant)[key]
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
