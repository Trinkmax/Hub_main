import 'server-only'

import { z } from 'zod'
import { AccQueryError, OFFLINE_READ_MESSAGE, queryError } from '@/lib/accounting/queries/shared'
import { CUIT_MESSAGES, parseCuit } from '@/lib/fiscal'
import { createClient } from '@/lib/supabase/server'
import { ARCA_SERVICE, type ArcaEnvironment } from './endpoints'
import { classifyArcaError, describeArcaError } from './errors'
import type { ArcaGuideStepId } from './guide'
import { PADRON_LIST_MAX, type PadronLookup, padronCacheRow } from './padron'
import {
  type ArcaConnectionRow,
  loadArcaConnectionRows,
  lookupConnection,
  type PadronCacheEntry,
  readPadronCache,
} from './queries'
import { isArcaSecretsKeyError } from './secrets'
import {
  type ArcaDeadline,
  type ArcaSession,
  type ArcaTicketDrop,
  isTicketRejection,
  openArcaSession,
} from './session'
import { asRec, callArcaRpc, dateOf, isArcaStoreError, rpcOf, textOf } from './store'
import {
  type PadronLookupFailureCode,
  type PadronLookupResult,
  type PadronPurpose,
  padronDataFromRow,
} from './views'

/**
 * «Completar con ARCA» (diseño §3.1): la constancia de inscripción de una CUIT para
 * el alta de un proveedor o un cliente, o de hasta 250 juntas (el paso «Proveedores
 * nuevos» del importador).
 *
 * 1. Con qué conexión: producción si está conectada; si no, homologación (datos de
 *    prueba). Sin ninguna → `arca_not_connected` (la pantalla muestra el link a la
 *    guía en vez del botón).
 * 2. La caché del bar (`acc_arca_padron_cache`): 30 días si ARCA la encontró, 1 día
 *    si no (una CUIT nueva puede aparecer). `refresh` la saltea.
 * 3. Si no está: `getPersona_v2` (o `getPersonaList_v2` para el lote, en UNA llamada)
 *    con la sesión de ARCA (ticket del padrón bajo el lease) y se guarda en la caché
 *    (`acc_arca_padron_cache_put`; si falla, igual se devuelve el resultado).
 *
 * **Plazo duro:** 40 s desde que empezó la acción (`PADRON_LOOKUP_DEADLINE_MS`); la
 * sesión recorta cada llamada y no empieza un login al WSAA con menos de 20 s.
 *
 * **Ticket rechazado:** si el padrón rechaza el ticket (token o relación), se descarta
 * (`session.dropTicket`) y el texto dice que se espere unos minutos y se vuelva a
 * probar; si la base todavía no tiene la RPC, queda el texto de siempre.
 *
 * Privacidad: el padrón de una persona humana trae su nombre. No se loguea ni la
 * CUIT ni el nombre: los logs llevan la clave del error y el código técnico.
 */

export const PADRON_CACHE_DAYS = 30
export const PADRON_NOT_FOUND_CACHE_HOURS = 24
/** Plazo duro de «Completar con ARCA» (de a una o en lote), desde que empieza la acción. */
export const PADRON_LOOKUP_DEADLINE_MS = 40_000

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export const PADRON_MESSAGES = {
  notConnected: 'Conectá ARCA (Ajustes › ARCA) para completar esto solo con la CUIT.',
  notFound: 'ARCA no encontró esa CUIT. Revisá los números.',
  noConstancia:
    'ARCA no da la constancia de esa CUIT (puede estar limitada o dada de baja). Completá los datos a mano.',
  secretsMissing:
    'Falta configurar la clave de la plataforma para usar ARCA. Avisanos y lo arreglamos.',
  unexpected: 'No pudimos consultar ARCA. Probá de nuevo en unos minutos; si sigue, avisanos.',
  /** En el lote, ARCA no devolvió a alguien de la lista. */
  noAnswer:
    'ARCA no devolvió datos de esa CUIT. Probá de nuevo en unos minutos o completá los datos a mano.',
  /** ARCA rechazó el permiso (ticket) guardado y lo descartamos: el próximo pedido pide otro. */
  ticketDropped: 'ARCA rechazó el permiso guardado. Esperá unos minutos y volvé a probar.',
  /** Lo mismo, cuando antes hay que arreglar algo en ARCA (va después del texto del arreglo). */
  ticketDroppedAfterFix:
    'Ya descartamos el permiso viejo: cuando lo arregles, esperá unos minutos y volvé a probar.',
} as const

