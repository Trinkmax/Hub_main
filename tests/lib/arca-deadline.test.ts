/**
 * El plazo duro de las acciones de ARCA (cierre de la fase 2, §6.1 punto 2): la cuenta
 * del plazo con un reloj falso, el transporte que recorta cada llamada, la regla del
 * login (nunca con menos de 20 s por delante) y «Probar conexión» de punta a punta con
 * un ARCA lento simulado (cada llamada mueve el reloj falso lo que «tarda»; si tarda
 * más que su tope, se corta en el tope, como el transporte de verdad).
 *
 * Lo que importa: que ninguna llamada termine después del plazo menos 3 s, que un
 * login al WSAA no se empiece sin tiempo (si Vercel corta la función en el medio, ARCA
 * puede dar un TA que se pierde) y que eso quede como «no se llegó a probar», sin
 * cooldown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { runConnectionTest } from '@/lib/arca/connection-test'
import { classifyArcaError } from '@/lib/arca/errors'
import {
  acquireTicket,
  arcaDeadline,
  canStartLogin,
  createArcaSession,
  DEADLINE_MARGIN_MS,
  deadlineTimeout,
  isDeadlineFault,
  LOGIN_MIN_REMAINING_MS,
  MIN_CALL_MS,
  type TicketDeps,
  withDeadline,
} from '@/lib/arca/session'
import { ArcaFault, type ArcaTransport } from '@/lib/arca/soap'
import type { ArcaRpc } from '@/lib/arca/store'
import { createWsfe } from '@/lib/arca/wsfe'
import { ARCA_CRYPTO_FILES as CRYPTO, fixtureText } from '@/tests/fixtures/arca/crypto-fixtures'
import { ARCA_XML } from '@/tests/fixtures/arca/xml/fixtures'
import {
  arcaTransport,
  callKind,
  FakeTicketDb,
  type FakeTransport,
  FIXTURE_TOKEN,
  fixtureResponse,
  happyTransport,
  SAS_CUIT,
  SECRET,
  TENANT,
} from './arca-fakes'

const KEY = fixtureText(CRYPTO.testKey)
const CERT = fixtureText(CRYPTO.issuedCrt)
const START = new Date('2026-10-08T12:00:00.000Z').getTime()
const HOUR = 3_600_000

let t = START
const now = () => new Date(t)
let sleeps: number[] = []
const sleep = async (ms: number) => {
  sleeps.push(ms)
  t += ms
}
let db: FakeTicketDb
let logs: string[] = []

/** Un pedido como lo vio el transporte: cuándo salió y con qué tope. */
type Seen = { readonly call: string; readonly wsn: string | null; at: number; timeoutMs: number }

/**
 * ARCA lento: cada pedido mueve el reloj falso lo que «tarda» (`latency`, 1 s si no
 * dice). Si tarda más que su tope, el reloj avanza el tope y sale `timeout`, como el
 * transporte de verdad. Lo que contesta, lo contesta `inner`.
 */
function slowTransport(
  inner: FakeTransport,
  latency: Readonly<Record<string, number>>,
): ArcaTransport & { readonly seen: Seen[] } {
  const seen: Seen[] = []
  const transport = (async (req) => {
    const kind = callKind(req)
    const call = `${kind.service}:${kind.method}`
    seen.push({ call, wsn: kind.wsn, at: t, timeoutMs: req.timeoutMs })
    const ms = latency[call] ?? 1_000
    if (ms > req.timeoutMs) {
      t += req.timeoutMs
      throw new ArcaFault('timeout', 'timeout')
    }
    t += ms
    return inner(req)
  }) as ArcaTransport & { readonly seen: Seen[] }
  Object.assign(transport, { seen })
  return transport
}

function deps(transport: ArcaTransport, overrides: Partial<TicketDeps> = {}): TicketDeps {
  return {
    rpc: db.rpc,
    tenantId: TENANT,
    environment: 'produccion',
    secretKey: SECRET,
    transport,
    now,
    sleep,
    ...overrides,
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('se esperaba que fallara')
    },
    (e: unknown) => e,
  )
}

beforeEach(() => {
  t = START
  sleeps = []
  db = new FakeTicketDb(now, { privateKeyPem: KEY, certificatePem: CERT })
  logs = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const line of logs) {
    expect(line).not.toContain(SECRET)
    expect(line).not.toContain(FIXTURE_TOKEN.slice(0, 40))
  }
})

