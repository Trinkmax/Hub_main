/**
 * Links y parámetros de «Compras y pagos» (H.7) y de «Gastos fijos». Puro: lo
 * usan las páginas, las tablas y las hojas de acción rápida.
 */

/** Las pestañas de la pantalla de Compras. «Gastos fijos» es pestaña de Administración desde el 12/10/2026. */
export const COMPRAS_TABS = ['proveedores', 'comprobantes', 'pagos'] as const
export type ComprasTab = (typeof COMPRAS_TABS)[number]

/** Lo que `comprasHref` sabe armar: sus pestañas y, por los links de antes, «Gastos fijos». */
export type ComprasTarget = ComprasTab | 'gastos-fijos'

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

/** La lista de gastos fijos: pestaña propia de Administración (pedido de los socios, 12/10/2026). */
export function gastosFijosHref(
  slug: string,
  extra: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/${slug}/administracion/gastos-fijos${query ? `?${query}` : ''}`
}

/**
 * «Completar la planilla»: los montos y los días de todos los gastos fijos de
 * corrido. `ver` = `sin-monto` · `todos` · `varios`; `foco` = el gasto fijo que
 * abre con el cursor puesto.
 */
export function gastosFijosFillHref(
  slug: string,
  extra: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/${slug}/administracion/gastos-fijos/completar${query ? `?${query}` : ''}`
}

/** Una pestaña de Compras. Con `'gastos-fijos'` devuelve la lista nueva (no es más una pestaña de acá). */
export function comprasHref(
  slug: string,
  tab: ComprasTarget = 'proveedores',
  extra: Readonly<Record<string, string | null | undefined>> = {},
): string {
  if (tab === 'gastos-fijos') return gastosFijosHref(slug, extra)
  const params = new URLSearchParams()
  if (tab !== 'proveedores') params.set('tab', tab)
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/${slug}/administracion/compras${query ? `?${query}` : ''}`
}

/**
 * `…/compras?tab=gastos-fijos` (links guardados, avisos de antes) → la lista
 * nueva, con lo demás que traía la URL (`?accion=`). `null` si no hay que
 * redirigir.
 */
export function legacyComprasRedirect(
  slug: string,
  sp: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  if (firstParam(sp.tab) !== 'gastos-fijos') return null
  const extra: Record<string, string> = {}
  for (const [key, value] of Object.entries(sp)) {
    if (key === 'tab') continue
    const first = firstParam(value)
    if (first) extra[key] = first
  }
  return gastosFijosHref(slug, extra)
}

export function supplierHref(slug: string, partyId: string, tab?: string): string {
  const base = `/${slug}/administracion/compras/proveedores/${partyId}`
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base
}

/** El detalle de cualquier comprobante (H.14). */
export function documentHref(slug: string, documentId: string): string {
  return `/${slug}/administracion/comprobantes/${documentId}`
}

/** El alta o la edición de un gasto fijo. El formulario conserva su ruta; la lista es `gastosFijosHref`. */
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
