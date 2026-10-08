/**
 * La sesión con ARCA (diseño §2.5): el ticket del WSAA cacheado en la base bajo un
 * lease, con la base y ARCA simulados (`FakeTicketDb` sigue las reglas de la
 * migración 20261008120110; el transporte es falso y la firma del TRA es la de
 * verdad, con la clave y el certificado de prueba).
 *
 * Lo que importa: nunca dos logins a la vez, `ticket_put` en snake_case, el
 * cooldown solo para lo que vino del WSAA (y `null` si falló antes), «ya posee un
 * TA válido» con su espera, `secret_unreadable` sin tocar el lease, y que nada de
 * eso termine en un log.
 */

import { createPublicKey } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { ARCA_ENDPOINTS } from '@/lib/arca/endpoints'
import { ArcaError, classifyArcaError } from '@/lib/arca/errors'
import {
  ArcaSecretsKeyError,
  loadCredentials,
  SECRETS_KEY_ENV,
  secretsKey,
} from '@/lib/arca/secrets'
import {
  ArcaCooldownError,
  acquireTicket,
  createArcaSession,
  TICKET_BUSY_WAIT_MS,
  TICKET_MAX_ATTEMPTS,
  type TicketDeps,
} from '@/lib/arca/session'
import { ArcaFault } from '@/lib/arca/soap'
import { ArcaStoreError, callArcaRpc } from '@/lib/arca/store'
import { decodeTokenRelations } from '@/lib/arca/wsaa'
import {
  ARCA_CRYPTO_FILES as CRYPTO,
  fixtureText,
  ISSUED_CRT,
} from '@/tests/fixtures/arca/crypto-fixtures'
import { ARCA_XML } from '@/tests/fixtures/arca/xml/fixtures'
import {
  arcaTransport,
  FakeTicketDb,
  type FakeTransport,
  FIXTURE_TOKEN,
  fixtureResponse,
  loginResponse,
  SAS_CUIT,
  SECRET,
  TENANT,
  wsaaFault,
} from './arca-fakes'

const KEY = fixtureText(CRYPTO.testKey)
const CERT = fixtureText(CRYPTO.issuedCrt)
const START = new Date('2026-10-08T12:00:00.000Z')
const MIN = 60_000
const HOUR = 3_600_000

let clock = START.getTime()
const now = () => new Date(clock)
let sleeps: number[] = []
let onSleep: ((ms: number) => void) | null = null
/** Avanza el reloj del test y deja correr lo que esté pendiente (otra «instancia»). */
const sleep = async (ms: number) => {
  sleeps.push(ms)
  clock += ms
  onSleep?.(ms)
  await new Promise((resolve) => setImmediate(resolve))
}

let db: FakeTicketDb
let transport: FakeTransport
let logs: string[] = []

function deps(overrides: Partial<TicketDeps> = {}): TicketDeps {
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

function session(opts: { environment?: 'produccion' | 'homologacion'; clear?: boolean } = {}) {
  return createArcaSession({
    rpc: db.rpc,
    tenantId: TENANT,
    environment: opts.environment ?? 'produccion',
    representedCuit: SAS_CUIT,
    secretKey: SECRET,
    transport,
    now,
    sleep,
    clearManualCooldown: opts.clear === true,
  })
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('se esperaba que fallara')
    },
    (e: unknown) => e,
  )
}

const logins = () => transport.calls.filter((c) => c.service === 'wsaa')

