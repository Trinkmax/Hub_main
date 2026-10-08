/**
 * La emisión con CAE (diseño §3.2.4–§3.2.5): la saga «CAE primero, asiento después»
 * con la base y ARCA simulados.
 *
 * - `FakeVoucherDb` sigue las reglas de `acc_arca_voucher_reserve` y
 *   `acc_arca_voucher_update` (migración 20261008120120): una emisión viva por punto
 *   de venta y tipo (lo vivo de más de 3 minutos se suelta o pide verificación),
 *   las transiciones válidas, la lista blanca de cada destino, el número único y
 *   que homologación nunca vincula un asiento.
 * - WSFE es un transporte falso que despacha por SOAPAction y cuenta los pedidos.
 *
 * Lo que importa: `FECAESolicitar` sale **una sola vez** (nunca se reintenta a
 * ciegas), un corte se resuelve con `FECompConsultar` (encontrada → autorizada; «no
 * existe» recién cuenta pasado un rato), cada estado se puede retomar, el plazo se
 * respeta (sin tiempo no se pide el CAE) y homologación nunca va a los libros.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/arca/transport', () => ({ getTransport: vi.fn() }))

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  AFTER_CAE_RESERVE_MS,
  CAE_MIN_START_MS,
  CAE_TIMEOUT_MAX_MS,
  EMIT_BUDGET_MS,
  type EmissionPlan,
  type EmitDeps,
  failedBeforeSending,
  linkVoucherDocument,
  parseVoucherRow,
  RECONCILE_SAFE_AFTER_MS,
  reconcileVoucher,
  requestSha256,
  runEmission,
  STALE_REQUESTING_MS,
} from '@/lib/arca/emit'
import { emitArcaSalesVoucher, emitArcaTestVoucher } from '@/lib/arca/emit-actions'
import type { ArcaStoredForm } from '@/lib/arca/emit-form'
import { readCaeRecord } from '@/lib/arca/print'
import { ArcaFault, type ArcaHttpRequest, type ArcaHttpResponse } from '@/lib/arca/soap'
import type { ArcaRpc, ArcaRpcResult } from '@/lib/arca/store'
import { getTransport } from '@/lib/arca/transport'
import { type CaeRequest, caeRequestRecord } from '@/lib/arca/wsfe'
import { _resetRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { ARCA_CRYPTO_FILES as CRYPTO, fixtureText } from '@/tests/fixtures/arca/crypto-fixtures'
import {
  arcaTransport,
  CONNECTION_ID,
  FakeTicketDb,
  type FakeTransport,
  fakeSupabase,
  SAS_CUIT,
  SECRET,
  type TableRows,
  TENANT,
  ultimoResponse,
} from './arca-fakes'

const START = Date.parse('2026-10-08T12:00:00.000Z')
const MIN = 60_000
const CAE = '76412345678901'
const PV = 5

let clock = START
const now = () => clock

// ─── La base de los comprobantes ─────────────────────────────────────────────

type Row = Record<string, unknown>

const ok = (data: unknown): ArcaRpcResult => ({ data, error: null })
const fail = (message: string): ArcaRpcResult => ({
  data: null,
  error: { message, code: 'P0001', details: null, hint: null },
})

const LIVE = ['reserved', 'requesting', 'needs_reconcile']
const NUMBERED = ['requesting', 'needs_reconcile', 'authorized', 'posted']
const ALLOWED: Record<string, string[]> = {
  requesting: ['number', 'request', 'request_sha256', 'issue_date'],
  authorized: ['cae', 'cae_due', 'fch_proceso', 'observations', 'events'],
  rejected: ['errors', 'observations', 'events', 'fch_proceso', 'reason'],
  needs_reconcile: ['reason'],
  failed: ['reason', 'errors'],
  abandoned: ['reason'],
  posted: ['document_id'],
}
const TRANSITIONS: Record<string, string[]> = {
  reserved: ['requesting', 'abandoned'],
  requesting: ['authorized', 'rejected', 'needs_reconcile'],
  needs_reconcile: ['authorized', 'failed'],
  authorized: ['posted'],
}

/** `acc_arca_voucher_reserve` / `acc_arca_voucher_update` con las reglas de la migración. */
class FakeVoucherDb {
  readonly calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  connected = true
  emissionEnabled = true

  constructor(readonly rows: Row[]) {}

  row(id: string): Row | undefined {
    return this.rows.find((r) => r.id === id)
  }

  readonly rpc: ArcaRpc = async (fn, args) => {
    this.calls.push({ fn, args: structuredClone(args) })
    if (fn === 'acc_arca_voucher_reserve') return this.reserve(args)
    if (fn === 'acc_arca_voucher_update') return this.update(args)
    throw new Error(`RPC inesperada: ${fn}`)
  }

