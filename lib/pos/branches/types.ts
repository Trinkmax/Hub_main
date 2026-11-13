/**
 * Formas compartidas de «Sucursales» (`/[bar]/local/sucursales`): los locales del bar, cada
 * uno con su color, y lo que le falta a cada uno para abrir.
 *
 * Un bar tiene sucursales; la carta, el club, los clientes y el equipo son del bar, y el
 * mapa, las mesas, la cocina y las cajas son de cada sucursal (docs/features/pos.md).
 */

import type { PosSettings } from '@/lib/pos/settings/types'

/** Una sucursal como la lee esta pantalla: todas, también las desactivadas. */
export type Branch = {
  id: string
  name: string
  /** Para donde no entra el nombre entero (la barra del salón). Vacío = se usa el nombre. */
  shortName: string | null
  /** Se arma solo del nombre al crearla. Solo se ve en el link de la tele. */
  slug: string
  /** `#rrggbb`: el color con el que se la reconoce en toda la app. */
  color: string
  address: string | null
  position: number
  /** La principal: a la que cae todo lo que no dice sucursal (reservas, sectores). */
  isDefault: boolean
  active: boolean
  /** Reloj de la base: la versión de la fila, para no pisar un cambio ajeno. */
  updatedAt: string
  /** Hasta cuándo está en modo práctica (`null` o pasado = no está). Lo pone `pos_set_practice`. */
  practiceUntil?: string | null
}

/** Lo que una sucursal tiene cargado: de acá salen los pasos de su lista de apertura. */
export type BranchFacts = {
  /** Sectores dibujados en el plano. */
  sectors: number
  /** Mesas activas puestas en el plano. */
  tables: number
  /** Mesas activas que existen pero todavía no están en el plano. */
  looseTables: number
  /** Mesas abiertas en este momento. */
  openTables: number
  /** ¿Alguna vez tuvo una mesa abierta? Con historia no se borra: se desactiva. */
  hasHistory: boolean
  /** Productos de la carta que no se venden acá. */
  unavailable: number
  /** Productos con precio propio en esta sucursal. */
  ownPrices: number
  /** Cuándo una pantalla de cocina mostró por última vez un pedido de acá. `null` = nunca. */
  kitchenSeenAt: string | null
  /** Cajas activas. `null` = la caja todavía no llegó (llega con el cobro). */
  registers: number | null
}

/** La carta del bar, en lo que le importa a la apertura. Es una sola para todas las sucursales. */
export type MenuFacts = {
  /** Productos que se pueden pedir: activos y con categoría. */
  products: number
  /** Estaciones de cocina activas, en su orden. */
  stations: Array<{ id: string; name: string; color: string }>
  /** Categorías con productos que no llegan a ninguna estación. */
  unassigned: Array<{ id: string; name: string; products: number }>
}

/** Cuánta gente hay por rol. El equipo es del bar, no de una sucursal. */
export type TeamFacts = {
  owner: number
  cashier: number
  waiter: number
  kitchen: number
  host: number
}

/** Lo que el bar ya tiene cargado en otro lado y sirve acá: nadie lo escribe dos veces. */
export type Borrowed = {
  /** El alias de transferencias que ya usan las entradas online. */
  transferAlias: string | null
  transferHolder: string | null
}

/** Todo lo que la pantalla necesita, leído de una vez. */
export type BranchBoardSnapshot = {
  /**
   * Cuándo se leyó (reloj del servidor, ms). La pantalla lo compara con el momento de cada
   * guardado para saber si esta lectura ya lo incluye.
   */
  loadedAt: number
  branches: Branch[]
  /** Por id de sucursal. */
  facts: Record<string, BranchFacts>
  menu: MenuFacts
  team: TeamFacts
  settings: PosSettings
  borrowed: Borrowed
}

/** Un dato de la sucursal que se cambia desde su ficha. */
export type BranchField = 'name' | 'shortName' | 'color' | 'address' | 'active'

export type BranchValues = {
  name: string
  shortName: string | null
  color: string
  address: string | null
  active: boolean
}

/** Un cambio pedido: qué dato, qué valor nuevo y qué valor veía la persona en la pantalla. */
export type BranchChange = {
  [K in BranchField]: { field: K; value: BranchValues[K]; expected: BranchValues[K] }
}[BranchField]

/** Por qué no se pudo guardar. */
export type BranchFailure =
  /** Otra persona lo cambió después de que esta pantalla lo leyera. */
  | 'changed'
  /** La sucursal ya no existe. */
  | 'gone'
  /** El dato no pasa las reglas (un nombre repetido, un color que no se lee). */
  | 'invalid'
  /** Una regla del negocio lo impide (tiene mesas abiertas, es la principal). */
  | 'blocked'
  /** Sin permiso o sin sesión. */
  | 'forbidden'
  /** La base no lo guardó. */
  | 'error'

export type BranchWriteResult =
  | {
      ok: true
      /** Reloj del servidor al terminar de escribir (ms). */
      savedAt: number
      /** La fila como quedó. */
      branch: Branch
    }
  | {
      ok: false
      code: BranchFailure
      /** Qué pasó y qué hacer, listo para mostrar. */
      message: string
      /** Con `changed`: la fila como está ahora, para mostrar la verdad. */
      current?: Branch
    }

export type BranchListResult =
  | { ok: true; savedAt: number; branches: Branch[] }
  | { ok: false; code: BranchFailure; message: string }

export type BranchDeleteResult =
  | { ok: true; savedAt: number; branchId: string }
  | { ok: false; code: BranchFailure; message: string }