type Failure = Extract<PadronLookupResult, { ok: false }>

export type PadronLookupOptions = {
  readonly tenantId: string
  /** 11 dígitos, ya validada. */
  readonly cuit: string
  readonly purpose: PadronPurpose
  readonly refresh?: boolean
  readonly now?: Date
  /** Plazo duro de la acción (`arcaDeadline(PADRON_LOOKUP_DEADLINE_MS)`). */
  readonly deadline?: ArcaDeadline
  /** Para los tests: la sesión de ARCA ya armada. */
  readonly session?: ArcaSession
}

function failure(
  code: PadronLookupFailureCode,
  message: string,
  step: ArcaGuideStepId | null = null,
): Failure {
  return { ok: false, code, message, step }
}

function isFresh(found: boolean, fetchedAt: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(fetchedAt)
  if (!Number.isFinite(age) || age < 0) return false
  return found ? age < PADRON_CACHE_DAYS * DAY_MS : age < PADRON_NOT_FOUND_CACHE_HOURS * HOUR_MS
}

function notFound(lookup: Extract<PadronLookup, { found: false }>): PadronLookupResult {
  return failure(
    'not_found',
    lookup.reason === 'no_constancia' ? PADRON_MESSAGES.noConstancia : PADRON_MESSAGES.notFound,
  )
}

/**
 * Lo que dice la caché (si sirve todavía). `null`: hay que ir a ARCA (no está, es
 * vieja o la fila no tiene la forma esperada).
 */
function cachedResult(
  cuit: string,
  cached: PadronCacheEntry | null | undefined,
  environment: ArcaEnvironment,
  purpose: PadronPurpose,
  now: Date,
): PadronLookupResult | null {
  if (!cached || !isFresh(cached.found, cached.fetchedAt, now)) return null
  if (!cached.found) {
    return failure(
      'not_found',
      cached.data.reason === 'no_constancia'
        ? PADRON_MESSAGES.noConstancia
        : PADRON_MESSAGES.notFound,
    )
  }
  const data = padronDataFromRow({
    cuit,
    data: cached.data,
    environment,
    fetchedAt: cached.fetchedAt,
    source: 'cache',
    purpose,
  })
  return data ? { ok: true, data } : null
}

/** Lo que contestó ARCA, ya pasado a la forma de la caché (`padronCacheRow`). */
function arcaResult(
  cuit: string,
  lookup: PadronLookup,
  row: PadronCacheRow,
  environment: ArcaEnvironment,
  purpose: PadronPurpose,
  now: Date,
): PadronLookupResult {
  if (!lookup.found) return notFound(lookup)
  const data = padronDataFromRow({
    cuit,
    data: row.data,
    environment,
    fetchedAt: now.toISOString(),
    source: 'arca',
    purpose,
  })
  return data ? { ok: true, data } : failure('error', PADRON_MESSAGES.unexpected)
}

/**
 * Una falla de ARCA → el código de §3.1 y el texto (con el paso de la guía). Con el
 * ticket rechazado y ya descartado (`drop === 'dropped'`), el texto pide esperar unos
 * minutos y volver a probar (la próxima consulta pide otro ticket).
 */
