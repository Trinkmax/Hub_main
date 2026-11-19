/**
 * Las sucursales en todo el sistema (docs/features/sucursales.md).
 *
 * Un bar tiene una o más sucursales. Cada persona ve las suyas (un dueño o la contadora, todas; el resto, las que un
 * dueño le marca en Equipo; sin marcar, la principal) y este dispositivo recuerda cuál está mirando. El panel puede
 * mirar «Todas»; el salón no, porque es un lugar.
 *
 * Módulo puro (sin I/O): lo comparten el servidor, el navegador y las pruebas.
 */

/** Una sucursal como la ve el sistema fuera de su propia pantalla de ajustes: solo las activas. */
export type BranchRef = {
  id: string
  name: string
  /** Para donde no entra el nombre entero (la píldora de arriba, las etiquetas). Vacío = el nombre. */
  shortName: string | null
  /** Se arma solo del nombre. Es lo que va en los links (`?sucursal=cerro`). */
  slug: string
  /** `#rrggbb` en minúsculas: el color con el que se la reconoce en toda la app. */
  color: string
  address: string | null
  position: number
  /** La principal: a la que cae lo que no dice sucursal. */
  isDefault: boolean
  /** Desde cuándo abre (`yyyy-MM-dd`). Vacío = desde siempre. */
  openedOn: string | null
  /** Cupo general (sillas) cuando la sucursal no tiene plantas. */
  seatCapacity: number | null
}

/**
 * Dónde se usa la sucursal:
 * - `view`: el panel la MIRA (puede ser «Todas»).
 * - `device`: el salón TRABAJA en un lugar (siempre una: el mapa, la caja, la tele, la puerta).
 */
export type BranchSurface = 'view' | 'device'

/**
 * Lo que guarda la cookie del dispositivo (`hub_branch_<bar>`):
 * - `branch`: este dispositivo está en esa sucursal y la mira.
 * - `all`: el panel mira «Todas»; `device` recuerda la última sucursal concreta (la caja y la tele no vuelven a
 *   preguntar). `null` = nunca eligió una.
 */
export type BranchCookie = { kind: 'branch'; id: string } | { kind: 'all'; device: string | null }

/** De dónde salió la sucursal que se mira. */
export type BranchScopeSource =
  /** Un link con `?sucursal=`: vale para esta pantalla, no se guarda. */
  | 'param'
  /** Lo que eligió este dispositivo. */
  | 'cookie'
  /** La persona tiene una sola sucursal. */
  | 'single'
  /** Todavía no eligió (con `needsChoice`) o su rol ve todo de entrada. */
  | 'fallback'
  /** La persona no tiene ninguna sucursal activa. */
  | 'none'

/** Qué sucursal (o cuáles) se está mirando, ya recortado a lo que la persona tiene permitido. */
export type BranchScope = {
  /** Las sucursales activas que esta persona ve, la principal primero. */
  branches: BranchRef[]
  /** La sucursal que se mira. `null` solo en «Todas» (o sin ninguna sucursal). */
  current: BranchRef | null
  /** ¿Mira todas juntas? */
  isAll: boolean
  /** Las sucursales que entran en lo que se mira: `[current]` o todas las que ve. */
  ids: string[]
  /** Ve todas las sucursales del bar (dueño o contadora): en «Todas» no hace falta filtrar. */
  unrestricted: boolean
  /** Tiene más de una sucursal: hay selector. */
  multi: boolean
  /** Puede mirar «Todas» (más de una sucursal y en el panel). */
  canAll: boolean
  /** Tiene varias, nunca eligió en este dispositivo y su rol trabaja en un lugar: la entrada le pregunta. */
  needsChoice: boolean
  /** La sucursal en la que trabaja este dispositivo (la del salón). `null` = todavía no se sabe. */
  device: BranchRef | null
  source: BranchScopeSource
}

/**
 * Lo mínimo para dibujar en el navegador (cruza de servidor a cliente): el selector, las etiquetas, los campos para
 * elegir sucursal al crear algo.
 */
export type BranchScopeClient = Pick<
  BranchScope,
  'branches' | 'isAll' | 'ids' | 'multi' | 'canAll' | 'unrestricted' | 'source'
> & {
  currentId: string | null
  deviceId: string | null
}

export function toClientScope(scope: BranchScope): BranchScopeClient {
  return {
    branches: scope.branches,
    isAll: scope.isAll,
    ids: scope.ids,
    multi: scope.multi,
    canAll: scope.canAll,
    unrestricted: scope.unrestricted,
    source: scope.source,
    currentId: scope.current?.id ?? null,
    deviceId: scope.device?.id ?? null,
  }
}

/** El nombre que entra en lugares chicos. */
export function branchShortLabel(branch: Pick<BranchRef, 'name' | 'shortName'>): string {
  return branch.shortName?.trim() || branch.name
}
