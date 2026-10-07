import 'server-only'
import type { AccFailureCode } from '@/lib/accounting/action-state'
import { ACC_GENERIC_ERROR, mapAccError, type PgLikeError } from '@/lib/accounting/errors'
import { isRealIsoDay, isRealYearMonth } from '@/lib/dates/civil'
import { createClient } from '@/lib/supabase/server'

/**
 * Piezas comunes de las lecturas de Administración (Sprint 1 §G.7, §F.0).
 *
 * - Todas las lecturas corren con la sesión del usuario: las RPC `acc_report_*`
 *   empiezan con `acc_assert_reader` y los `select` sobre `acc_*` pasan por la
 *   RLS de lectores; además cada `select` filtra `tenant_id` explícito.
 * - Los clientes de Supabase no tienen el genérico `Database` para estas
 *   tablas: todo se tipa a mano y se normaliza acá (`bigint` puede llegar como
 *   string → `Number()`; las fechas `date` llegan `yyyy-MM-dd`).
 * - La plata sale SIEMPRE en centavos enteros: la UI formatea con `lib/money`.
 */

// ─── Tipos públicos ──────────────────────────────────────────────────────────

/**
 * Una página de un listado con keyset (§F.0). `nextCursor` va tal cual a la URL
 * (`?despues=`) y vuelve como `after`; `null` = no hay más. `totalRows` es el
 * total del período/filtro (no solo de esta página).
 */
export type QueryPage<T> = {
  rows: T[]
  nextCursor: string | null
  totalRows: number
}

/** Resultado de `settleQuery`: para mostrar el error de UN bloque sin tirar la página. */
export type QueryOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: AccFailureCode; message: string }

export type CursorValue = string | number | boolean | null
export type Cursor = Readonly<Record<string, CursorValue>>

/** Tope de filas por página de los reportes (la base corta en 500; el diario en 200 asientos). */
export const REPORT_PAGE_LIMIT = 500
export const JOURNAL_PAGE_LIMIT = 200
/** Página por defecto de las listas en pantalla. */
export const LIST_PAGE_SIZE = 50

/**
 * Error de una lectura, con el mensaje listo para mostrar (G.4) y el código de
 * `mapAccError`. Nunca lleva datos personales ni el texto crudo de Postgres.
 * `source` es el nombre de la RPC o tabla, para el log.
 */
export class AccQueryError extends Error {
  readonly code: AccFailureCode
  readonly key: string | null
  readonly source: string

  constructor(source: string, code: AccFailureCode, message: string, key: string | null = null) {
    super(message)
    this.name = 'AccQueryError'
    this.code = code
    this.key = key
    this.source = source
  }
}

/**
 * Para las páginas con varios bloques (Resumen, ficha): un bloque que falla se
 * muestra con su error y su «Reintentar», sin tirar el resto. Un error que no
 * es de una lectura (un bug) se loguea y queda como «No pudimos cargar esto».
 */
export async function settleQuery<T>(promise: Promise<T>): Promise<QueryOutcome<T>> {
  try {
    return { ok: true, data: await promise }
  } catch (error) {
    if (error instanceof AccQueryError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('[acc.query] inesperado', errorName(error))
    return { ok: false, code: 'error', message: QUERY_FAILED_MESSAGE }
  }
}

export const QUERY_FAILED_MESSAGE = 'No pudimos cargar esto. Probá de nuevo; si sigue, avisanos.'

function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : 'desconocido'
}

// ─── Cursor (keyset) ─────────────────────────────────────────────────────────

const MAX_TOKEN_CHARS = 800

/**
 * Lo que viaja en `?despues=`: el cursor `jsonb` de la última fila (tal cual
 * lo devuelve la base) y cuántas filas se vieron hasta ahí (para saber si
 * queda algo sin pedir otra página vacía). Va en base64url de JSON.
 */
export type PageToken = { cursor: Cursor; seen: number }

/** Cursor de la base + filas vistas → string apto para la URL; `null` si el cursor no sirve. */
export function encodeCursor(cursor: unknown, seen = 0): string | null {
  const parsed = asCursor(cursor)
  if (!parsed) return null
  const token = { c: parsed, n: Math.max(0, Math.trunc(seen)) }
  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url')
}

/**
 * `?despues=` → token. Un valor roto o manipulado da `null` (= primera
 * página): la base igual valida tipos y la RLS filtra; nunca se arma SQL con él.
 */
export function decodePageToken(raw: unknown): PageToken | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TOKEN_CHARS) {
    return null
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(parsed)) return null
    const cursor = asCursor(parsed.c)
    const seen = typeof parsed.n === 'number' && Number.isFinite(parsed.n) ? parsed.n : 0
    return cursor ? { cursor, seen: Math.max(0, Math.trunc(seen)) } : null
  } catch {
    return null
  }
}