  reserve(args: Record<string, unknown>): ArcaRpcResult {
    const env = String(args.p_environment)
    const pv = Number(args.p_point_of_sale)
    const tipo = Number(args.p_cbte_tipo)
    const payload = args.p_payload as Row
    const keys = Object.keys(payload)
    if (
      keys.some((k) => !['form', 'total_cents', 'issue_date', 'related_voucher_id'].includes(k))
    ) {
      return fail('invalid_payload')
    }
    if (typeof payload.form !== 'object' || payload.form === null) return fail('invalid_payload')
    if (!Number.isSafeInteger(payload.total_cents)) return fail('invalid_payload')
    if (!this.connected) return fail('arca_not_connected')
    if (env === 'produccion' && !this.emissionEnabled) return fail('arca_emission_disabled')
    const live = this.rows.find(
      (r) =>
        r.environment === env &&
        r.point_of_sale === pv &&
        r.cbte_tipo === tipo &&
        LIVE.includes(String(r.status)),
    )
    if (live) {
      if (Date.parse(String(live.updated_at)) > clock - 3 * MIN)
        return fail('arca_voucher_in_flight')
      if (live.status !== 'reserved') return ok({ needs_reconcile: live.id })
      Object.assign(live, { status: 'abandoned', reason: 'stale_reservation' })
    }
    const row: Row = {
      id: randomUUID(),
      tenant_id: TENANT,
      connection_id: CONNECTION_ID,
      environment: env,
      point_of_sale: pv,
      cbte_tipo: tipo,
      number: null,
      status: 'reserved',
      client_ref: randomUUID(),
      form: payload.form,
      request: null,
      request_sha256: null,
      cae: null,
      cae_due: null,
      result: null,
      fch_proceso: null,
      observations: [],
      errors: [],
      events: [],
      document_id: null,
      related_voucher_id: payload.related_voucher_id ?? null,
      total_cents: payload.total_cents,
      issue_date: payload.issue_date ?? null,
      reason: null,
      created_at: new Date(clock).toISOString(),
      updated_at: new Date(clock).toISOString(),
    }
    this.rows.push(row)
    return ok({ voucher_id: row.id, client_ref: row.client_ref })
  }

  update(args: Record<string, unknown>): ArcaRpcResult {
    const row = this.row(String(args.p_voucher_id))
    const to = String(args.p_to)
    const patch = (args.p_patch ?? {}) as Row
    if (!row) return fail('arca_voucher_transition')
    if (!(TRANSITIONS[String(row.status)] ?? []).includes(to))
      return fail('arca_voucher_transition')
    if (Object.keys(patch).some((k) => !(ALLOWED[to] ?? []).includes(k))) {
      return fail('invalid_payload')
    }
    if (to === 'requesting') {
      const n = patch.number
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 99_999_999) {
        return fail('invalid_payload')
      }
      if (!/^[0-9a-f]{64}$/.test(String(patch.request_sha256))) return fail('invalid_payload')
      if (typeof patch.request !== 'object' || patch.request === null) {
        return fail('invalid_payload')
      }
      const taken = this.rows.some(
        (r) =>
          r !== row &&
          r.environment === row.environment &&
          r.point_of_sale === row.point_of_sale &&
          r.cbte_tipo === row.cbte_tipo &&
          r.number === n &&
          NUMBERED.includes(String(r.status)),
      )
      if (taken) return fail('arca_voucher_transition')
    }
    if (to === 'authorized') {
      if (!/^\d{14}$/.test(String(patch.cae))) return fail('invalid_payload')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(patch.cae_due))) return fail('invalid_payload')
    }
    if (to === 'posted') {
      if (row.environment !== 'produccion' || typeof patch.document_id !== 'string') {
        return fail('arca_voucher_document_mismatch')
      }
    }
    Object.assign(row, patch, {
      status: to,
      result: to === 'authorized' ? 'A' : to === 'rejected' ? 'R' : row.result,
      updated_at: new Date(clock).toISOString(),
    })
    return ok({ ...row })
  }
}

// ─── WSFE simulado ───────────────────────────────────────────────────────────

const ENVELOPE = (inner: string) =>
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  `${inner}</soap:Body></soap:Envelope>`

const ymd = (iso: string) => iso.replaceAll('-', '')

function msgs(tag: 'Observaciones' | 'Errors', item: 'Obs' | 'Err', list: Array<[number, string]>) {
  if (list.length === 0) return ''
  return `<${tag}>${list.map(([c, m]) => `<${item}><Code>${c}</Code><Msg>${m}</Msg></${item}>`).join('')}</${tag}>`
}

/** La respuesta de `FECAESolicitar` para el número pedido. */
function caeResponse(
  req: ArcaHttpRequest,
  o: { resultado: 'A' | 'R'; obs?: Array<[number, string]>; errors?: Array<[number, string]> },
): ArcaHttpResponse {
  const nro = /<ar:CbteDesde>(\d+)<\/ar:CbteDesde>/.exec(req.body)?.[1] ?? '0'
  const tipo = /<ar:CbteTipo>(\d+)<\/ar:CbteTipo>/.exec(req.body)?.[1] ?? '6'
  const fch = /<ar:CbteFch>(\d+)<\/ar:CbteFch>/.exec(req.body)?.[1] ?? '20261008'
  const approved = o.resultado === 'A'
  return {
    status: 200,
    body: ENVELOPE(
      '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>' +
        `<FeCabResp><Cuit>${SAS_CUIT}</Cuit><PtoVta>${PV}</PtoVta><CbteTipo>${tipo}</CbteTipo><FchProceso>20261008093456</FchProceso><CantReg>1</CantReg><Resultado>${o.resultado}</Resultado><Reproceso>N</Reproceso></FeCabResp>` +
        `<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta><CbteFch>${fch}</CbteFch><Resultado>${o.resultado}</Resultado>` +
        msgs('Observaciones', 'Obs', o.obs ?? []) +
        `<CAE>${approved ? CAE : ''}</CAE><CAEFchVto>${approved ? '20261018' : ''}</CAEFchVto></FECAEDetResponse></FeDetResp>` +
        msgs('Errors', 'Err', o.errors ?? []) +
        '</FECAESolicitarResult></FECAESolicitarResponse>',
    ),
  }
}