describe('la cuenta del plazo', () => {
  it('lo que queda, el tope de cada llamada (lo que queda − 3 s) y cuándo ya no se empieza', () => {
    const d = arcaDeadline(50_000, now)
    expect(d.at).toBe(START + 50_000)
    expect(d.remaining()).toBe(50_000)
    // Con tiempo de sobra, cada llamada usa su propio tope.
    expect(deadlineTimeout(d, 12_000)).toBe(12_000)
    t += 40_000 // quedan 10 s
    expect(deadlineTimeout(d, 12_000)).toBe(10_000 - DEADLINE_MARGIN_MS)
    t += 6_000 // quedan 4 s: justo 1 s de tope
    expect(deadlineTimeout(d, 12_000)).toBe(MIN_CALL_MS)
    t += 1 // ya no entra una llamada
    expect(deadlineTimeout(d, 12_000)).toBeNull()
    t += 60_000 // pasado el plazo
    expect(d.remaining()).toBeLessThan(0)
    expect(deadlineTimeout(d, 12_000)).toBeNull()
    // Sin plazo, el tope de siempre.
    expect(deadlineTimeout(undefined, 12_000)).toBe(12_000)
    expect(deadlineTimeout(null, 25_000)).toBe(25_000)
  })

  it('un login al WSAA se empieza solo con 20 s o más por delante', () => {
    const d = arcaDeadline(50_000, now)
    t += 50_000 - LOGIN_MIN_REMAINING_MS // quedan 20 s justos
    expect(canStartLogin(d)).toBe(true)
    t += 1
    expect(canStartLogin(d)).toBe(false)
    expect(canStartLogin(undefined)).toBe(true)
  })

  it('el transporte con plazo recorta el tope y no manda lo que no entra (tampoco el reintento)', async () => {
    const inner = arcaTransport({
      'wsfe:FEDummy': fixtureResponse(ARCA_XML.wsfeDummyProduccion),
    })
    const d = arcaDeadline(50_000, now)
    const wsfe = createWsfe(
      withDeadline(inner, d),
      'produccion',
      async () => ({ token: 'T', sign: 'S', cuit: SAS_CUIT }),
      { timeoutMs: 12_000 },
    )
    await wsfe.dummy()
    t += 40_000 // quedan 10 s
    await wsfe.dummy()
    expect(inner.calls.map((c) => c.req.timeoutMs)).toEqual([12_000, 7_000])
    t += 6_500 // quedan 3,5 s
    const e = await rejection(wsfe.dummy())
    expect(isDeadlineFault(e)).toBe(true)
    expect(e).toMatchObject({ kind: 'network', code: 'deadline', service: 'wsfe' })
    // Para la pantalla es «ARCA no responde»: no es un bug ni algo para arreglar en ARCA.
    expect(classifyArcaError(e)).toBe('arca_unavailable')
    // WSFE reintenta una vez los errores de red: el reintento tampoco sale.
    expect(inner.calls).toHaveLength(2)
  })
})

