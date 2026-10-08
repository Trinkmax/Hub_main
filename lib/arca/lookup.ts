import 'server-only'

import { AccQueryError, OFFLINE_READ_MESSAGE } from '@/lib/accounting/queries/shared'
import { createClient } from '@/lib/supabase/server'
import type { ArcaEnvironment } from './endpoints'
import { classifyArcaError, describeArcaError } from './errors'
import type { ArcaGuideStepId } from './guide'
import { type PadronLookup, padronCacheRow } from './padron'
import {
  type ArcaConnectionRow,
  loadArcaConnectionRows,
  lookupConnection,
  readPadronCache,
} from './queries'
import { isArcaSecretsKeyError } from './secrets'
import { type ArcaSession, openArcaSession } from './session'
import { callArcaRpc, isArcaStoreError, rpcOf } from './store'
import {
  type PadronLookupFailureCode,
  type PadronLookupResult,
  type PadronPurpose,
  padronDataFromRow,
} from './views'

/**
 * «Completar con ARCA» (diseño §3.1): la constancia de inscripción de una CUIT para
 * el alta de un proveedor o un cliente.
 *
 * 1. Con qué conexión: producción si está conectada; si no, homologación (datos de
 *    prueba). Sin ninguna → `arca_not_connected` (la pantalla muestra el link a la
 *    guía en vez del botón).
 * 2. La caché del bar (`acc_arca_padron_cache`): 30 días si ARCA la encontró, 1 día
 *    si no (una CUIT nueva puede aparecer). `refresh` la saltea.
 * 3. Si no está: `getPersona_v2` con la sesión de ARCA (ticket del padrón bajo el
 *    lease) y se guarda en la caché (`acc_arca_padron_cache_put`; si falla, igual se
 *    devuelve el resultado).
 *
 * Privacidad: el padrón de una persona humana trae su nombre. No se loguea ni la
 * CUIT ni el nombre: los logs llevan la clave del error y el código técnico.
 */

export const PADRON_CACHE_DAYS = 30
export const PADRON_NOT_FOUND_CACHE_HOURS = 24

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
} as const

export type PadronLookupOptions = {
  readonly tenantId: string
  /** 11 dígitos, ya validada. */
  readonly cuit: string
  readonly purpose: PadronPurpose
  readonly refresh?: boolean
  readonly now?: Date
  /** Para los tests: la sesión de ARCA ya armada. */
  readonly session?: ArcaSession
}

function failure(
  code: PadronLookupFailureCode,
  message: string,
  step: ArcaGuideStepId | null = null,
): PadronLookupResult {
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

/** Una falla de ARCA → el código de §3.1 y el texto (con el paso de la guía). */
function arcaFailure(e: unknown, conn: ArcaConnectionRow): PadronLookupResult {
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
  return failure(code, view.body, view.step)
}

async function cachePut(
  tenantId: string,
  environment: ArcaEnvironment,
  row: ReturnType<typeof padronCacheRow>,
): Promise<void> {
  try {
    const supabase = await createClient()
    await callArcaRpc(rpcOf(supabase), 'acc_arca_padron_cache_put', {
      p_tenant_id: tenantId,
      p_environment: environment,
      p_rows: [row],
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
  try {
    conn = lookupConnection(await loadArcaConnectionRows(options.tenantId))
    if (!conn) return failure('arca_not_connected', PADRON_MESSAGES.notConnected)
    const environment = conn.environment

    if (options.refresh !== true) {
      const cached = await readPadronCache(options.tenantId, environment, options.cuit)
      if (cached && isFresh(cached.found, cached.fetchedAt, now)) {
        if (!cached.found) {
          return failure(
            'not_found',
            cached.data.reason === 'no_constancia'
              ? PADRON_MESSAGES.noConstancia
              : PADRON_MESSAGES.notFound,
          )
        }
        const data = padronDataFromRow({
          cuit: options.cuit,
          data: cached.data,
          environment,
          fetchedAt: cached.fetchedAt,
          source: 'cache',
          purpose: options.purpose,
        })
        if (data) return { ok: true, data }
      }
    }

    const session =
      options.session ??
      (await openArcaSession({
        tenantId: options.tenantId,
        environment,
        representedCuit: conn.representedCuit,
      }))
    const lookup = await session.padron.getPersona(options.cuit)
    const row = padronCacheRow(lookup, options.cuit)
    await cachePut(options.tenantId, environment, row)
    if (!lookup.found) return notFound(lookup)
    const data = padronDataFromRow({
      cuit: options.cuit,
      data: row.data,
      environment,
      fetchedAt: now.toISOString(),
      source: 'arca',
      purpose: options.purpose,
    })
    return data ? { ok: true, data } : failure('error', PADRON_MESSAGES.unexpected)
  } catch (e) {
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
    return arcaFailure(e, conn)
  }
}