beforeEach(() => {
  clock = START.getTime()
  sleeps = []
  onSleep = null
  db = new FakeTicketDb(now, { privateKeyPem: KEY, certificatePem: CERT })
  transport = arcaTransport({ wsaa: () => loginResponse(now()) })
  logs = []
  const capture = (...args: unknown[]) => {
    logs.push(
      args.map((a) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(' '),
    )
  }
  vi.spyOn(console, 'error').mockImplementation(capture)
  vi.spyOn(console, 'warn').mockImplementation(capture)
  vi.spyOn(console, 'log').mockImplementation(capture)
})

afterEach(() => {
  vi.restoreAllMocks()
  // Nada de lo que pasó por la sesión puede aparecer en un log.
  const secrets = [SECRET, KEY.slice(30, 90), FIXTURE_TOKEN.slice(0, 40), 'c2lnbi1kZS1wcnVlYmE=']
  for (const line of logs) for (const s of secrets) expect(line).not.toContain(s)
})

describe('la clave del servidor (secretsKey)', () => {
  it('lee META_TOKEN_KEY y exige 16 caracteres, sin mostrar el valor en el error', () => {
    expect(secretsKey({ [SECRETS_KEY_ENV]: SECRET })).toBe(SECRET)
    expect(() => secretsKey({})).toThrow(ArcaSecretsKeyError)
    const short = 'corta-123'
    const error = (() => {
      try {
        secretsKey({ [SECRETS_KEY_ENV]: short })
      } catch (e) {
        return e
      }
      return null
    })()
    expect(error).toBeInstanceOf(ArcaSecretsKeyError)
    expect((error as Error).message).not.toContain(short)
    expect((error as Error).message).toContain('META_TOKEN_KEY')
  })
})

describe('credenciales (acc_arca_get_credentials)', () => {
  it('la clave privada no aparece si alguien serializa o inspecciona el objeto', async () => {
    const creds = await loadCredentials(db.rpc, TENANT, 'produccion', SECRET)
    expect(creds.privateKeyPem).toBe(KEY)
    expect(creds.certificatePem).toBe(CERT)
    expect(JSON.stringify(creds)).not.toContain('PRIVATE KEY')
    expect(Object.keys(creds)).not.toContain('privateKeyPem')
    expect(db.callsTo('acc_arca_get_credentials')).toEqual([
      { p_tenant_id: TENANT, p_environment: 'produccion', p_secret_key: SECRET },
    ])
  })

  it('un error de la base sale como ArcaStoreError con la clave del catálogo', async () => {
    db.credentials = { data: null, error: { message: 'secret_unreadable', code: 'P0001' } }
    const e = await rejection(loadCredentials(db.rpc, TENANT, 'produccion', SECRET))
    expect(e).toBeInstanceOf(ArcaStoreError)
    expect(e).toMatchObject({ key: 'secret_unreadable', op: 'acc_arca_get_credentials' })
    expect((e as ArcaStoreError).state).toMatchObject({ ok: false, code: 'error' })
    expect((e as Error).message).toBe('ARCA store: acc_arca_get_credentials secret_unreadable')
  })

  it('un cliente que tira (red) también es ArcaStoreError, sin los argumentos', async () => {
    const e = await rejection(
      callArcaRpc(() => Promise.reject(new TypeError('fetch failed')), 'acc_arca_ticket_get', {
        p_secret_key: SECRET,
      }),
    )
    expect(e).toBeInstanceOf(ArcaStoreError)
    expect((e as ArcaStoreError).key).toBe('offline')
    expect((e as Error).message).not.toContain(SECRET)
  })
})

describe('el ticket del WSAA (acquireTicket)', () => {
  it('un TA vigente en la base se usa sin login', async () => {
    db.storeValid('produccion', 'wsfe', FIXTURE_TOKEN, new Date(clock + 6 * HOUR))
    const ticket = await acquireTicket(deps(), 'wsfe')
    expect(ticket).toMatchObject({ token: FIXTURE_TOKEN, source: 'cache' })
    expect(ticket.expiresAt.toISOString()).toBe(new Date(clock + 6 * HOUR).toISOString())
    expect(logins()).toHaveLength(0)
    expect(db.callsTo('acc_arca_ticket_get')).toEqual([
      {
        p_tenant_id: TENANT,
        p_environment: 'produccion',
        p_service: 'wsfe',
        p_secret_key: SECRET,
        p_lease_seconds: 60,
        p_clear_manual_cooldown: false,
      },
    ])
  })

  it('sin TA: toma el lease, carga las credenciales, hace el login y lo guarda en snake_case', async () => {
    const ticket = await acquireTicket(deps(), 'wsfe')
    expect(ticket).toMatchObject({ token: FIXTURE_TOKEN, source: 'login' })
    expect(db.calls.map((c) => c.fn)).toEqual([
      'acc_arca_ticket_get',
      'acc_arca_get_credentials',
      'acc_arca_ticket_put',
    ])
    // Un solo login, al WSAA de producción, firmado para wsfe.
    expect(logins()).toHaveLength(1)
    expect(logins()[0]?.req.url).toBe(ARCA_ENDPOINTS.produccion.wsaa)
    expect(logins()[0]?.wsn).toBe('wsfe')

    const [put] = db.callsTo('acc_arca_ticket_put')
    const leaseId = db.tickets.get('produccion:wsfe')?.leaseId
    expect(leaseId).toBeNull() // liberado
    expect(put).toMatchObject({
      p_tenant_id: TENANT,
      p_environment: 'produccion',
      p_service: 'wsfe',
      p_secret_key: SECRET,
    })
    expect(typeof put?.p_lease_id).toBe('string')
    // Exactamente estas claves: el ArcaTicket en camelCase daría invalid_payload.
    expect(put?.p_result).toEqual({
      ok: true,
      token: FIXTURE_TOKEN,
      sign: 'c2lnbi1kZS1wcnVlYmE=',
      generation_time: new Date(clock - MIN).toISOString(),
      expiration_time: new Date(clock + 12 * HOUR).toISOString(),
    })
    // La próxima vez sale de la base.
    expect((await acquireTicket(deps(), 'wsfe')).source).toBe('cache')
    expect(logins()).toHaveLength(1)
  })

  it('si otra instancia tiene el lease, espera y usa el TA que guardó la otra (sin login)', async () => {
    const other = db.row('produccion', 'wsfe')
    other.leaseId = 'otra-instancia'
    other.leaseUntil = clock + 30_000
    onSleep = () => {
      if (sleeps.length === 2)
        db.storeValid('produccion', 'wsfe', FIXTURE_TOKEN, new Date(clock + 11 * HOUR))
    }
    const ticket = await acquireTicket(deps(), 'wsfe')
    expect(ticket.source).toBe('cache')
    expect(sleeps).toEqual([TICKET_BUSY_WAIT_MS, TICKET_BUSY_WAIT_MS])
    expect(logins()).toHaveLength(0)
    expect(db.callsTo('acc_arca_ticket_put')).toHaveLength(0)
  })

  it('si el lease no se libera nunca, a los ~9 s se rinde con arca_busy', async () => {
    const other = db.row('produccion', 'wsfe')
    other.leaseId = 'otra-instancia'
    other.leaseUntil = clock + 120_000
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(e).toBeInstanceOf(ArcaError)
    expect(classifyArcaError(e)).toBe('arca_busy')
    expect(db.callsTo('acc_arca_ticket_get')).toHaveLength(TICKET_MAX_ATTEMPTS)
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe((TICKET_MAX_ATTEMPTS - 1) * TICKET_BUSY_WAIT_MS)
    expect(logins()).toHaveLength(0)
  })

  it('en cooldown no se pide otro ticket: el error dice por qué y hasta cuándo', async () => {
    const row = db.row('produccion', 'wsfe')
    row.cooldownUntil = clock + 90_000
    row.lastErrorKey = 'arca_already_authenticated'
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(e).toBeInstanceOf(ArcaCooldownError)
    expect(e).toMatchObject({ key: 'arca_already_authenticated', manual: false })
    expect((e as ArcaCooldownError).until?.toISOString()).toBe(
      new Date(clock + 90_000).toISOString(),
    )
    expect(classifyArcaError(e)).toBe('arca_already_authenticated')
    expect(logins()).toHaveLength(0)
    expect(db.callsTo('acc_arca_ticket_put')).toHaveLength(0)
  })

  it('el cooldown manual lo borra solo «Probar conexión», y solo en la primera vuelta', async () => {
    const row = db.row('produccion', 'wsfe')
    row.cooldownManual = true
    row.lastErrorKey = 'arca_not_authorized'

    const blocked = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(blocked).toMatchObject({ key: 'arca_not_authorized', manual: true, until: null })

    const ticket = await acquireTicket(deps(), 'wsfe', { clearManualCooldown: true })
    expect(ticket.source).toBe('login')
    const flags = db.callsTo('acc_arca_ticket_get').map((a) => a.p_clear_manual_cooldown)
    expect(flags).toEqual([false, true])
  })

  it('un cooldown de tiempo no lo borra ni «Probar conexión»', async () => {
    const row = db.row('produccion', 'wsfe')
    row.cooldownUntil = clock + 60_000
    row.lastErrorKey = 'arca_unavailable'
    const e = await rejection(acquireTicket(deps(), 'wsfe', { clearManualCooldown: true }))
    expect(e).toMatchObject({ key: 'arca_unavailable', manual: false })
  })
})

describe('fallas del login y su cooldown (política del WSAA)', () => {
  it('«ya posee un TA válido»: libera el lease con 2 minutos en producción', async () => {
    transport.routes.wsaa = () => wsaaFault('alreadyAuthenticated')
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(e).toBeInstanceOf(ArcaFault)
    expect(classifyArcaError(e)).toBe('arca_already_authenticated')
    expect(db.callsTo('acc_arca_ticket_put').map((a) => a.p_result)).toEqual([
      { ok: false, key: 'arca_already_authenticated', cooldown: 120 },
    ])
    // Mientras dura, nadie vuelve a pedir: la próxima vez es cooldown, sin login.
    const again = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(again).toMatchObject({ key: 'arca_already_authenticated', manual: false })
    expect(logins()).toHaveLength(1)
    // Pasados los 2 minutos se puede volver a intentar.
    clock += 121_000
    transport.routes.wsaa = () => loginResponse(now())
    expect((await acquireTicket(deps(), 'wsfe')).source).toBe('login')
  })

  it('«ya posee un TA válido» en homologación espera 10 minutos', async () => {
    transport.routes.wsaa = () => wsaaFault('alreadyAuthenticated')
    await rejection(acquireTicket(deps({ environment: 'homologacion' }), 'wsfe'))
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_already_authenticated',
      cooldown: 600,
    })
  })

  it('certificado no autorizado → cooldown manual (hasta que la persona vuelva a probar)', async () => {
    transport.routes.wsaa = () => wsaaFault('notAuthorized')
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(classifyArcaError(e)).toBe('arca_not_authorized')
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_not_authorized',
      cooldown: 'manual',
    })
  })

  it('ARCA no contesta (red) → 60 s', async () => {
    transport.routes.wsaa = () => {
      throw new ArcaFault('network', 'ECONNRESET')
    }
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(classifyArcaError(e)).toBe('arca_unavailable')
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_unavailable',
      cooldown: 60,
    })
  })

  it('si no se pudieron cargar las credenciales, libera el lease SIN cooldown y sin llamar a ARCA', async () => {
    db.credentials = { data: null, error: { message: 'secret_unreadable', code: 'P0001' } }
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(e).toBeInstanceOf(ArcaStoreError)
    expect(db.callsTo('acc_arca_ticket_put').map((a) => a.p_result)).toEqual([
      { ok: false, key: 'secret_unreadable', cooldown: null },
    ])
    expect(logins()).toHaveLength(0)
    // Sin cooldown: con la clave arreglada se vuelve a intentar enseguida.
    const row = db.row('produccion', 'wsfe')
    expect(row).toMatchObject({ cooldownManual: false, cooldownUntil: null, leaseId: null })
    db.credentials = new FakeTicketDb(now, { privateKeyPem: KEY, certificatePem: CERT }).credentials
    expect((await acquireTicket(deps(), 'wsfe')).source).toBe('login')
  })

  it('sin certificado cargado (arca_not_ready) tampoco deja cooldown', async () => {
    db.credentials = { data: null, error: { message: 'arca_not_ready', code: 'P0001' } }
    await rejection(acquireTicket(deps(), 'wsfe'))
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_not_ready',
      cooldown: null,
    })
  })

  it('un certificado que no es de la clave corta antes del WSAA: sin cooldown', async () => {
    db.credentials = new FakeTicketDb(now, {
      privateKeyPem: KEY,
      certificatePem: fixtureText(CRYPTO.caCrt),
    }).credentials
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(classifyArcaError(e)).toBe('arca_key_mismatch')
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_key_mismatch',
      cooldown: null,
    })
    expect(logins()).toHaveLength(0)
  })

  it('secret_unreadable en ticket_get: no hay lease, no se llama a ticket_put', async () => {
    db.ticketGetError = { message: 'secret_unreadable', code: 'P0001' }
    const e = await rejection(acquireTicket(deps(), 'wsfe'))
    expect(e).toBeInstanceOf(ArcaStoreError)
    expect((e as ArcaStoreError).key).toBe('secret_unreadable')
    expect(db.calls.map((c) => c.fn)).toEqual(['acc_arca_ticket_get'])
    expect(logins()).toHaveLength(0)
  })

  it('si al guardar el TA el lease se perdió, el TA igual sirve (y queda en el log)', async () => {
    db.putErrors = [{ message: 'arca_lease_lost', code: 'P0001' }]
    const ticket = await acquireTicket(deps(), 'wsfe')
    expect(ticket.source).toBe('login')
    expect(logs).toContain('[arca.ticket] store arca_lease_lost')
  })

  it('un corte al guardar el TA se reintenta una vez', async () => {
    db.putErrors = [{ message: 'TypeError: fetch failed', code: '' }]
    const ticket = await acquireTicket(deps(), 'wsfe')
    expect(ticket.source).toBe('login')
    expect(db.callsTo('acc_arca_ticket_put')).toHaveLength(2)
    expect(db.tickets.get('produccion:wsfe')?.token).toBe(FIXTURE_TOKEN)
  })
})