function arcaFailure(e: unknown, conn: ArcaConnectionRow, drop: ArcaTicketDrop | null): Failure {
  const key = classifyArcaError(e)
  const view = describeArcaError(e, {
    alias: conn.alias,
    environment: conn.environment,
    service: 'padron',
    wsn: 'ws_sr_constancia_inscripcion',
  })
  if (view.bug) console.error('[arca.lookup]', key, view.code ?? '')
  const code: PadronLookupFailureCode =
    key === 'arca_unavailable' || key === 'arca_busy' || key === 'arca_already_authenticated'
      ? 'arca_unavailable'
      : key === 'arca_not_authorized' || key === 'arca_cuit_not_in_token'
        ? 'arca_not_authorized'
        : 'error'
  if (drop !== 'dropped') return failure(code, view.body, view.step)
  // La relación con la SAS hay que arreglarla en ARCA primero; un token rechazado, no.
  return key === 'arca_cuit_not_in_token'
    ? failure(code, `${view.body} ${PADRON_MESSAGES.ticketDroppedAfterFix}`, view.step)
    : failure('arca_unavailable', PADRON_MESSAGES.ticketDropped)
}

/**
 * Lo que tiró una consulta → la falla para la pantalla. Si el padrón rechazó el ticket,
 * se descarta antes (solo el del padrón).
 */
async function lookupFailure(
  e: unknown,
  conn: ArcaConnectionRow | null,
  session: ArcaSession | null,
): Promise<Failure> {
  if (isArcaSecretsKeyError(e)) {
    console.error('[arca.lookup] secrets_key_missing')
    return failure('error', PADRON_MESSAGES.secretsMissing)
  }
  if (isArcaStoreError(e)) {
    if (e.state.detail?.bug === true || e.state.code === 'error') {
      console.error('[arca.lookup]', e.op, e.key ?? e.pgCode ?? 'error')
    }
    // «No se guardó» no aplica a una consulta: sin conexión se dice como lectura.
    return failure('error', e.key === 'offline' ? OFFLINE_READ_MESSAGE : e.state.message)
  }
  if (e instanceof AccQueryError) return failure('error', e.message)
  if (!conn) {
    console.error('[arca.lookup] inesperado', e instanceof Error ? e.name : 'unknown')
    return failure('error', PADRON_MESSAGES.unexpected)
  }
  const drop =
    session && isTicketRejection(e) ? await session.dropTicket(ARCA_SERVICE.padron) : null
  return arcaFailure(e, conn, drop)
}

type PadronCacheRow = ReturnType<typeof padronCacheRow>

async function cachePut(
  tenantId: string,
  environment: ArcaEnvironment,
  rows: readonly PadronCacheRow[],
): Promise<void> {
  if (rows.length === 0) return
  try {
    const supabase = await createClient()
    await callArcaRpc(rpcOf(supabase), 'acc_arca_padron_cache_put', {
      p_tenant_id: tenantId,
      p_environment: environment,
      p_rows: rows,
    })
  } catch (e) {
    // Es una caché: si no se guarda, la próxima consulta vuelve a ARCA.
    console.error('[arca.lookup] cache', isArcaStoreError(e) ? (e.key ?? e.pgCode) : 'error')
  }
}

/** La constancia de una CUIT (caché o ARCA). Nunca tira: devuelve el resultado de §3.1. */
export async function lookupPadron(options: PadronLookupOptions): Promise<PadronLookupResult> {
  const now = options.now ?? new Date()
  let conn: ArcaConnectionRow | null = null
  let session: ArcaSession | null = null
  try {
    conn = lookupConnection(await loadArcaConnectionRows(options.tenantId))
    if (!conn) return failure('arca_not_connected', PADRON_MESSAGES.notConnected)
    const environment = conn.environment

    if (options.refresh !== true) {
      const cached = cachedResult(
        options.cuit,
        await readPadronCache(options.tenantId, environment, options.cuit),
        environment,
        options.purpose,
        now,
      )
      if (cached) return cached
    }

    session =
      options.session ??
      (await openArcaSession({
        tenantId: options.tenantId,
        environment,
        representedCuit: conn.representedCuit,
        deadline: options.deadline,
      }))
    const lookup = await session.padron.getPersona(options.cuit)
    const row = padronCacheRow(lookup, options.cuit)
    await cachePut(options.tenantId, environment, [row])
    return arcaResult(options.cuit, lookup, row, environment, options.purpose, now)
  } catch (e) {
    return lookupFailure(e, conn, session)
  }
}

// ─── En lote (contrato C2) ───────────────────────────────────────────────────