/** Solo el cursor de la base (lo que va en `p_after`). */
export function decodeCursor(raw: unknown): Cursor | null {
  return decodePageToken(raw)?.cursor ?? null
}

function asCursor(value: unknown): Cursor | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, CursorValue> = {}
  let keys = 0
  for (const [k, v] of Object.entries(value)) {
    if (keys >= 12) return null
    if (v === null || typeof v === 'string' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else return null
    keys += 1
  }
  return keys > 0 ? out : null
}

/** El límite pedido, acotado a `[1, max]`; sin pedido, `fallback`. */
export function clampLimit(
  limit: number | null | undefined,
  fallback: number,
  max: number,
): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.trunc(limit)))
}

// ─── Llamadas ────────────────────────────────────────────────────────────────

export type RpcParams = Record<string, unknown>

/** El cliente con la sesión del usuario (RLS + `acc_assert_reader` en la base). */
export async function readerClient() {
  return createClient()
}

/**
 * Un error de Supabase → `AccQueryError` con el mensaje de G.4. El log lleva
 * el origen y el código, nunca el detalle (puede traer datos de la fila).
 * Los textos pensados para guardar («no se guardó») se cambian por los de
 * lectura.
 */
export function queryError(source: string, error: PgLikeError): AccQueryError {
  const state = mapAccError(error)
  const mapped = typeof state.detail?.key === 'string' ? state.detail.key : null
  // Un reporte de una fase que todavía no está en la base: la función no existe
  // (PGRST202) o todavía no acepta ese tipo (`invalid_report_param`, p. ej. el
  // subdiario de compras antes de su migración; los parámetros ya se validaron
  // acá antes de llamar). Para la pantalla y el exporte es lo mismo.
  const unavailable =
    mapped === 'function_unavailable' ||
    mapped === 'invalid_report_param' ||
    (!mapped && /\binvalid_report_param\b/.test(error.message ?? ''))
  const key = unavailable ? 'function_unavailable' : mapped
  console.error('[acc.query]', source, error.code ?? 'sin-codigo', mapped ?? '')
  let message = state.message
  if (key === 'offline') {
    message = OFFLINE_READ_MESSAGE
  } else if (unavailable) {
    message = REPORT_UNAVAILABLE_MESSAGE
  } else if (message === ACC_GENERIC_ERROR || state.detail?.bug === true) {
    message = QUERY_FAILED_MESSAGE
  }
  return new AccQueryError(source, unavailable ? 'error' : state.code, message, key)
}

export const OFFLINE_READ_MESSAGE = 'Sin conexión: no pudimos cargar esto. Probá de nuevo.'
export const REPORT_UNAVAILABLE_MESSAGE =
  'Este reporte todavía no está disponible. Actualizá la página en unos minutos.'

/** Llama una RPC de lectura y devuelve `data` crudo (`unknown`) o tira `AccQueryError`. */
export async function callRpc(name: string, params: RpcParams): Promise<unknown> {
  const supabase = await readerClient()
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw queryError(name, error)
  return data as unknown
}

/** Una RPC que devuelve `table(...)`: siempre una lista de objetos (vacía si no vino nada). */
export async function callRpcRows(name: string, params: RpcParams): Promise<UnknownRecord[]> {
  return asRecords(await callRpc(name, params))
}

// ─── Normalización ───────────────────────────────────────────────────────────

export type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

/** Una lista de objetos; lo que no es objeto se descarta. Acepta jsonb como string. */
export function asRecords(value: unknown): UnknownRecord[] {
  const list = typeof value === 'string' ? safeJson(value) : value
  if (!Array.isArray(list)) return []
  return list.filter(isRecord)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Centavos: `bigint` de Postgres puede llegar como número o como string. Un
 * valor ausente o ilegible es 0 (para «sin dato» usar `centsOrNull`).
 */
export function cents(value: unknown): number {
  return centsOrNull(value) ?? 0
}

export function centsOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

/** Entero (contadores, números de asiento, días). */
export function int(value: unknown): number {
  return intOrNull(value) ?? 0
}

export function intOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Math.trunc(Number(value.trim()))
  }
  return null
}

export function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return fallback
}

export function strOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return null
}

export function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

/** `date` (`yyyy-MM-dd`) o el día de un `timestamptz`/ISO. `null` si no es una fecha real. */
export function dayOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const day = value.slice(0, 10)
  return isRealIsoDay(day) ? day : null
}

export function day(value: unknown, fallback = ''): string {
  return dayOrNull(value) ?? fallback
}

