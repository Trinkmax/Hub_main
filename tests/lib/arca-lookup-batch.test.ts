/**
 * «Completar con ARCA» en lote (contrato C2, `lookupCuits`): las constancias de hasta
 * 250 CUIT para el paso «Proveedores nuevos» del importador, con la base y ARCA
 * simulados (`FakeTicketDb` + `fakeSupabase` + transporte falso; la firma del TRA es
 * la de verdad).
 *
 * Lo que importa: la caché primero (una sola lectura), las que faltan en UNA llamada a
 * `getPersonaList_v2` (nunca de a una), una sola escritura de la caché, un resultado
 * por CUIT sin repetir y en el orden en que vinieron, las inválidas sin consultar
 * nada, el lote como UNA consulta del tope por minuto, solo para quien puede cargar,
 * el ticket rechazado que se descarta y el plazo de 40 s.
 */

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/arca/transport', () => ({ getTransport: vi.fn() }))

import { authorizeAccounting } from '@/lib/accounting/access'
import { lookupCuit, lookupCuits, type PadronBatchResult } from '@/lib/arca/actions'
import { matchPersonas, normalizeCuitBatch, PADRON_MESSAGES } from '@/lib/arca/lookup'
import {
  PADRON_LIST_MAX,
  type PadronLookup,
  padronCacheRow,
  parsePersonaList,
} from '@/lib/arca/padron'
import { getTransport } from '@/lib/arca/transport'
import type { PadronLookupResult } from '@/lib/arca/views'
import { cuitCheckDigit, formatCuit } from '@/lib/fiscal'
import { _resetRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { ARCA_CRYPTO_FILES as CRYPTO, fixtureText } from '@/tests/fixtures/arca/crypto-fixtures'
import { ARCA_XML, arcaXml, XML_CUITS } from '@/tests/fixtures/arca/xml/fixtures'
import {
  CONNECTION_ID,
  FakeTicketDb,
  type FakeTransport,
  FIXTURE_TOKEN,
  fakeSupabase,
  fixtureResponse,
  happyTransport,
  SAS_CUIT,
  SECRET,
  type TableRows,
  TENANT,
} from './arca-fakes'

const SLUG = 'bar-de-prueba'
const START = new Date('2026-10-08T12:00:00.000Z')
const DAY = 86_400_000
const KEY = fixtureText(CRYPTO.testKey)
const CERT = fixtureText(CRYPTO.issuedCrt)
const MONO = XML_CUITS.monotributista
const NO_EXISTE = XML_CUITS.noExiste
const PADRON = 'ws_sr_constancia_inscripcion'

type Row = Record<string, unknown>

let tables: TableRows
let db: FakeTicketDb
let transport: FakeTransport
let logs: string[]

const ok = (data: unknown) => ({ data, error: null })

function connRow(over: Row = {}): Row {
  return {
    id: CONNECTION_ID,
    tenant_id: TENANT,
    environment: 'produccion',
    status: 'connected',
    represented_cuit: SAS_CUIT,
    cert_cuit: SAS_CUIT,
    alias: 'plataforma',
    public_key_sha256: 'a'.repeat(64),
    pending_public_key_sha256: null,
    cert_serial: '8f3a5c7e9b1d2f40',
    cert_issuer: 'C=AR, O=AC de Prueba',
    cert_not_before: '2026-09-10T00:00:00+00:00',
    cert_not_after: '2028-09-10T00:00:00+00:00',
    point_of_sale: 5,
    allowed_classes: ['B'],
    default_concepto: 1,
    emission_enabled: false,
    services: {},
    last_test_at: null,
    last_test: null,
    last_error_key: null,
    updated_at: '2026-10-08T11:00:00.123+00:00',
    ...over,
  }
}

/** Una constancia en la caché del bar, con la forma de `padronCacheRow`. */
function cacheRow(cuit: string, lookup: PadronLookup, ageMs: number): Row {
  const row = padronCacheRow(lookup, cuit)
  return {
    tenant_id: TENANT,
    environment: 'produccion',
    cuit,
    found: row.found,
    data: row.data,
    fetched_at: new Date(START.getTime() - ageMs).toISOString(),
  }
}

const LIST = parsePersonaList(arcaXml(ARCA_XML.padronPersonaLista))
const [SAS_LOOKUP, MONO_LOOKUP, NO_EXISTE_LOOKUP] = LIST as [
  PadronLookup,
  PadronLookup,
  PadronLookup,
]

/** Las CUIT que pidió cada `getPersonaList_v2`, en el orden del pedido. */
function listRequests(): string[][] {
  return transport.calls
    .filter((c) => c.method === 'getPersonaList_v2')
    .map((c) =>
      [...c.req.body.matchAll(/<idPersona>(\d{11})<\/idPersona>/g)].map((m) => m[1] ?? ''),
    )
}

function results(state: PadronBatchResult): Array<[string, string]> {
  if (!state.ok) throw new Error(`se esperaba ok: ${state.code}`)
  return state.data.results.map((r) => [r.cuit, outcome(r.result)])
}

function outcome(result: PadronLookupResult): string {
  return result.ok ? `ok:${result.data.source}:${result.data.ivaCondition}` : result.code
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.stubEnv('META_TOKEN_KEY', SECRET)
  _resetRateLimit()
  tables = {
    acc_settings: [{ tenant_id: TENANT, legal_name: 'Bar de Prueba SAS', cuit: SAS_CUIT }],
    acc_arca_connections: [connRow()],
    acc_arca_padron_cache: [],
  }
  db = new FakeTicketDb(() => new Date(), { privateKeyPem: KEY, certificatePem: CERT })
  db.others.set('acc_arca_padron_cache_put', (args) => {
    for (const r of args.p_rows as Row[]) {
      tables.acc_arca_padron_cache = (tables.acc_arca_padron_cache ?? []).filter(
        (c) => !(c.environment === args.p_environment && c.cuit === r.cuit),
      )
      tables.acc_arca_padron_cache.push({
        tenant_id: TENANT,
        environment: args.p_environment,
        cuit: r.cuit,
        found: r.found,
        data: r.data,
        fetched_at: new Date().toISOString(),
      })
    }
    return ok((args.p_rows as Row[]).length)
  })
  db.others.set('acc_arca_ticket_drop', (args) => {
    const row = db.row(String(args.p_environment), String(args.p_service))
    const had = row.token !== null
    Object.assign(row, { token: null, sign: null, expiresAt: null })
    return ok(had)
  })
  transport = happyTransport(() => new Date())
  transport.routes['padron:getPersonaList_v2'] = fixtureResponse(ARCA_XML.padronPersonaLista)
  vi.mocked(createClient).mockImplementation(async () => fakeSupabase(tables, db.rpc) as never)
  vi.mocked(getTransport).mockImplementation(() => transport)
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: randomUUID(),
    slug: SLUG,
    access: {} as never,
  })
  logs = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  // Ni la clave del servidor, ni el ticket, ni las CUIT o los nombres del padrón en un log.
  for (const line of logs) {
    for (const secret of [SECRET, FIXTURE_TOKEN.slice(0, 40), MONO, SAS_CUIT, 'ANA SINTETICA']) {
      expect(line).not.toContain(secret)
    }
  }
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('las CUIT del lote (normalizeCuitBatch, matchPersonas)', () => {
  it('normaliza, saca las repetidas y deja las inválidas con su error, en el orden en que vinieron', () => {
    const entries = normalizeCuitBatch([
      formatCuit(SAS_CUIT),
      SAS_CUIT,
      ` ${formatCuit(MONO)} `,
      'abc',
      '',
      'abc',
      '20-12345678-0',
      '1234',
    ])
    expect(entries.map((e) => [e.cuit, e.valid ? 'ok' : e.result.message])).toEqual([
      [SAS_CUIT, 'ok'],
      [MONO, 'ok'],
      ['abc', 'El CUIT tiene 11 números.'],
      ['', 'Falta el CUIT.'],
      ['20-12345678-0', 'El CUIT no es válido: revisá el último número.'],
      ['1234', 'El CUIT tiene 11 números.'],
    ])
    expect(entries.every((e) => e.valid || e.result.code === 'invalid_cuit')).toBe(true)
  })

  it('empareja cada constancia por su CUIT, sin importar el orden de ARCA', () => {
    const matched = matchPersonas([NO_EXISTE, MONO, SAS_CUIT], LIST)
    expect(matched.get(SAS_CUIT)).toBe(SAS_LOOKUP)
    expect(matched.get(MONO)).toBe(MONO_LOOKUP)
    expect(matched.get(NO_EXISTE)).toBe(NO_EXISTE_LOOKUP)
    // Una que no se pidió no se toma.
    expect(matchPersonas([MONO], LIST).size).toBe(1)
  })

  it('una constancia sin CUIT solo se empareja si es la única que queda (no se adivina)', () => {
    const anonymous: PadronLookup = {
      found: false,
      cuit: null,
      reason: 'not_found',
      message: 'No existe persona con ese Id',
    }
    expect(matchPersonas([MONO, NO_EXISTE], [MONO_LOOKUP, anonymous]).get(NO_EXISTE)).toBe(
      anonymous,
    )
    const two = matchPersonas([MONO, NO_EXISTE, XML_CUITS.exento], [MONO_LOOKUP, anonymous])
    expect(two.has(NO_EXISTE)).toBe(false)
    expect(two.has(XML_CUITS.exento)).toBe(false)
  })
})

