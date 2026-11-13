/**
 * Formas compartidas de «Precios» (`/[slug]/menu/precios`): la pantalla donde los dueños
 * buscan un producto y le cambian el precio sin depender de nadie.
 *
 * La plata va siempre en CENTAVOS enteros; la pantalla muestra y pide pesos.
 */

/** Una categoría de la carta: lo justo para agrupar y armar el camino («Comida › Pizza»). */
export type PriceCategory = {
  id: string
  name: string
  parentId: string | null
  position: number
  active: boolean
}

export type PriceItem = {
  id: string
  name: string
  /** `null` = el producto quedó sin categoría. */
  categoryId: string | null
  /** El precio de la carta: vale en todas las sucursales que no tengan uno propio. */
  priceCents: number
  position: number
  active: boolean
}

export type PriceBranch = {
  id: string
  name: string
  /** Para donde no entra el nombre entero. */
  shortName: string | null
  slug: string
  /** `#rrggbb`: el color con el que se reconoce la sucursal en toda la app. */
  color: string
  isDefault: boolean
}

/** Lo que un producto tiene de distinto en una sucursal. Sin fila, vale la carta. */
export type BranchOverride = {
  branchId: string
  itemId: string
  /** `null` = el precio de la carta. */
  priceCents: number | null
  /** Si se vende en esa sucursal. */
  available: boolean
}

/** Todo lo que la pantalla necesita, leído de una vez. */
export type PriceSnapshot = {
  /**
   * Cuándo se leyó (reloj del servidor, ms). La pantalla lo compara con el momento de cada
   * guardado para saber si esta lectura ya lo incluye.
   */
  loadedAt: number
  categories: PriceCategory[]
  items: PriceItem[]
  branches: PriceBranch[]
  overrides: BranchOverride[]
}

/** `null` = «Toda la carta»; si no, la sucursal que se está mirando. */
export type ViewId = string | null

/**
 * Un precio escrito en la base: el de la carta (`branchId` vacío) o el propio de una
 * sucursal. Es la unidad de todo lo que se guarda, se deshace y se cuenta.
 */
export type PriceChange = {
  itemId: string
  branchId: string | null
  /** Lo que había. En una sucursal, `null` = seguía el precio de la carta. */
  fromCents: number | null
  /** Lo que queda. En una sucursal, `null` = vuelve al precio de la carta. */
  toCents: number | null
}

/** Por qué un precio no se pudo cambiar. */
export type PriceFailureReason =
  /** El producto ya no existe (o no es de este bar). */
  | 'missing'
  /** Alguien lo cambió después de que esta pantalla lo leyera. */
  | 'changed'
  /** La base rechazó la escritura. */
  | 'error'

export type PriceWriteFailure = {
  itemId: string
  branchId: string | null
  reason: PriceFailureReason
  /** Con `changed`: lo que hay ahora en ese precio, para mostrar la verdad. */
  currentCents?: number | null
}

/** Lo que contesta el servidor al guardar precios: qué quedó y qué no, uno por uno. */
export type ApplyPricesResult =
  | {
      ok: true
      /** Reloj del servidor al terminar de escribir (ms). */
      savedAt: number
      applied: PriceChange[]
      failed: PriceWriteFailure[]
    }
  | { ok: false; message: string }

export type SetAvailabilityResult =
  | { ok: true; savedAt: number; itemIds: string[] }
  | { ok: false; message: string }

/** Llave de un precio: el de la carta o el propio de una sucursal. */
export function pointKey(branchId: string | null, itemId: string): string {
  return `${branchId ?? 'carta'}:${itemId}`
}