/** Instante (`timestamptz`) tal cual, para `formatDateTime`. */
export function instantOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 10 ? value : null
}

/** Una lista de strings (`text[]`). */
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Valida un mes (`yyyy-MM` o un día de ese mes) antes de mandarlo a la base y
 * devuelve su primer día. La página ya lo validó con `resolvePeriod`: esto es
 * la segunda red, con el mismo texto.
 */
export function requireMonth(month: string): string {
  const ym = typeof month === 'string' ? month.slice(0, 7) : ''
  if (!isRealYearMonth(ym)) {
    throw new AccQueryError('params', 'invalid', 'Ese mes no existe. Elegilo de nuevo.')
  }
  return `${ym}-01`
}

/** Valida un rango de días (`desde ≤ hasta`, fechas reales). */
export function requireRange(from: string, to: string): { from: string; to: string } {
  if (!isRealIsoDay(from) || !isRealIsoDay(to)) {
    throw new AccQueryError('params', 'invalid', 'Esa fecha no existe.')
  }
  if (from > to) {
    throw new AccQueryError('params', 'invalid', 'El «hasta» no puede ser anterior al «desde».')
  }
  return { from, to }
}

/** Valida un día suelto (o `null` = sin fecha). */
export function optionalDay(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (!isRealIsoDay(value)) throw new AccQueryError('params', 'invalid', 'Esa fecha no existe.')
  return value
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** `?despues=` + límite → los parámetros keyset de las RPC y las filas ya vistas. */
export function keysetParams(
  after: string | null | undefined,
  limit: number | null | undefined,
  fallback: number,
  max: number,
): { p_after: Cursor | null; p_limit: number; seen: number } {
  const token = decodePageToken(after)
  return {
    p_after: token?.cursor ?? null,
    p_limit: clampLimit(limit, fallback, max),
    seen: token?.seen ?? 0,
  }
}

/**
 * Arma la página de una RPC keyset: cada fila trae su `cursor` y la primera el
 * total (`total_rows`, o `total_entries` en el diario). `isCounted` dice qué
 * filas cuentan para el total (el «Saldo anterior» no).
 *
 * Hay página siguiente si vino la página llena Y todavía no se vio el total:
 * así una página parcial nunca ofrece «Cargar más», y si la base no manda el
 * total alcanza con la página llena.
 */
export function keysetPage<T>(
  raw: readonly UnknownRecord[],
  opts: {
    limit: number
    seen: number
    map: (row: UnknownRecord) => T
    totalKey?: string
    isCounted?: (row: UnknownRecord) => boolean
  },
): QueryPage<T> {
  const counted = opts.isCounted ? raw.filter(opts.isCounted) : raw
  const totalKey = opts.totalKey ?? 'total_rows'
  const withTotal = raw.find((row) => intOrNull(row[totalKey]) !== null)
  const reported = withTotal ? int(withTotal[totalKey]) : 0
  const seen = opts.seen + counted.length
  const last = counted.at(-1)
  const hasMore =
    last !== undefined && raw.length >= opts.limit && (reported <= 0 || seen < reported)
  return {
    rows: raw.map(opts.map),
    nextCursor: hasMore ? encodeCursor(last.cursor, seen) : null,
    totalRows: Math.max(reported, seen),
  }
}

// ─── Catálogos por id ────────────────────────────────────────────────────────

/** Tandas de ids: un `in.(…)` con cientos de UUID no entra en la URL. */
export const ID_CHUNK = 100

export function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function uniqueIds(values: readonly unknown[]): string[] {
  const out = new Set<string>()
  for (const v of values) if (isUuid(v)) out.add(v)
  return [...out]
}

export type CatalogTable =
  | 'acc_accounts'
  | 'acc_parties'
  | 'acc_treasury_accounts'
  | 'acc_sales_methods'
  | 'acc_documents'

/** Filas de una tabla `acc_*` por id (en tandas, con `tenant_id` explícito). */
export async function namesById(
  tenantId: string,
  table: CatalogTable,
  ids: readonly unknown[],
  columns = 'id, name',
): Promise<Map<string, UnknownRecord>> {
  const list = uniqueIds(ids)
  const out = new Map<string, UnknownRecord>()
  if (list.length === 0) return out
  const supabase = await readerClient()
  const results = await Promise.all(
    chunks(list).map((chunk) =>
      supabase.from(table).select(columns).eq('tenant_id', tenantId).in('id', chunk),
    ),
  )
  for (const result of results) {
    if (result.error) throw queryError(table, result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (isRecord(row)) out.set(str(row.id), row)
    }
  }
  return out
}