describe('el ticket con plazo (acquireTicket)', () => {
  const loginTransport = () => happyTransport(now)

  it('con menos de 20 s no empieza el login: devuelve el turno SIN cooldown y no abre la clave', async () => {
    const transport = loginTransport()
    const e = await rejection(
      acquireTicket(deps(transport, { deadline: arcaDeadline(19_000, now) }), 'wsfe'),
    )
    expect(isDeadlineFault(e)).toBe(true)
    expect(e).toMatchObject({ service: 'wsaa', wsn: 'wsfe', method: 'loginCms' })
    expect(transport.calls).toHaveLength(0)
    // Ni siquiera se descifró la clave privada.
    expect(db.calls.map((c) => c.fn)).toEqual(['acc_arca_ticket_get', 'acc_arca_ticket_put'])
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_unavailable',
      cooldown: null,
    })
    expect(db.row('produccion', 'wsfe')).toMatchObject({
      leaseId: null,
      cooldownUntil: null,
      cooldownManual: false,
    })
    // La próxima acción, con tiempo, hace el login enseguida (no quedó ninguna espera).
    const ticket = await acquireTicket(
      deps(transport, { deadline: arcaDeadline(50_000, now) }),
      'wsfe',
    )
    expect(ticket.source).toBe('login')
  })

  it('si el tiempo se va mientras se cargan las credenciales, tampoco lo empieza', async () => {
    const transport = loginTransport()
    // La base tarda 2 s en devolver la clave: de 21 s quedan 19.
    const rpc: ArcaRpc = async (fn, args) => {
      if (fn === 'acc_arca_get_credentials') t += 2_000
      return db.rpc(fn, args)
    }
    const e = await rejection(
      acquireTicket(deps(transport, { rpc, deadline: arcaDeadline(21_000, now) }), 'wsfe'),
    )
    expect(isDeadlineFault(e)).toBe(true)
    expect(transport.calls).toHaveLength(0)
    expect(db.calls.map((c) => c.fn)).toEqual([
      'acc_arca_ticket_get',
      'acc_arca_get_credentials',
      'acc_arca_ticket_put',
    ])
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toMatchObject({ cooldown: null })
  })

  it('con 20 s o más, el login tiene de tope lo que queda − 3 s (nunca más que el suyo)', async () => {
    const transport = loginTransport()
    // 21 s por delante y el tope de siempre (25 s): queda en 18 s.
    await acquireTicket(deps(transport, { deadline: arcaDeadline(21_000, now) }), 'wsfe')
    // Con tiempo de sobra, el tope del login (15 s en «Probar conexión»).
    await acquireTicket(
      deps(transport, { deadline: arcaDeadline(50_000, now), loginTimeoutMs: 15_000 }),
      'ws_sr_constancia_inscripcion',
    )
    expect(transport.calls.map((c) => [c.wsn, c.req.timeoutMs])).toEqual([
      ['wsfe', 18_000],
      ['ws_sr_constancia_inscripcion', 15_000],
    ])
  })

  it('un TA guardado se usa aunque quede poco tiempo (no hace falta login)', async () => {
    db.storeValid('produccion', 'wsfe', FIXTURE_TOKEN, new Date(t + 6 * HOUR))
    const transport = loginTransport()
    const ticket = await acquireTicket(
      deps(transport, { deadline: arcaDeadline(2_000, now) }),
      'wsfe',
    )
    expect(ticket).toMatchObject({ token: FIXTURE_TOKEN, source: 'cache' })
    expect(transport.calls).toHaveLength(0)
  })

  it('no espera a otra instancia si después no quedaría tiempo para usar su ticket', async () => {
    const other = db.row('produccion', 'wsfe')
    other.leaseId = 'otra-instancia'
    other.leaseUntil = t + 120_000
    // 9 s: espera tres veces (1,5 s cada una) y frena cuando ya no le quedarían 4 s.
    const e = await rejection(
      acquireTicket(deps(loginTransport(), { deadline: arcaDeadline(9_000, now) }), 'wsfe'),
    )
    expect(isDeadlineFault(e)).toBe(true)
    expect(sleeps).toEqual([1_500, 1_500, 1_500])
    expect(db.callsTo('acc_arca_ticket_get')).toHaveLength(4)
    expect(db.callsTo('acc_arca_ticket_put')).toHaveLength(0)
  })
})

