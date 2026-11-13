/**
 * Formas compartidas de «Cocina y aclaraciones» (`/[slug]/menu/cocina`): a qué estación va
 * cada cosa de la carta y qué aclaraciones se le pueden tocar a cada producto.
 *
 * Son las mismas tablas que leen la comanda del mozo y la pantalla de cocina
 * (`kitchen_stations`, `menu_modifier_*`, `station_id` en categorías y productos). La plata va
 * siempre en CENTAVOS enteros; la pantalla muestra y pide pesos.
 */

/** Una estación: un lugar de la cocina con su pantalla («Cocina», «Fríos», «Barra»). */
export type KitchenStation = {
  id: string
  name: string
  /** `#rrggbb`: el color con el que se la reconoce en la cocina y acá. */
  color: string
  position: number
  /** Apagada: ninguna pantalla la puede elegir, pero lo que tenía adentro la sigue nombrando. */
  active: boolean
}

export type CartaCategory = {
  id: string
  name: string
  parentId: string | null
  position: number
  active: boolean
  /** La estación puesta ACÁ. Vacío = sigue a la categoría de arriba. */
  stationId: string | null
}

export type CartaItem = {
  id: string
  name: string
  /** `null` = el producto quedó sin categoría. */
  categoryId: string | null
  position: number
  active: boolean
  priceCents: number
  /** La estación propia del producto. Vacío = la de su categoría. */
  stationId: string | null
}

/** Un grupo de aclaraciones: una pregunta («Punto de la carne») con sus opciones para tocar. */
export type ModifierGroup = {
  id: string
  name: string
  /** `single` = se elige una; `multi` = se pueden tocar varias. */
  selection: 'single' | 'multi'
  /** El producto no se puede pedir sin elegir. */
  required: boolean
  position: number
  active: boolean
}

export type ModifierOption = {
  id: string
  groupId: string
  label: string
  /** Lo que suma al precio. 0 en casi todas. */
  priceDeltaCents: number
  position: number
  active: boolean
}

/** A qué se le ofrece un grupo: a una categoría entera (y lo que cuelga) o a un producto. */
export type ModifierLink = {
  groupId: string
  target: 'category' | 'item'
  targetId: string
}

/** Todo lo que la pantalla necesita, leído de una vez. */
export type KitchenSnapshot = {
  /**
   * Cuándo se leyó (reloj del servidor, ms). La pantalla lo compara con el momento de cada
   * guardado para saber si esta lectura ya lo incluye.
   */
  loadedAt: number
  stations: KitchenStation[]
  categories: CartaCategory[]
  items: CartaItem[]
  groups: ModifierGroup[]
  options: ModifierOption[]
  links: ModifierLink[]
}

/** Poner (o sacar) la estación de una categoría o de un producto. */
export type RouteChange = {
  node: 'category' | 'item'
  id: string
  /** `null` = sin estación propia: vuelve a seguir a lo de arriba. */
  to: string | null
}

/** Por qué una estación no se pudo cambiar. */
export type RouteFailureReason =
  /** La categoría o el producto ya no existe (o no es de este bar). */
  | 'missing'
  /** Alguien lo cambió después de que esta pantalla lo leyera. */
  | 'changed'
  /** La estación elegida ya no existe. */
  | 'station_gone'
  /** La base rechazó la escritura. */
  | 'error'

export type RouteFailure = {
  node: 'category' | 'item'
  id: string
  reason: RouteFailureReason
  /** Con `changed`: la estación que tiene ahora. */
  current?: string | null
}

/** Lo que contesta el servidor al guardar estaciones: qué quedó y qué no, uno por uno. */
export type ApplyRouteResult =
  | {
      ok: true
      /** Reloj del servidor al terminar de escribir (ms). */
      savedAt: number
      applied: RouteChange[]
      failed: RouteFailure[]
    }
  | { ok: false; message: string }

/** Por qué no se guardó algo que no es una estación de la carta. */
export type SaveFailureCode =
  /** Otra persona lo cambió recién: se muestra cómo quedó. */
  | 'changed'
  /** Ya no existe. */
  | 'gone'
  /** Ya hay otra con ese nombre. */
  | 'duplicate'
  /** Tiene productos adentro o ya recibió pedidos: no se borra. */
  | 'in_use'
  | 'error'

/** Lo que contesta el servidor a cualquier otro guardado. */
export type SaveResult<Extra extends object = Record<never, never>> =
  | ({ ok: true; savedAt: number } & Extra)
  | { ok: false; message: string; code: SaveFailureCode }

/** Llave de una categoría o un producto, para marcar qué se está guardando. */
export function nodeKey(node: 'category' | 'item', id: string): string {
  return `${node}:${id}`
}

/** Llave del enganche de un grupo a una categoría o a un producto. */
export function linkKey(link: Pick<ModifierLink, 'groupId' | 'target' | 'targetId'>): string {
  return `${link.groupId}:${link.target}:${link.targetId}`
}
