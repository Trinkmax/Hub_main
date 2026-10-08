import 'server-only'

import type { AccFailureState } from '@/lib/accounting/action-state'
import {
  type AccErrorKey,
  isAccErrorKey,
  mapAccError,
  type PgLikeError,
} from '@/lib/accounting/errors'

/**
 * Lo mínimo que ARCA necesita de la base: llamar una RPC `acc_*` con la sesión de
 * la persona (cliente de `@/lib/supabase/server`, nunca `service_role`) y traducir
 * sus errores al catálogo de Administración (`mapAccError`).
 *
 * Está separado de `session.ts` y `secrets.ts` para que los dos lo usen sin
 * importarse entre sí, y para que los tests pasen una RPC falsa.
 *
 * Nunca se loguean los argumentos de una RPC: llevan la clave del servidor, la
 * clave privada o el ticket del WSAA.
 */

export type ArcaRpcResult = { data: unknown; error: PgLikeError | null }

/** Una RPC de Supabase: `(nombre, parámetros) → { data, error }` (PostgREST no tira). */
export type ArcaRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<ArcaRpcResult>

/** Lo que hace falta de un cliente de Supabase para armar un `ArcaRpc`. */
export type RpcCapable = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<ArcaRpcResult>
}

/** El `ArcaRpc` de un cliente de Supabase (el de la sesión de la persona). */
export function rpcOf(client: RpcCapable): ArcaRpc {
  return (fn, args) => client.rpc(fn, args)
}

/**
 * Un error de la base (o de la red hacia la base) en un camino de ARCA: la RPC
 * rechazó el pedido (`secret_unreadable`, `arca_not_ready`, `arca_lease_lost`…) o
 * no hubo respuesta. No es un error de ARCA: se muestra con el texto del catálogo
 * de Administración (`state`).
 *
 * `message` es solo `ARCA store: <operación> <clave>`, apto para un log: nunca lleva
 * el detalle de Postgres (puede traer datos de la fila) ni los argumentos.
 */
export class ArcaStoreError extends Error {
  /** La RPC o la tabla. */
  readonly op: string
  /** La clave del catálogo, si se reconoció. */
  readonly key: AccErrorKey | null
  /** SQLSTATE o código de PostgREST, para el log. */
  readonly pgCode: string | null
  /** El estado listo para devolver desde una acción. */
  readonly state: AccFailureState

  /**
   * `error`: lo que devolvió PostgREST (o `null`). `key`: una clave puesta a mano
   * (p. ej. la RPC contestó algo que no se puede leer) que gana sobre la del error.
   */
  constructor(op: string, error: PgLikeError | null, key: AccErrorKey | null = null) {
    // Una clave puesta a mano se traduce igual que si la hubiera levantado la RPC.
    const state = mapAccError(key ? { message: key, code: 'P0001' } : error)
    const mapped = typeof state.detail?.key === 'string' ? state.detail.key : null
    const resolved = isAccErrorKey(mapped) ? mapped : null
    super(`ARCA store: ${op} ${resolved ?? error?.code ?? 'error'}`)
    this.name = 'ArcaStoreError'
    this.op = op
    this.key = resolved
    this.pgCode = error?.code ?? null
    this.state = state
  }
}

export function isArcaStoreError(e: unknown): e is ArcaStoreError {
  return e instanceof ArcaStoreError || (e instanceof Error && e.name === 'ArcaStoreError')
}

/**
 * Llama una RPC y devuelve `data`. Un error de la base → `ArcaStoreError`. Si el
 * cliente tira (red), también: con la clave `offline` si el texto lo dice.
 */
export async function callArcaRpc(
  rpc: ArcaRpc,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: ArcaRpcResult
  try {
    result = await rpc(fn, args)
  } catch (e) {
    // El texto de un error de red no lleva los argumentos; igual se recorta.
    const message = e instanceof Error ? e.message.slice(0, 120) : 'network error'
    throw new ArcaStoreError(fn, { message, code: null })
  }
  if (result.error) throw new ArcaStoreError(fn, result.error)
  return result.data
}

// ─── Lectura defensiva de lo que devuelven las RPC ───────────────────────────

export type Rec = Record<string, unknown>

export function asRec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null
}

export function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function intOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d{1,15}$/.test(value.trim())) return Number(value.trim())
  return null
}

/** Un instante (`timestamptz` o ISO) → `Date`; `null` si no se lee. */
export function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuidText(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