/** `FECompConsultar` que encuentra el comprobante pedido (con lo que se mandó). */
function consultFound(req: CaeRequest, over: { totalCents?: number } = {}): ArcaHttpResponse {
  const a = req.amounts
  const money = (c: number) => (c / 100).toFixed(2)
  return {
    status: 200,
    body: ENVELOPE(
      '<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><ResultGet>' +
        `<Concepto>${req.concepto}</Concepto><DocTipo>${req.docTipo}</DocTipo><DocNro>${req.docNro}</DocNro>` +
        `<CbteDesde>${req.number}</CbteDesde><CbteHasta>${req.number}</CbteHasta><CbteFch>${ymd(req.cbteFch)}</CbteFch>` +
        `<ImpTotal>${money(over.totalCents ?? a.totalCents)}</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>${money(a.netCents)}</ImpNeto>` +
        `<ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>${money(a.vatCents)}</ImpIVA><MonId>PES</MonId><MonCotiz>1</MonCotiz>` +
        `<CondicionIVAReceptorId>${req.condicionIvaReceptorId}</CondicionIVAReceptorId>` +
        `<Resultado>A</Resultado><CodAutorizacion>${CAE}</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>20261018</FchVto>` +
        `<FchProceso>20261008093456</FchProceso><PtoVta>${req.ptoVta}</PtoVta><CbteTipo>${req.cbteTipo}</CbteTipo>` +
        '</ResultGet></FECompConsultarResult></FECompConsultarResponse>',
    ),
  }
}

function consultMissing(): ArcaHttpResponse {
  return {
    status: 200,
    body: ENVELOPE(
      '<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>' +
        '<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>' +
        '</FECompConsultarResult></FECompConsultarResponse>',
    ),
  }
}

// ─── El pedido de prueba ─────────────────────────────────────────────────────

/** Factura B a consumidor final por $ 121 (neto 100 + IVA 21 %). */
function requestFor(number: number, over: Partial<CaeRequest> = {}): CaeRequest {
  return {
    ptoVta: PV,
    cbteTipo: 6,
    number,
    concepto: 1,
    docTipo: 99,
    docNro: '0',
    cbteFch: '2026-10-08',
    amounts: {
      totalCents: 12_100,
      nonTaxedCents: 0,
      netCents: 10_000,
      exemptCents: 0,
      tributesCents: 0,
      vatCents: 2_100,
      unsupportedCents: 0,
      iva: [{ id: 5, rateBp: 2100, baseCents: 10_000, vatCents: 2_100 }],
    },
    condicionIvaReceptorId: 5,
    ...over,
  }
}

const FORM: ArcaStoredForm = {
  v: 1,
  kind: 'sale',
  emissionKey: '00000000-0000-4000-8000-0000000000e1',
  values: { docKind: 'sales_invoice' },
  previewHash: 'a'.repeat(64),
  warningsAck: [],
  detail: 'Catering para 40 personas',
  partyId: null,
  testKind: null,
}

function plan(predictedNumber: number | null, over: Partial<EmissionPlan> = {}): EmissionPlan {
  return {
    pointOfSale: PV,
    cbteTipo: 6,
    predictedNumber,
    request: (n) => requestFor(n),
    payload: {
      form: FORM,
      total_cents: 12_100,
      issue_date: '2026-10-08',
      related_voucher_id: null,
    },
    ...over,
  }
}

let rows: Row[]
let db: FakeVoucherDb
let transport: FakeTransport
let logs: string[]

function deps(over: Partial<EmitDeps> = {}): EmitDeps {
  return {
    rpc: db.rpc,
    tenantId: TENANT,
    environment: 'produccion',
    transport,
    auth: async () => ({ token: 'token-de-prueba', sign: 'sign-de-prueba', cuit: SAS_CUIT }),
    now,
    deadline: clock + EMIT_BUDGET_MS,
    loadVoucher: async (id) => parseVoucherRow(db.row(id)),
    ...over,
  }
}

const count = (method: string) => transport.calls.filter((c) => c.method === method).length
const statusOf = (id: string) => db.row(id)?.status

/** Un transporte con el último número `last` y la respuesta del CAE que se elija. */
function wsfeWith(
  last: number,
  cae: (req: ArcaHttpRequest) => ArcaHttpResponse | Promise<ArcaHttpResponse>,
  consult: (req: ArcaHttpRequest) => ArcaHttpResponse = () => consultMissing(),
): FakeTransport {
  return arcaTransport({
    'wsfe:FECompUltimoAutorizado': (req) => {
      const tipo = Number(/<ar:CbteTipo>(\d+)<\/ar:CbteTipo>/.exec(req.body)?.[1] ?? '0')
      return ultimoResponse(PV, tipo, last)
    },
    'wsfe:FECAESolicitar': cae,
    'wsfe:FECompConsultar': consult,
  })
}