describe('«Probar conexión» con un ARCA lento (plazo de 50 s)', () => {
  /** La prueba entera con la sesión y los chequeos compartiendo el mismo plazo. */
  async function run(latency: Readonly<Record<string, number>>, allowedClasses = ['B']) {
    const inner = happyTransport(now)
    const transport = slowTransport(inner, latency)
    const deadline = arcaDeadline(50_000, now)
    const session = createArcaSession({
      rpc: db.rpc,
      tenantId: TENANT,
      environment: 'produccion',
      representedCuit: SAS_CUIT,
      secretKey: SECRET,
      transport,
      now,
      sleep,
      clearManualCooldown: true,
      timeoutMs: 12_000,
      loginTimeoutMs: 15_000,
      deadline,
    })
    const result = await runConnectionTest({
      session,
      environment: 'produccion',
      representedCuit: SAS_CUIT,
      pointOfSale: 5,
      allowedClasses,
      certNotAfter: new Date('2028-09-10T00:00:00.000Z'),
      sasLegalName: 'Bar de Prueba SAS',
      now,
      deadline,
    })
    // Ninguna llamada pudo terminar después del plazo menos el margen.
    for (const call of transport.seen) {
      expect(call.at + call.timeoutMs, call.call).toBeLessThanOrEqual(
        deadline.at - DEADLINE_MARGIN_MS,
      )
    }
    return { result, transport, inner, deadline }
  }

  const summary = (checks: readonly { key: string; ok: boolean; error?: string | null }[]) =>
    checks.map((c) => [c.key, c.ok, c.error ?? null])

  it('con 15 s por delante no empieza el login del padrón: «no se llegó a probar», sin cooldown', async () => {
    const { result, inner } = await run({
      'wsfe:FEDummy': 5_000,
      'wsaa:loginCms': 5_000,
      'wsfe:FEParamGetPtosVenta': 10_000,
      'wsfe:FECompUltimoAutorizado': 10_000,
      'padron:dummy': 5_000,
    })
    expect(summary(result.checks)).toEqual([
      ['service', true, null],
      ['wsfe_ticket', true, null],
      ['relations', true, null],
      ['point_of_sale', true, null],
      ['numbering', true, null],
      ['padron', false, 'arca_unavailable'],
      ['certificate', true, null],
    ])
    expect(result.checks.find((c) => c.key === 'padron')?.detail).toEqual({
      timeout: true,
      not_started: true,
    })
    expect(result.status).toBe('error')
    // Un solo login (el de wsfe); el del padrón nunca salió.
    expect(inner.calls.filter((c) => c.service === 'wsaa').map((c) => c.wsn)).toEqual(['wsfe'])
    // El turno del padrón se devolvió sin cooldown: la próxima prueba lo intenta enseguida.
    expect(
      db
        .callsTo('acc_arca_ticket_put')
        .map((a) => [a.p_service, (a.p_result as { ok: boolean }).ok]),
    ).toEqual([
      ['wsfe', true],
      ['ws_sr_constancia_inscripcion', false],
    ])
    expect(db.row('produccion', 'ws_sr_constancia_inscripcion')).toMatchObject({
      leaseId: null,
      cooldownUntil: null,
      cooldownManual: false,
    })
    expect(t - START).toBe(35_000)
  })

  it('una llamada lenta se corta en lo que queda − 3 s, y lo que ya no entra no se empieza', async () => {
    const { result, transport } = await run({
      'wsfe:FEDummy': 11_000,
      'wsaa:loginCms': 11_000,
      'wsfe:FEParamGetPtosVenta': 11_000,
      'wsfe:FECompUltimoAutorizado': 11_000,
      'padron:dummy': 11_000,
    })
    // 0 → 11 (dummy) → 22 (login) → 33 (puntos de venta) → 44 (numeración, tope 12 s) →
    // padrón: quedan 6 s, tope 3 s, ARCA tarda 11: se corta a los 47.
    expect(transport.seen.map((c) => [c.call, c.at - START, c.timeoutMs])).toEqual([
      ['wsfe:FEDummy', 0, 12_000],
      ['wsaa:loginCms', 11_000, 15_000],
      ['wsfe:FEParamGetPtosVenta', 22_000, 12_000],
      ['wsfe:FECompUltimoAutorizado', 33_000, 12_000],
      ['padron:dummy', 44_000, 3_000],
    ])
    expect(summary(result.checks)).toEqual([
      ['service', true, null],
      ['wsfe_ticket', true, null],
      ['relations', true, null],
      ['point_of_sale', true, null],
      ['numbering', true, null],
      ['padron', false, 'arca_unavailable'],
      ['certificate', true, null],
    ])
    // Esta vez ARCA sí tardó (no es «no se llegó a probar»).
    expect(result.checks.find((c) => c.key === 'padron')?.detail).toEqual({ code: 'timeout' })
    expect(t - START).toBe(47_000)
  })

  it('cuando ya no entra ni una llamada, los chequeos que faltan no se empiezan', async () => {
    const { result, transport } = await run(
      {
        'wsfe:FEDummy': 12_000,
        'wsaa:loginCms': 15_000,
        'wsfe:FEParamGetPtosVenta': 12_000,
        // B tarda 7 s (t = 46): para la A queda 1 s de tope y ARCA tarda más.
        'wsfe:FECompUltimoAutorizado': 7_000,
      },
      ['A', 'B'],
    )
    expect(summary(result.checks)).toEqual([
      ['service', true, null],
      ['wsfe_ticket', true, null],
      ['relations', true, null],
      ['point_of_sale', true, null],
      ['numbering', false, 'arca_unavailable'],
      ['padron', false, 'arca_unavailable'],
      ['certificate', true, null],
    ])
    expect(result.checks.find((c) => c.key === 'numbering')?.detail).toMatchObject({
      '6': 104,
      code: 'timeout',
    })
    expect(result.checks.find((c) => c.key === 'padron')?.detail).toEqual({
      timeout: true,
      not_started: true,
    })
    // El padrón no se llegó a preguntar.
    expect(transport.seen.map((c) => c.call)).not.toContain('padron:dummy')
    expect(t - START).toBeLessThanOrEqual(50_000 - DEADLINE_MARGIN_MS)
  })
})