/** Una CUIT del lote con su resultado. `cuit`: los 11 dígitos (o lo que vino, si no es válida). */
export type PadronBatchItem = { cuit: string; result: PadronLookupResult }

/**
 * Lo que devuelve `lookupCuits`: un resultado por CUIT (sin repetir, en el orden en que
 * vinieron), o una falla de todo el lote (sin permiso, ARCA sin conectar, ARCA no
 * contestó…) con su texto y el paso de la guía que lo arregla.
 */
export type PadronBatchResult =
  | { ok: true; data: { results: Array<{ cuit: string; result: PadronLookupResult }> } }
  | {
      ok: false
      code: PadronLookupFailureCode
      message: string
      step: ArcaGuideStepId | null
    }

const BATCH_MESSAGE = 'Revisá las CUIT.'

/** La entrada de `lookupCuits`: de 1 a 250 CUIT escritas como sea (se normalizan acá). */
export const lookupCuitsSchema = z.object(
  {
    cuits: z
      .array(z.string({ message: BATCH_MESSAGE }).max(64, BATCH_MESSAGE), {
        message: BATCH_MESSAGE,
      })
      .min(1, 'Mandá al menos una CUIT.')
      .max(PADRON_LIST_MAX, `Van hasta ${PADRON_LIST_MAX} CUIT por consulta.`),
    purpose: z
      .enum(['supplier', 'customer'], { message: 'Recargá la página y probá de nuevo.' })
      .default('supplier'),
  },
  { message: 'Revisá los datos.' },
)

/** Una CUIT del lote ya leída: válida (11 dígitos) o con su error para mostrar. */
export type CuitBatchEntry =
  | { readonly cuit: string; readonly valid: true }
  | { readonly cuit: string; readonly valid: false; readonly result: Failure }

function cuitIssueMessage(reason: keyof typeof CUIT_MESSAGES): string {
  const text = CUIT_MESSAGES[reason]
  return text.endsWith('.') ? text : `${text}.`
}

/**
 * Las CUIT del lote normalizadas (con o sin guiones) y sin repetir, en el orden en que
 * vinieron. Las que no son CUIT quedan con su error (`invalid_cuit`) y lo que vino.
 */