describe('lookupCuits («Completar con ARCA» en lote)', () => {
  it('sin caché: UNA consulta al padrón con las CUIT sin repetir, una escritura de la caché', async () => {
    const state = await lookupCuits(SLUG, {
      cuits: [formatCuit(SAS_CUIT), MONO, NO_EXISTE, formatCuit(MONO), 'no-es-cuit'],
      purpose: 'supplier',
    })
    expect(results(state)).toEqual([
      [SAS_CUIT, 'ok:arca:responsable_inscripto'],
      [MONO, 'ok:arca:monotributo'],
      [NO_EXISTE, 'not_found'],
      ['no-es-cuit', 'invalid_cuit'],
    ])
    if (!state.ok) return
    const mono = state.data.results[1]?.result
    expect(mono).toMatchObject({
      ok: true,
      data: {
        cuit: MONO,
        environment: 'produccion',
        testData: false,
        fetchedAt: START.toISOString(),
      },
    })
    // Proveedores: el aviso de Factura C del monotributista, como en «Completar con ARCA».
    expect(mono?.ok && mono.data.warnings.map((w) => w.key)).toContain('monotributo')
    expect(state.data.results[2]?.result).toMatchObject({
      ok: false,
      message: PADRON_MESSAGES.notFound,
      step: null,
    })

    // Un login al padrón y una sola llamada con las tres CUIT.
    expect(transport.calls.map((c) => `${c.service}:${c.method}:${c.wsn}`)).toEqual([
      `wsaa:loginCms:${PADRON}`,
      `padron:getPersonaList_v2:${PADRON}`,
    ])
    expect(listRequests()).toEqual([[SAS_CUIT, MONO, NO_EXISTE]])
    // Una sola escritura de la caché, con las tres (la que no existe también: 24 h).
    expect(db.callsTo('acc_arca_padron_cache_put')).toEqual([
      {
        p_tenant_id: TENANT,
        p_environment: 'produccion',
        p_rows: [
          padronCacheRow(SAS_LOOKUP, SAS_CUIT),
          padronCacheRow(MONO_LOOKUP, MONO),
          padronCacheRow(NO_EXISTE_LOOKUP, NO_EXISTE),
        ],
      },
    ])
    expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'write')
  })

  it('la caché primero: solo van a ARCA las que faltan o están viejas', async () => {
    tables.acc_arca_padron_cache = [
      cacheRow(MONO, MONO_LOOKUP, 5 * DAY),
      cacheRow(NO_EXISTE, NO_EXISTE_LOOKUP, 2 * 3_600_000),
      // Más de 30 días: se vuelve a consultar.
      cacheRow(SAS_CUIT, SAS_LOOKUP, 31 * DAY),
    ]
    const state = await lookupCuits(SLUG, {
      cuits: [MONO, NO_EXISTE, SAS_CUIT],
      purpose: 'customer',
    })
    expect(results(state)).toEqual([
      [MONO, 'ok:cache:monotributo'],
      [NO_EXISTE, 'not_found'],
      [SAS_CUIT, 'ok:arca:responsable_inscripto'],
    ])
    expect(listRequests()).toEqual([[SAS_CUIT]])
    // Solo se guarda lo que se consultó (ARCA devolvió de más: no se toma).
    expect(
      (db.callsTo('acc_arca_padron_cache_put')[0]?.p_rows as Row[]).map((r) => r.cuit),
    ).toEqual([SAS_CUIT])
  })

  it('todo en la caché: no va a ARCA ni pide ticket', async () => {
    tables.acc_arca_padron_cache = [
      cacheRow(MONO, MONO_LOOKUP, DAY),
      cacheRow(SAS_CUIT, SAS_LOOKUP, DAY),
    ]
    const state = await lookupCuits(SLUG, { cuits: [SAS_CUIT, MONO] })
    expect(results(state)).toEqual([
      [SAS_CUIT, 'ok:cache:responsable_inscripto'],
      [MONO, 'ok:cache:monotributo'],
    ])
    expect(transport.calls).toHaveLength(0)
    expect(db.calls).toEqual([])
  })

  it('si ARCA no devuelve a alguien, esa CUIT dice que se pruebe de nuevo (y no se guarda)', async () => {
    const body = arcaXml(ARCA_XML.padronPersonaLista).replace(
      /<persona><errorConstancia>.*?<\/persona>/,
      '',
    )
    transport.routes['padron:getPersonaList_v2'] = () => ({ status: 200, body })
    const state = await lookupCuits(SLUG, { cuits: [SAS_CUIT, NO_EXISTE] })
    expect(results(state)).toEqual([
      [SAS_CUIT, 'ok:arca:responsable_inscripto'],
      [NO_EXISTE, 'error'],
    ])
    expect(state.ok && state.data.results[1]?.result).toMatchObject({
      message: PADRON_MESSAGES.noAnswer,
    })
    expect(
      (db.callsTo('acc_arca_padron_cache_put')[0]?.p_rows as Row[]).map((r) => r.cuit),
    ).toEqual([SAS_CUIT])
  })

  it('250 CUIT van en UNA llamada al padrón y UNA escritura de la caché', async () => {
    const many: string[] = []
    for (let n = 10_000_000; many.length < PADRON_LIST_MAX; n++) {
      const firstTen = `20${n}`
      const check = cuitCheckDigit(firstTen)
      if (check !== null) many.push(`${firstTen}${check}`)
    }
    transport.routes['padron:getPersonaList_v2'] = (req) => {
      const ids = [...req.body.matchAll(/<idPersona>(\d{11})<\/idPersona>/g)].map((m) => m[1])
      const personas = ids
        .map(
          (id) =>
            `<persona><errorConstancia><error>No existe persona con ese Id</error><idPersona>${id}</idPersona></errorConstancia></persona>`,
        )
        .join('')
      return {
        status: 200,
        body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:getPersonaList_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaListReturn>${personas}</personaListReturn></ns2:getPersonaList_v2Response></soap:Body></soap:Envelope>`,
      }
    }
    const state = await lookupCuits(SLUG, { cuits: many })
    expect(state.ok && state.data.results).toHaveLength(PADRON_LIST_MAX)
    expect(state.ok && state.data.results.every((r) => outcome(r.result) === 'not_found')).toBe(
      true,
    )
    expect(listRequests()).toHaveLength(1)
    expect(listRequests()[0]).toEqual(many)
    expect(db.callsTo('acc_arca_padron_cache_put')).toHaveLength(1)
    expect(db.callsTo('acc_arca_padron_cache_put')[0]?.p_rows).toHaveLength(PADRON_LIST_MAX)

    // 251 no entran: lo dice sin consultar nada.
    const tooMany = await lookupCuits(SLUG, { cuits: [...many, SAS_CUIT] })
    expect(tooMany).toEqual({
      ok: false,
      code: 'error',
      message: `Van hasta ${PADRON_LIST_MAX} CUIT por consulta.`,
      step: null,
    })
  })

  it('sin ARCA conectado: falla el lote entero con el link a la guía', async () => {
    tables.acc_arca_connections = [connRow({ status: 'cert_ready' })]
    expect(await lookupCuits(SLUG, { cuits: [MONO] })).toEqual({
      ok: false,
      code: 'arca_not_connected',
      message: PADRON_MESSAGES.notConnected,
      step: null,
    })
    expect(transport.calls).toHaveLength(0)
  })

  it('el padrón rechaza el ticket: falla el lote, se descarta ese ticket y pide esperar', async () => {
    transport.routes['padron:getPersonaList_v2'] = fixtureResponse(ARCA_XML.padronFaultToken, 500)
    expect(await lookupCuits(SLUG, { cuits: [SAS_CUIT, MONO] })).toEqual({
      ok: false,
      code: 'arca_unavailable',
      message: PADRON_MESSAGES.ticketDropped,
      step: null,
    })
    expect(db.callsTo('acc_arca_ticket_drop')).toEqual([
      { p_tenant_id: TENANT, p_environment: 'produccion', p_service: PADRON },
    ])
    expect(db.callsTo('acc_arca_padron_cache_put')).toEqual([])
  })

  it('plazo de 40 s: si la base tarda, el login del padrón no se empieza con menos de 20 s', async () => {
    // La base contesta el ticket a los 25 s del pedido: quedan 15 s.
    const rpc = db.rpc
    vi.mocked(createClient).mockImplementation(
      async () =>
        fakeSupabase(tables, async (fn, args) => {
          if (fn === 'acc_arca_ticket_get') vi.setSystemTime(new Date(Date.now() + 25_000))
          return rpc(fn, args)
        }) as never,
    )
    const state = await lookupCuits(SLUG, { cuits: [MONO] })
    expect(state).toMatchObject({ ok: false, code: 'arca_unavailable', step: null })
    expect(transport.calls).toHaveLength(0)
    // El turno se devolvió sin cooldown (nada llegó a ARCA).
    expect(db.callsTo('acc_arca_ticket_put').map((a) => a.p_result)).toEqual([
      { ok: false, key: 'arca_unavailable', cooldown: null },
    ])
  })

  it('las inválidas no consultan nada ni gastan el tope', async () => {
    const state = await lookupCuits(SLUG, { cuits: ['20-12345678-0', 'xx'] })
    expect(results(state)).toEqual([
      ['20-12345678-0', 'invalid_cuit'],
      ['xx', 'invalid_cuit'],
    ])
    expect(db.calls).toEqual([])
    expect(transport.calls).toHaveLength(0)
    // El tope sigue entero: 30 consultas.
    tables.acc_arca_connections = [connRow({ status: 'cert_ready' })]
    for (let i = 0; i < 30; i++) {
      expect((await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).ok).toBe(false)
    }
    expect(await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).toMatchObject({
      code: 'rate_limited',
    })
  })

  it('el lote cuenta como UNA consulta del tope de 30 por minuto (compartido con la de a una)', async () => {
    tables.acc_arca_connections = [connRow({ status: 'cert_ready' })]
    for (let i = 0; i < 29; i++) await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })
    // Un lote de 3 es la consulta 30: pasa (y dice que falta conectar ARCA).
    expect(await lookupCuits(SLUG, { cuits: [MONO, SAS_CUIT, NO_EXISTE] })).toMatchObject({
      code: 'arca_not_connected',
    })
    expect(await lookupCuits(SLUG, { cuits: [MONO] })).toEqual({
      ok: false,
      code: 'rate_limited',
      message: 'Hiciste muchas consultas seguidas. Esperá un minuto y probá de nuevo.',
      step: null,
    })
  })

  it('valida la forma del pedido (zod) y exige poder cargar', async () => {
    expect(await lookupCuits(SLUG, { cuits: [] })).toMatchObject({
      ok: false,
      code: 'error',
      message: 'Mandá al menos una CUIT.',
    })
    expect(await lookupCuits(SLUG, { cuits: MONO })).toMatchObject({ ok: false, code: 'error' })
    expect(await lookupCuits(SLUG, { cuits: [MONO], purpose: 'otro' })).toMatchObject({
      ok: false,
      code: 'error',
    })
    expect(await lookupCuits('', { cuits: [MONO] })).toMatchObject({ ok: false, code: 'forbidden' })
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso para cargar.' },
    })
    expect(await lookupCuits(SLUG, { cuits: [MONO] })).toEqual({
      ok: false,
      code: 'forbidden',
      message: 'No tenés permiso para cargar.',
      step: null,
    })
    expect(db.calls).toEqual([])
  })
})