describe('la sesión (createArcaSession)', () => {
  it('dos pedidos a la vez del mismo servicio comparten un solo ticket_get y un solo login', async () => {
    const s = session()
    const [a, b] = await Promise.all([s.auth('wsfe'), s.auth('wsfe')])
    expect(a).toEqual(b)
    expect(a).toMatchObject({ token: FIXTURE_TOKEN, cuit: SAS_CUIT })
    expect(db.callsTo('acc_arca_ticket_get')).toHaveLength(1)
    expect(logins()).toHaveLength(1)
    // Y después sigue sin preguntar mientras el TA sirva.
    await s.auth('wsfe')
    expect(db.callsTo('acc_arca_ticket_get')).toHaveLength(1)
  })

  it('dos sesiones (dos instancias) nunca hacen dos logins a la vez', async () => {
    const one = session()
    const two = session()
    // La segunda ve `busy` mientras la primera hace el login, y después usa lo que quedó.
    let releaseLogin: () => void = () => {}
    const loginStarted = new Promise<void>((resolve) => {
      transport.routes.wsaa = () =>
        new Promise((done) => {
          resolve()
          releaseLogin = () => done(loginResponse(now()))
        })
    })
    const first = one.auth('wsfe')
    await loginStarted
    onSleep = () => releaseLogin()
    const [a, b] = await Promise.all([first, two.auth('wsfe')])
    expect(a.token).toBe(b.token)
    expect(logins()).toHaveLength(1)
    expect(sleeps.length).toBeGreaterThan(0)
  })

  it('cada servicio tiene su ticket: el padrón pide el suyo al WSAA', async () => {
    db.storeValid('produccion', 'wsfe', FIXTURE_TOKEN, new Date(clock + 6 * HOUR))
    const s = session()
    await s.auth('wsfe')
    await s.auth('ws_sr_constancia_inscripcion')
    expect(logins().map((c) => c.wsn)).toEqual(['ws_sr_constancia_inscripcion'])
  })

  it('renueva el TA cuando le quedan menos de 10 minutos', async () => {
    const s = session()
    await s.auth('wsfe')
    expect(db.callsTo('acc_arca_ticket_get')).toHaveLength(1)
    clock += 12 * HOUR - 5 * MIN
    transport.routes.wsaa = () => loginResponse(now())
    await s.auth('wsfe')
    expect(db.callsTo('acc_arca_ticket_get')).toHaveLength(2)
    expect(logins()).toHaveLength(2)
  })

  it('«Probar conexión» borra el cooldown manual en el primer pedido de cada servicio', async () => {
    const s = session({ clear: true })
    await s.auth('wsfe')
    await s.auth('ws_sr_constancia_inscripcion')
    const flags = db
      .callsTo('acc_arca_ticket_get')
      .map((a) => [a.p_service, a.p_clear_manual_cooldown])
    expect(flags).toEqual([
      ['wsfe', true],
      ['ws_sr_constancia_inscripcion', true],
    ])
  })

  it('WSFE recibe el ticket y la CUIT de la SAS (Auth.Cuit)', async () => {
    transport.routes['wsfe:FEParamGetPtosVenta'] = fixtureResponse(ARCA_XML.wsfePtosVenta)
    const s = session()
    const items = await s.wsfe.ptosVenta()
    expect(items.map((p) => p.nro)).toEqual([3, 5, 7, 9, 11])
    const call = transport.calls.find((c) => c.method === 'FEParamGetPtosVenta')
    expect(call?.req.body).toContain(`<ar:Cuit>${SAS_CUIT}</ar:Cuit>`)
    expect(call?.req.body).toContain(`<ar:Token>${FIXTURE_TOKEN}</ar:Token>`)
  })

  it('el certificado de prueba (issued.crt) es el de la SAS y el token la incluye', () => {
    expect(ISSUED_CRT.subjectText).toContain(SAS_CUIT)
    expect(decodeTokenRelations(FIXTURE_TOKEN)).toContain(SAS_CUIT)
    // La clave de prueba abre el certificado emitido (si no, los logins de arriba no firmarían).
    expect(createPublicKey(KEY).asymmetricKeyType).toBe('rsa')
  })
})