export function normalizeCuitBatch(inputs: readonly string[]): CuitBatchEntry[] {
  const seen = new Set<string>()
  const out: CuitBatchEntry[] = []
  for (const input of inputs) {
    const parsed = parseCuit(input)
    const cuit = parsed.ok ? parsed.cuit : input.trim()
    const key = `${parsed.ok ? 'ok' : 'bad'}:${cuit}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(
      parsed.ok
        ? { cuit, valid: true }
        : {
            cuit,
            valid: false,
            result: failure('invalid_cuit', cuitIssueMessage(parsed.reason)),
          },
    )
  }
  return out
}

/**
 * Las constancias de `getPersonaList_v2` con la CUIT pedida. ARCA las devuelve en su
 * orden, cada una con su `idPersona` (en los datos generales o en el error), así que se
 * emparejan por la CUIT. Sin adivinar: una que no trae CUIT solo se empareja si es la
 * única que queda y falta una sola CUIT; lo que no se empareja queda «ARCA no devolvió
 * datos de esa CUIT».
 */
export function matchPersonas(
  requested: readonly string[],
  lookups: readonly PadronLookup[],
): Map<string, PadronLookup> {
  const wanted = new Set(requested)
  const out = new Map<string, PadronLookup>()
  const anonymous: PadronLookup[] = []
  for (const lookup of lookups) {
    const cuit = lookup.found ? lookup.persona.cuit : lookup.cuit
    if (!cuit) anonymous.push(lookup)
    else if (wanted.has(cuit) && !out.has(cuit)) out.set(cuit, lookup)
  }
  const left = requested.filter((cuit) => !out.has(cuit))
  const [onlyCuit] = left
  const [onlyLookup] = anonymous
  if (left.length === 1 && anonymous.length === 1 && onlyCuit && onlyLookup) {
    out.set(onlyCuit, onlyLookup)
  }
  return out
}

/** Las constancias guardadas de varias CUIT (una sola lectura; mismas reglas que `readPadronCache`). */
async function readPadronCacheMany(
  tenantId: string,
  environment: ArcaEnvironment,
  cuits: readonly string[],
): Promise<Map<string, PadronCacheEntry>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('acc_arca_padron_cache')
    .select('cuit, found, data, fetched_at')
    .eq('tenant_id', tenantId)
    .eq('environment', environment)
    .in('cuit', [...cuits])
    .limit(cuits.length)
  if (error) throw queryError('acc_arca_padron_cache', error)
  const out = new Map<string, PadronCacheEntry>()
  for (const raw of (data ?? []) as unknown[]) {
    const row = asRec(raw)
    const cuit = textOf(row?.cuit)
    const fetchedAt = dateOf(row?.fetched_at)
    const payload = asRec(row?.data)
    if (!row || !cuit || !fetchedAt || !payload || typeof row.found !== 'boolean') continue
    out.set(cuit, { found: row.found, data: payload, fetchedAt: fetchedAt.toISOString() })
  }
  return out
}

export type PadronBatchOptions = {
  readonly tenantId: string
  /** CUIT válidas (11 dígitos) y sin repetir: de 1 a 250 (`normalizeCuitBatch`). */
  readonly cuits: readonly string[]
  readonly purpose: PadronPurpose
  readonly now?: Date
  /** Plazo duro de la acción (`arcaDeadline(PADRON_LOOKUP_DEADLINE_MS)`). */
  readonly deadline?: ArcaDeadline
  /** Para los tests: la sesión de ARCA ya armada. */
  readonly session?: ArcaSession
}

/**
 * Las constancias de varias CUIT: primero la caché (una lectura), y las que faltan en
 * UNA llamada a `getPersonaList_v2` (hasta 250), que también se guardan en la caché
 * (una escritura). Nunca tira. Si la consulta a ARCA falla, falla el lote entero con
 * el mismo texto que «Completar con ARCA» de a una.
 */
export async function lookupPadronBatch(options: PadronBatchOptions): Promise<PadronBatchResult> {
  const now = options.now ?? new Date()
  let conn: ArcaConnectionRow | null = null
  let session: ArcaSession | null = null
  try {
    if (options.cuits.length === 0 || options.cuits.length > PADRON_LIST_MAX) {
      return failure('error', BATCH_MESSAGE)
    }
    conn = lookupConnection(await loadArcaConnectionRows(options.tenantId))
    if (!conn) return failure('arca_not_connected', PADRON_MESSAGES.notConnected)
    const environment = conn.environment

    const results = new Map<string, PadronLookupResult>()
    const cached = await readPadronCacheMany(options.tenantId, environment, options.cuits)
    for (const cuit of options.cuits) {
      const hit = cachedResult(cuit, cached.get(cuit), environment, options.purpose, now)
      if (hit) results.set(cuit, hit)
    }

    const missing = options.cuits.filter((cuit) => !results.has(cuit))
    if (missing.length > 0) {
      session =
        options.session ??
        (await openArcaSession({
          tenantId: options.tenantId,
          environment,
          representedCuit: conn.representedCuit,
          deadline: options.deadline,
        }))
      const matched = matchPersonas(missing, await session.padron.getPersonaList(missing))
      const rows: PadronCacheRow[] = []
      for (const cuit of missing) {
        const lookup = matched.get(cuit)
        if (!lookup) {
          results.set(cuit, failure('error', PADRON_MESSAGES.noAnswer))
          continue
        }
        const row = padronCacheRow(lookup, cuit)
        rows.push(row)
        results.set(cuit, arcaResult(cuit, lookup, row, environment, options.purpose, now))
      }
      await cachePut(options.tenantId, environment, rows)
    }

    return {
      ok: true,
      data: {
        results: options.cuits.map((cuit) => ({
          cuit,
          result: results.get(cuit) ?? failure('error', PADRON_MESSAGES.unexpected),
        })),
      },
    }
  } catch (e) {
    return lookupFailure(e, conn, session)
  }
}