beforeEach(() => {
  clock = START
  rows = []
  db = new FakeVoucherDb(rows)
  transport = wsfeWith(104, (req) => caeResponse(req, { resultado: 'A' }))
  logs = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─── Contrato con la base ────────────────────────────────────────────────────

describe('contrato con las RPC de la migración', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261008120120_acc_arca_rpc_vouchers.sql', import.meta.url),
    'utf8',
  )
  const params = (fn: string) => {
    const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`).exec(sql)
    return (m?.[1] ?? '')
      .split(',')
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean)
  }

  it('reserva y avanza con exactamente los parámetros de la migración', async () => {
    await runEmission(deps(), plan(105))
    const reserve = db.calls.find((c) => c.fn === 'acc_arca_voucher_reserve')
    const update = db.calls.find((c) => c.fn === 'acc_arca_voucher_update')
    expect(Object.keys(reserve?.args ?? {}).sort()).toEqual(
      params('acc_arca_voucher_reserve').sort(),
    )
    expect(Object.keys(update?.args ?? {}).sort()).toEqual(params('acc_arca_voucher_update').sort())
    // La lista blanca del payload de la reserva.
    expect(Object.keys(reserve?.args.p_payload as Row).sort()).toEqual(
      ['form', 'issue_date', 'related_voucher_id', 'total_cents'].sort(),
    )
  })
})

// ─── El camino feliz ─────────────────────────────────────────────────────────

describe('emitir', () => {
  it('aprobada: reserva → pidiendo → autorizada, con un solo FECAESolicitar', async () => {
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('authorized')
    if (outcome.kind !== 'authorized') return
    expect(outcome).toMatchObject({
      number: 105,
      cae: CAE,
      caeDue: '2026-10-18',
      reconciled: false,
    })
    expect(outcome.persisted).toBe(true)
    expect(count('FECAESolicitar')).toBe(1)
    expect(count('FECompConsultar')).toBe(0)
    const row = db.row(outcome.voucherId)
    expect(row?.status).toBe('authorized')
    expect(row?.client_ref).toBe(outcome.clientRef)
    // Lo que se guarda es exactamente lo que se mandó (sin Auth), con su hash.
    const record = caeRequestRecord(requestFor(105))
    expect(row?.request).toEqual(record)
    expect(row?.request_sha256).toBe(requestSha256(record))
    expect(JSON.stringify(row?.request)).not.toContain('token-de-prueba')
    expect(readCaeRecord(row?.request)).toEqual({
      ...requestFor(105),
      serviceFrom: null,
      serviceTo: null,
      paymentDue: null,
      associated: [],
    })
    expect(db.calls.map((c) => [c.fn, c.args.p_to ?? null])).toEqual([
      ['acc_arca_voucher_reserve', null],
      ['acc_arca_voucher_update', 'requesting'],
      ['acc_arca_voucher_update', 'authorized'],
    ])
  })

  it('aprobada con observaciones: se guardan y vuelven (no frenan)', async () => {
    transport = wsfeWith(104, (req) =>
      caeResponse(req, { resultado: 'A', obs: [[10217, 'El credito fiscal discriminado…']] }),
    )
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('authorized')
    if (outcome.kind !== 'authorized') return
    expect(outcome.observations).toEqual([{ code: 10217, msg: 'El credito fiscal discriminado…' }])
    expect(db.row(outcome.voucherId)?.observations).toEqual([
      { code: 10217, msg: 'El credito fiscal discriminado…' },
    ])
  })

  it('rechazada con observaciones: queda rechazada, con su clave, y el número queda libre', async () => {
    transport = wsfeWith(104, (req) =>
      caeResponse(req, {
        resultado: 'R',
        obs: [
          [
            10016,
            'El numero o fecha del comprobante no se corresponde con el proximo a autorizar.',
          ],
        ],
      }),
    )
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind !== 'rejected') return
    expect(outcome.errorKey).toBe('arca_number_mismatch')
    expect(outcome.messages[0]?.code).toBe(10016)
    expect(statusOf(outcome.voucherId)).toBe('rejected')
    expect(count('FECAESolicitar')).toBe(1)
    // Nada vivo: se puede volver a reservar ese punto de venta y tipo.
    transport = wsfeWith(104, (req) => caeResponse(req, { resultado: 'A' }))
    const again = await runEmission(deps(), plan(105))
    expect(again.kind).toBe('authorized')
  })

  it('rechazada por la condición del cliente: clave para marcar el campo', async () => {
    transport = wsfeWith(104, (req) =>
      caeResponse(req, {
        resultado: 'R',
        obs: [[10243, 'El campo Condicion Frente al IVA del receptor no es valido para la clase']],
      }),
    )
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind === 'rejected' && outcome.errorKey).toBe('arca_receiver_condition')
  })

  it('el número cambió: se suelta la reserva y no se pide el CAE', async () => {
    transport = wsfeWith(105, (req) => caeResponse(req, { resultado: 'A' }))
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome).toEqual({ kind: 'number_changed', nextNumber: 106 })
    expect(count('FECAESolicitar')).toBe(0)
    expect(rows[0]?.status).toBe('abandoned')
    expect(rows[0]?.reason).toBe('number_changed')
  })

  it('la prueba de homologación usa el número que dé ARCA', async () => {
    const outcome = await runEmission(deps({ environment: 'homologacion' }), plan(null))
    expect(outcome.kind === 'authorized' && outcome.number).toBe(105)
  })

  it('un pedido que ARCA rechazaría no sale y suelta la reserva', async () => {
    const bad = plan(105, { request: (n) => requestFor(n, { docTipo: 99, cbteTipo: 1 }) })
    const outcome = await runEmission(deps(), { ...bad, cbteTipo: 1 })
    expect(outcome.kind).toBe('not_started')
    if (outcome.kind === 'not_started') expect(outcome.cause.kind).toBe('request')
    expect(count('FECAESolicitar')).toBe(0)
    expect(rows[0]?.status).toBe('abandoned')
  })
})

// ─── Cortes y verificación ───────────────────────────────────────────────────

describe('respuesta perdida', () => {
  it('timeout → en verificación → FECompConsultar la encuentra → autorizada (sin reenviar)', async () => {
    transport = wsfeWith(
      104,
      () => {
        throw new ArcaFault('timeout', 'timeout')
      },
      () => consultFound(requestFor(105)),
    )
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('authorized')
    if (outcome.kind !== 'authorized') return
    expect(outcome.reconciled).toBe(true)
    expect(outcome.cae).toBe(CAE)
    expect(count('FECAESolicitar')).toBe(1)
    expect(count('FECompConsultar')).toBe(1)
    expect(statusOf(outcome.voucherId)).toBe('authorized')
    expect(db.calls.map((c) => c.args.p_to ?? null)).toEqual([
      null,
      'requesting',
      'needs_reconcile',
      'authorized',
    ])
  })

  it('timeout y ARCA no la tiene todavía: queda en verificación (nunca se reemite)', async () => {
    transport = wsfeWith(104, () => {
      throw new ArcaFault('timeout', 'timeout')
    })
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('unknown')
    if (outcome.kind !== 'unknown') return
    expect(statusOf(outcome.voucherId)).toBe('needs_reconcile')
    expect(count('FECAESolicitar')).toBe(1)
    expect(count('FECompConsultar')).toBe(1)

    // Mientras está viva, otra emisión del mismo tipo no sale.
    const second = await runEmission(deps(), plan(105))
    expect(second.kind).toBe('not_started')
    if (second.kind === 'not_started') {
      expect(second.cause.kind).toBe('store')
      if (second.cause.kind === 'store')
        expect(second.cause.error.key).toBe('arca_voucher_in_flight')
    }
    expect(count('FECAESolicitar')).toBe(1)
  })

  it('verificar más tarde: «no existe» pasado el rato → no emitida', async () => {
    transport = wsfeWith(104, () => {
      throw new ArcaFault('timeout', 'timeout')
    })
    const first = await runEmission(deps(), plan(105))
    if (first.kind !== 'unknown') throw new Error('se esperaba en verificación')

    // Recién emitida: todavía es pronto para darla por no emitida.
    clock += 30_000
    const soon = await reconcileVoucher(deps(), parseVoucherRow(db.row(first.voucherId)) as never)
    expect(soon.kind).toBe('too_soon')
    expect(statusOf(first.voucherId)).toBe('needs_reconcile')

    clock += RECONCILE_SAFE_AFTER_MS
    const later = await reconcileVoucher(deps(), parseVoucherRow(db.row(first.voucherId)) as never)
    expect(later.kind).toBe('not_emitted')
    expect(statusOf(first.voucherId)).toBe('failed')
    expect(count('FECAESolicitar')).toBe(1)
  })

  it('verificar más tarde: la encuentra → autorizada con el CAE de ARCA', async () => {
    transport = wsfeWith(104, () => {
      throw new ArcaFault('network', 'ECONNRESET')
    })
    const first = await runEmission(deps(), plan(105))
    if (first.kind !== 'unknown') throw new Error('se esperaba en verificación')
    transport.routes['wsfe:FECompConsultar'] = () => consultFound(requestFor(105))
    clock += 5 * MIN
    const settled = await reconcileVoucher(
      deps(),
      parseVoucherRow(db.row(first.voucherId)) as never,
    )
    expect(settled.kind).toBe('authorized')
    expect(db.row(first.voucherId)).toMatchObject({
      status: 'authorized',
      cae: CAE,
      cae_due: '2026-10-18',
    })
  })

  it('verificar: un comprobante con ese número que no coincide no se da por bueno', async () => {
    transport = wsfeWith(104, () => {
      throw new ArcaFault('timeout', 'timeout')
    })
    const first = await runEmission(deps(), plan(105))
    if (first.kind !== 'unknown') throw new Error('se esperaba en verificación')
    transport.routes['wsfe:FECompConsultar'] = () =>
      consultFound(requestFor(105), { totalCents: 999 })
    clock += 5 * MIN
    const settled = await reconcileVoucher(
      deps(),
      parseVoucherRow(db.row(first.voucherId)) as never,
    )
    expect(settled.kind).toBe('mismatch')
    expect(statusOf(first.voucherId)).toBe('needs_reconcile')
    // El log lleva los campos, nunca los valores.
    expect(logs.join('\n')).toContain('ImpTotal')
    expect(logs.join('\n')).not.toContain('999')
  })

  it('un corte antes de conectar (ECONNREFUSED) → no emitida enseguida, sin consultar', async () => {
    transport = wsfeWith(104, () => {
      throw new ArcaFault('network', 'ECONNREFUSED')
    })
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('not_emitted')
    if (outcome.kind === 'not_emitted') expect(statusOf(outcome.voucherId)).toBe('failed')
    expect(count('FECompConsultar')).toBe(0)
    expect(failedBeforeSending(new ArcaFault('network', 'ECONNRESET'))).toBe(false)
    expect(failedBeforeSending(new ArcaFault('timeout', 'timeout'))).toBe(false)
    expect(failedBeforeSending(new ArcaFault('network', 'deadline'))).toBe(true)
  })

  it('uno que quedó pidiendo el CAE: recién se toca pasados 2 minutos', async () => {
    transport = wsfeWith(
      104,
      () => new Promise<ArcaHttpResponse>(() => {}), // la función «murió» esperando
    )
    void runEmission(deps(), plan(105))
    for (let i = 0; i < 50 && rows[0]?.status !== 'requesting'; i++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    const row = rows[0]
    if (!row) throw new Error('sin comprobante')
    expect(row.status).toBe('requesting')

    const fresh = await reconcileVoucher(deps(), parseVoucherRow(row) as never)
    expect(fresh.kind).toBe('in_progress')

    clock += STALE_REQUESTING_MS
    transport.routes['wsfe:FECompConsultar'] = () => consultFound(requestFor(105))
    const settled = await reconcileVoucher(deps(), parseVoucherRow(db.row(String(row.id))) as never)
    expect(settled.kind).toBe('authorized')
    expect(db.row(String(row.id))?.status).toBe('authorized')
  })

  it('la reserva encuentra una colgada de más de 3 minutos: la verifica y sigue', async () => {
    transport = wsfeWith(104, () => {
      throw new ArcaFault('timeout', 'timeout')
    })
    const first = await runEmission(deps(), plan(105))
    if (first.kind !== 'unknown') throw new Error('se esperaba en verificación')

    clock += 4 * MIN
    // ARCA nunca la tuvo: la colgada queda «no emitida» y la nueva sale con el mismo número.
    transport = wsfeWith(104, (req) => caeResponse(req, { resultado: 'A' }))
    const outcome = await runEmission(deps(), plan(105))
    expect(statusOf(first.voucherId)).toBe('failed')
    expect(outcome.kind).toBe('authorized')
  })
})

// ─── Tiempo ──────────────────────────────────────────────────────────────────

describe('plazo', () => {
  it('sin tiempo para el pedido de CAE no se reserva nada', async () => {
    const outcome = await runEmission(deps({ deadline: clock + CAE_MIN_START_MS }), plan(105))
    expect(outcome).toEqual({ kind: 'not_started', cause: { kind: 'timeout' } })
    expect(db.calls).toHaveLength(0)
    expect(transport.calls).toHaveLength(0)
  })

  it('si el número tarda, se suelta la reserva y no se pide el CAE', async () => {
    transport.routes['wsfe:FECompUltimoAutorizado'] = () => {
      clock += 30_000 // ARCA tardó
      return ultimoResponse(PV, 6, 104)
    }
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome).toEqual({ kind: 'not_started', cause: { kind: 'timeout' } })
    expect(count('FECAESolicitar')).toBe(0)
    expect(rows[0]).toMatchObject({ status: 'abandoned', reason: 'no_time' })
  })

  it('el pedido de CAE lleva el tope que le queda (nunca pasa el plazo)', async () => {
    const outcome = await runEmission(deps(), plan(105))
    expect(outcome.kind).toBe('authorized')
    const cae = transport.calls.find((c) => c.method === 'FECAESolicitar')
    expect(cae?.req.timeoutMs).toBeLessThanOrEqual(CAE_TIMEOUT_MAX_MS)
    expect(cae?.req.timeoutMs).toBeLessThanOrEqual(EMIT_BUDGET_MS - AFTER_CAE_RESERVE_MS)
  })
})

// ─── Homologación nunca va a los libros ──────────────────────────────────────

describe('homologación', () => {
  it('una autorizada de prueba no se puede vincular con un asiento', async () => {
    const outcome = await runEmission(deps({ environment: 'homologacion' }), plan(null))
    if (outcome.kind !== 'authorized') throw new Error('se esperaba autorizada')
    await expect(
      linkVoucherDocument(deps(), outcome.voucherId, '00000000-0000-4000-8000-0000000000d1'),
    ).rejects.toMatchObject({ key: 'arca_voucher_document_mismatch' })
    expect(statusOf(outcome.voucherId)).toBe('authorized')
  })

  describe('emitArcaTestVoucher (la acción)', () => {
    let tables: TableRows
    let tickets: FakeTicketDb

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(START)
      vi.stubEnv('META_TOKEN_KEY', SECRET)
      _resetRateLimit()
      tables = {
        acc_arca_connections: [
          {
            id: CONNECTION_ID,
            tenant_id: TENANT,
            environment: 'homologacion',
            status: 'connected',
            represented_cuit: SAS_CUIT,
            cert_cuit: '20123456786',
            alias: 'plataformatest',
            public_key_sha256: 'b'.repeat(64),
            pending_public_key_sha256: null,
            cert_serial: '01',
            cert_issuer: 'AC de prueba',
            cert_not_before: '2026-09-10T00:00:00+00:00',
            cert_not_after: '2028-09-10T00:00:00+00:00',
            point_of_sale: PV,
            allowed_classes: ['B'],
            default_concepto: 1,
            emission_enabled: false,
            services: {},
            last_test_at: null,
            last_test: null,
            last_error_key: null,
            updated_at: '2026-10-08T11:00:00+00:00',
          },
        ],
        acc_arca_vouchers: [],
      }
      const vouchers = new FakeVoucherDb(tables.acc_arca_vouchers as Row[])
      tickets = new FakeTicketDb(() => new Date(), {
        privateKeyPem: fixtureText(CRYPTO.testKey),
        certificatePem: fixtureText(CRYPTO.issuedCrt),
      })
      // Un ticket vigente: no hace falta login.
      tickets.storeValid('homologacion', 'wsfe', 'token-guardado', new Date(START + 6 * 3_600_000))
      tickets.others.set('acc_arca_voucher_reserve', (args) => {
        clock = Date.now()
        return vouchers.reserve(args)
      })
      tickets.others.set('acc_arca_voucher_update', (args) => {
        clock = Date.now()
        return vouchers.update(args)
      })
      transport = wsfeWith(11, (req) => caeResponse(req, { resultado: 'A' }))
      vi.mocked(createClient).mockImplementation(
        async () => fakeSupabase(tables, tickets.rpc) as never,
      )
      vi.mocked(getTransport).mockImplementation(() => transport)
      vi.mocked(authorizeAccounting).mockResolvedValue({
        ok: true,
        tenantId: TENANT,
        userId: '00000000-0000-4000-8000-0000000000cc',
        slug: 'hub',
        access: {} as never,
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('Factura B a consumidor final por $ 121: autorizada y sin asiento', async () => {
      const res = await emitArcaTestVoucher('hub', { kind: 'factura_b' })
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.data).toMatchObject({ kind: 'factura_b', cae: CAE, number: 12 })
      expect(res.data.label).toBe('Factura B 0005-00000012')
      const row = tables.acc_arca_vouchers?.[0]
      expect(row).toMatchObject({
        environment: 'homologacion',
        status: 'authorized',
        document_id: null,
      })
      expect(row?.total_cents).toBe(12_100)
      // Nunca se llamó a contabilizar (la RPC falsa tira con cualquier otra).
      expect(tickets.calls.map((c) => c.fn)).not.toContain('acc_post_bundle')
      const sent = transport.calls.find((c) => c.method === 'FECAESolicitar')?.req.body ?? ''
      expect(sent).toContain('<ar:ImpTotal>121.00</ar:ImpTotal>')
      expect(sent).toContain('<ar:DocTipo>99</ar:DocTipo>')
      expect(sent).toContain('<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>')
    })

    it('nota de crédito B: asociada a la última Factura B de prueba', async () => {
      const first = await emitArcaTestVoucher('hub', { kind: 'factura_b' })
      expect(first.ok).toBe(true)
      transport.routes['wsfe:FECompUltimoAutorizado'] = (req) => {
        const tipo = Number(/<ar:CbteTipo>(\d+)<\/ar:CbteTipo>/.exec(req.body)?.[1] ?? '0')
        return ultimoResponse(PV, tipo, tipo === 8 ? 3 : 12)
      }
      const res = await emitArcaTestVoucher('hub', { kind: 'nota_credito_b' })
      expect(res.ok).toBe(true)
      const sent = transport.calls.filter((c) => c.method === 'FECAESolicitar')[1]?.req.body ?? ''
      expect(sent).toContain(
        '<ar:CbteAsoc><ar:Tipo>6</ar:Tipo><ar:PtoVta>5</ar:PtoVta><ar:Nro>12</ar:Nro>',
      )
    })

    it('sin conexión de homologación probada no emite nada', async () => {
      ;(tables.acc_arca_connections?.[0] as Row).status = 'cert_ready'
      const res = await emitArcaTestVoucher('hub', { kind: 'factura_b' })
      expect(res.ok).toBe(false)
      expect(transport.calls).toHaveLength(0)
      expect(tables.acc_arca_vouchers).toHaveLength(0)
    })

    it('la contadora (solo lectura) no puede', async () => {
      vi.mocked(authorizeAccounting).mockResolvedValue({
        ok: false,
        state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
      })
      const res = await emitArcaTestVoucher('hub', { kind: 'factura_b' })
      expect(res).toMatchObject({ ok: false, code: 'forbidden' })
      expect(transport.calls).toHaveLength(0)
    })
  })
})

// ─── Un reintento del mismo envío ────────────────────────────────────────────

describe('emitArcaSalesVoucher: el mismo envío nunca emite dos veces', () => {
  const KEY = '00000000-0000-4000-8000-0000000000e9'
  const PARTY = '00000000-0000-4000-8000-0000000000a1'
  const DOC = '00000000-0000-4000-8000-0000000000d9'
  let tables: TableRows
  let tickets: FakeTicketDb

  const values = {
    clientRef: KEY,
    previewHash: 'b'.repeat(64),
    warningsAck: [],
    docKind: 'sales_invoice' as const,
    partyId: PARTY,
    voucherType: 'factura_b' as const,
    pointOfSale: PV,
    number: 105,
    issueDate: '2026-10-08',
    aliquots: [{ vatRateBp: 2100 as const, netCents: 10_000, vatAdjustCents: 0 }],
    arca: {
      predictedNumber: 105,
      condicionIvaReceptorId: 5,
      detail: 'Catering para 40 personas',
    },
  }

  function voucherRow(status: string, over: Row = {}): Row {
    return {
      id: randomUUID(),
      tenant_id: TENANT,
      environment: 'produccion',
      status,
      point_of_sale: PV,
      cbte_tipo: 6,
      number: 105,
      client_ref: randomUUID(),
      form: { ...FORM, emissionKey: KEY },
      // Lo que lee el filtro `form->>emissionKey` en la base falsa.
      'form->>emissionKey': KEY,
      request: caeRequestRecord(requestFor(105)),
      cae: status === 'posted' ? CAE : null,
      cae_due: status === 'posted' ? '2026-10-18' : null,
      fch_proceso: null,
      observations: [],
      errors: [],
      document_id: status === 'posted' ? DOC : null,
      related_voucher_id: null,
      total_cents: 12_100,
      issue_date: '2026-10-08',
      reason: null,
      created_at: new Date(START).toISOString(),
      updated_at: new Date(START).toISOString(),
      ...over,
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    vi.stubEnv('META_TOKEN_KEY', SECRET)
    _resetRateLimit()
    tables = {
      acc_arca_connections: [
        {
          id: CONNECTION_ID,
          tenant_id: TENANT,
          environment: 'produccion',
          status: 'connected',
          represented_cuit: SAS_CUIT,
          cert_cuit: SAS_CUIT,
          alias: 'barplataforma',
          public_key_sha256: 'b'.repeat(64),
          cert_not_after: '2028-09-10T00:00:00+00:00',
          point_of_sale: PV,
          allowed_classes: ['B'],
          default_concepto: 1,
          emission_enabled: true,
          services: {},
          updated_at: '2026-10-08T11:00:00+00:00',
        },
      ],
      acc_arca_vouchers: [],
    }
    tickets = new FakeTicketDb(() => new Date(), {
      privateKeyPem: fixtureText(CRYPTO.testKey),
      certificatePem: fixtureText(CRYPTO.issuedCrt),
    })
    transport = wsfeWith(104, (req) => caeResponse(req, { resultado: 'A' }))
    vi.mocked(createClient).mockImplementation(
      async () => fakeSupabase(tables, tickets.rpc) as never,
    )
    vi.mocked(getTransport).mockImplementation(() => transport)
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: true,
      tenantId: TENANT,
      userId: '00000000-0000-4000-8000-0000000000cc',
      slug: 'hub',
      access: {} as never,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ya emitida y cargada: devuelve la misma, sin hablar con ARCA', async () => {
    tables.acc_arca_vouchers?.push(voucherRow('posted'))
    const res = await emitArcaSalesVoucher('hub', values)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toMatchObject({ replayed: true, cae: CAE, documentId: DOC, number: 105 })
    expect(transport.calls).toHaveLength(0)
    expect(tickets.calls.map((c) => c.fn)).not.toContain('acc_arca_voucher_reserve')
  })

  it('en verificación: «no la vuelvas a emitir», sin pedir otro CAE', async () => {
    tables.acc_arca_vouchers?.push(voucherRow('needs_reconcile'))
    const res = await emitArcaSalesVoucher('hub', values)
    expect(res).toMatchObject({ ok: false, detail: { key: 'arca_unknown_state' } })
    expect(transport.calls).toHaveLength(0)
    expect(tickets.calls.map((c) => c.fn)).not.toContain('acc_arca_voucher_reserve')
  })

  it('la contadora (solo lectura) no puede emitir', async () => {
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
    })
    const res = await emitArcaSalesVoucher('hub', values)
    expect(res).toMatchObject({ ok: false, code: 'forbidden' })
    expect(transport.calls).toHaveLength(0)
  })

  it('con la emisión apagada no emite', async () => {
    const conn = tables.acc_arca_connections?.[0] as Row
    conn.emission_enabled = false
    const res = await emitArcaSalesVoucher('hub', values)
    expect(res).toMatchObject({ ok: false, detail: { key: 'arca_emission_disabled' } })
    expect(transport.calls).toHaveLength(0)
  })
})
