/**
 * Links y parámetros de «Compras y proveedores» (H.7). Puro: lo usan las
 * páginas, las tablas y las hojas de acción rápida.
 */

export const COMPRAS_TABS = ['proveedores', 'comprobantes', 'pagos', 'gastos-fijos'] as const
export type ComprasTab = (typeof COMPRAS_TABS)[number]

export function isComprasTab(value: unknown): value is ComprasTab {
  return typeof value === 'string' && (COMPRAS_TABS as readonly string[]).includes(value)
}

/** `searchParams` de Next trae un string o una lista: vale el primero, recortado. */
export function firstParam(value: string | string[] | undefined | null): string {
  const v = Array.isArray(value) ? value[0] : value
  return (v ?? '').trim()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function administracionHref(slug: string): string {
  return `/${slug}/administracion`
}

export function comprasHref(
  slug: string,
  tab: ComprasTab = 'proveedores',
  extra: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const params = new URLSearchParams()
  if (tab !== 'proveedores') params.set('tab', tab)
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/${slug}/administracion/compras${query ? `?${query}` : ''}`
}

export function supplierHref(slug: string, partyId: string, tab?: string): string {
  const base = `/${slug}/administracion/compras/proveedores/${partyId}`
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base
}

/** El detalle de cualquier comprobante (H.14). */
export function documentHref(slug: string, documentId: string): string {
  return `/${slug}/administracion/comprobantes/${documentId}`
}

export function recurringHref(slug: string, id: string | 'nuevo'): string {
  return `/${slug}/administracion/compras/gastos-fijos/${id}`
}

export type NewPurchaseParams = {
  /** `factura` (default) · `nc` · `nd`. */
  tipo?: 'factura' | 'nc' | 'nd'
  proveedor?: string | null
  relacionada?: string | null
  gastoFijo?: string | null
  /** A dónde vuelve al guardar o cancelar (una ruta de Administración del mismo bar). */
  volver?: string | null
}

export function newPurchaseHref(slug: string, params: NewPurchaseParams = {}): string {
  const search = new URLSearchParams()
  if (params.tipo && params.tipo !== 'factura') search.set('tipo', params.tipo)
  if (params.proveedor) search.set('proveedor', params.proveedor)
  if (params.relacionada) search.set('relacionada', params.relacionada)
  if (params.gastoFijo) search.set('gasto-fijo', params.gastoFijo)
  if (params.volver) search.set('volver', params.volver)
  const query = search.toString()
  return `/${slug}/administracion/compras/nueva${query ? `?${query}` : ''}`
}

/**
 * `?volver=` solo si es una ruta de Administración de ESTE bar (nada de
 * dominios ni de otras secciones): si no, el listado de comprobantes.
 */
export function safeReturnHref(slug: string, raw: string | null | undefined): string {
  const base = `/${slug}/administracion`
  const value = (raw ?? '').trim()
  if (
    value.startsWith(`${base}/`) &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.includes('://') &&
    value.length <= 300
  ) {
    return value
  }
  return comprasHref(slug, 'comprobantes')
}
