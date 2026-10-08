import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { PgLikeError } from '@/lib/accounting/errors'
import type { ArcaHttpRequest, ArcaHttpResponse, ArcaTransport } from '@/lib/arca/soap'
import type { ArcaRpc, ArcaRpcResult } from '@/lib/arca/store'
import { ARCA_XML, arcaXml } from '@/tests/fixtures/arca/xml/fixtures'

/**
 * Dobles de prueba de ARCA para `arca-session.test.ts` y `arca-actions.test.ts`:
 *
 * - `FakeTicketDb`: un modelo en memoria de `acc_arca_ticket_get`,
 *   `acc_arca_ticket_put` y `acc_arca_get_credentials` con las MISMAS reglas que la
 *   migración 20261008120110 (TA válido si vence en más de 10 min, cooldown manual o
 *   de tiempo, lease de 15–120 s, `arca_lease_lost`, `p_result` en snake_case).
 * - `arcaTransport`: un transporte falso que despacha por servicio y método
 *   (WSAA, WSFE por SOAPAction, padrón por el elemento del cuerpo) y anota cada
 *   pedido.
 * - `loginResponse` / `ssoToken`: respuestas del WSAA con horas relativas al reloj
 *   del test.
 * - `fakeSupabase`: lo mínimo del query builder de supabase-js (`select`, `eq`,
 *   `in`, `order`, `limit`, `maybeSingle`) sobre tablas en memoria.
 *
 * Todo sintético: CUIT de prueba con dígito verificador válido.
 */

export const SAS_CUIT = '30712345671'
export const PERSON_CUIT = '20123456786'
export const TENANT = '00000000-0000-4000-8000-0000000000aa'
export const CONNECTION_ID = '00000000-0000-4000-8000-0000000000c1'
/** Una clave de servidor de prueba (no es la de ningún ambiente). */
export const SECRET = 'clave-de-prueba-del-servidor-0123456789'

const ok = (data: unknown): ArcaRpcResult => ({ data, error: null })
const fail = (message: string, code = 'P0001'): ArcaRpcResult => ({
  data: null,
  error: { message, code, details: null, hint: null },
})

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/

// ─── WSAA ────────────────────────────────────────────────────────────────────

/** Un token SSO (base64) con estas CUIT en `relations`. */
export function ssoToken(relations: readonly string[], service = 'wsfe'): string {
  const rels = relations.map((c) => `<relation key="${c}" reltype="4"/>`).join('')
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sso version="2.0">' +
    '<id src="CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239" dst="CN=wsfe, O=AFIP, C=AR" unique_id="1" gen_time="1791460200" exp_time="1791503400"/>' +
    `<operation type="login" value="granted"><login entity="33693450239" service="${service}" uid="SERIALNUMBER=CUIT ${SAS_CUIT}, CN=hubplataforma" authmethod="cms" regmethod="22"><relations>${rels}</relations></login></operation></sso>`
  return Buffer.from(xml, 'utf8').toString('base64')
}

/** El token de los fixtures del WSAA (relations: la persona y la SAS). */
export const FIXTURE_TOKEN = arcaXml(ARCA_XML.wsaaToken).trim()

/** `loginCmsResponse` con un TA que vale 12 h desde `now`. */
export function loginResponse(
  now: Date,
  opts: { token?: string; sign?: string; hours?: number } = {},
): ArcaHttpResponse {
  const gen = new Date(now.getTime() - 60_000).toISOString()
  const exp = new Date(now.getTime() + (opts.hours ?? 12) * 3_600_000).toISOString()
  const ticket =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><loginTicketResponse version="1.0"><header>' +
    '<source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>' +
    `<destination>SERIALNUMBER=CUIT ${SAS_CUIT}, CN=hubplataforma</destination>` +
    `<uniqueId>1</uniqueId><generationTime>${gen}</generationTime><expirationTime>${exp}</expirationTime>` +
    `</header><credentials><token>${opts.token ?? FIXTURE_TOKEN}</token><sign>${opts.sign ?? 'c2lnbi1kZS1wcnVlYmE='}</sign></credentials></loginTicketResponse>`
  return {
    status: 200,
    body:
      '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
      `<loginCmsReturn><![CDATA[${ticket}]]></loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`,
  }
}

/** Un Fault del WSAA (HTTP 500), de los fixtures. */
export function wsaaFault(
  fixture: 'alreadyAuthenticated' | 'notAuthorized' | 'certUntrusted',
): ArcaHttpResponse {
  const name =
    fixture === 'alreadyAuthenticated'
      ? ARCA_XML.wsaaFaultAlreadyAuthenticated
      : fixture === 'notAuthorized'
        ? ARCA_XML.wsaaFaultNotAuthorized
        : ARCA_XML.wsaaFaultCertUntrusted
  return { status: 500, body: arcaXml(name) }
}

// ─── Transporte falso ────────────────────────────────────────────────────────

export type ArcaCallKind = {
  service: 'wsaa' | 'wsfe' | 'padron'
  method: string
  wsn: string | null
}

type Responder = (req: ArcaHttpRequest) => ArcaHttpResponse | Promise<ArcaHttpResponse>

export type FakeTransport = ArcaTransport & {
  readonly calls: Array<ArcaCallKind & { req: ArcaHttpRequest }>
  routes: Record<string, Responder>
}

/** Qué servicio y método es un pedido (como lo vería ARCA). */
export function callKind(req: ArcaHttpRequest): ArcaCallKind {
  if (req.url.includes('LoginCms')) {
    const in0 = /<wsaa:in0>([^<]+)<\/wsaa:in0>/.exec(req.body)?.[1] ?? ''
    const cms = Buffer.from(in0, 'base64').toString('latin1')
    const wsn = /<service>([^<]+)<\/service>/.exec(cms)?.[1] ?? null
    return { service: 'wsaa', method: 'loginCms', wsn }
  }
  if (req.url.includes('wsfev1')) {
    const action = req.headers.SOAPAction ?? ''
    return { service: 'wsfe', method: /\/([A-Za-z]+)"$/.exec(action)?.[1] ?? '?', wsn: 'wsfe' }
  }
  const method = /<a5:([A-Za-z_0-9]+)[\s/>]/.exec(req.body)?.[1] ?? '?'
  return { service: 'padron', method, wsn: 'ws_sr_constancia_inscripcion' }
}

/**
 * Transporte que contesta según `routes`: claves `wsaa:<wsn>` (o `wsaa`),
 * `wsfe:<Metodo>` y `padron:<metodo>`. Lo que no tiene ruta es un error del test.
 */
export function arcaTransport(routes: Record<string, Responder>): FakeTransport {
  const calls: FakeTransport['calls'] = []
  const transport = (async (req: ArcaHttpRequest) => {
    const kind = callKind(req)
    calls.push({ ...kind, req })
    const key = kind.service === 'wsaa' ? `wsaa:${kind.wsn}` : `${kind.service}:${kind.method}`
    const route =
      transport.routes[key] ?? (kind.service === 'wsaa' ? transport.routes.wsaa : undefined)
    if (!route) throw new Error(`sin ruta para ${key}`)
    return route(req)
  }) as FakeTransport
  Object.assign(transport, { calls, routes })
  return transport
}

/** Respuestas de WSFE y del padrón de los fixtures. */
export const fixtureResponse =
  (name: (typeof ARCA_XML)[keyof typeof ARCA_XML], status = 200) =>
  (): ArcaHttpResponse => ({ status, body: arcaXml(name) })

/** `FECompUltimoAutorizado` con un número. */
export function ultimoResponse(pv: number, tipo: number, nro: number): ArcaHttpResponse {
  return {
    status: 200,
    body:
      '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>' +
      `<PtoVta>${pv}</PtoVta><CbteTipo>${tipo}</CbteTipo><CbteNro>${nro}</CbteNro>` +
      '</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>',
  }
}

/** Los `CbteTipo` que pidió cada `FECompUltimoAutorizado`. */
export function ultimoTipos(transport: FakeTransport): number[] {
  return transport.calls
    .filter((c) => c.method === 'FECompUltimoAutorizado')
    .map((c) => Number(/<ar:CbteTipo>(\d+)<\/ar:CbteTipo>/.exec(c.req.body)?.[1] ?? '0'))
}

/** Un transporte de WSFE + padrón + WSAA que da todo bien (punto de venta 5). */
export function happyTransport(now: () => Date): FakeTransport {
  return arcaTransport({
    wsaa: () => loginResponse(now()),
    'wsfe:FEDummy': fixtureResponse(ARCA_XML.wsfeDummyProduccion),
    'wsfe:FEParamGetPtosVenta': fixtureResponse(ARCA_XML.wsfePtosVenta),
    'wsfe:FECompUltimoAutorizado': (req) => {
      const tipo = Number(/<ar:CbteTipo>(\d+)<\/ar:CbteTipo>/.exec(req.body)?.[1] ?? '0')
      return ultimoResponse(5, tipo, tipo === 6 ? 104 : 0)
    },
    'padron:dummy': fixtureResponse(ARCA_XML.padronDummyProduccion),
    'padron:getPersona_v2': fixtureResponse(ARCA_XML.padronPersonaRi),
  })
}

// ─── La base de los tickets ──────────────────────────────────────────────────

type TicketRow = {
  token: string | null
  sign: string | null
  expiresAt: number | null
  leaseId: string | null
  leaseUntil: number | null
  cooldownUntil: number | null
  cooldownManual: boolean
  lastErrorKey: string | null
}

export type RpcCall = { fn: string; args: Record<string, unknown> }

/**
 * `acc_arca_ticket_get` / `acc_arca_ticket_put` / `acc_arca_get_credentials` en
 * memoria, con las reglas de la migración. `now` es el reloj del test.
 */
export class FakeTicketDb {
  readonly tickets = new Map<string, TicketRow>()
  readonly calls: RpcCall[] = []
  /** Lo que contesta `acc_arca_get_credentials` (por defecto, la clave y el certificado de prueba). */
  credentials: ArcaRpcResult
  /** Si está, `acc_arca_ticket_get` contesta este error (p. ej. `secret_unreadable`). */
  ticketGetError: PgLikeError | null = null
  /** Errores de `acc_arca_ticket_put` en orden (uno por llamada; `null` = anda). */
  putErrors: Array<PgLikeError | null> = []
  /** Respuestas para otras RPC (`acc_arca_record_test`, …). */
  readonly others = new Map<string, (args: Record<string, unknown>) => ArcaRpcResult>()

  constructor(
    readonly now: () => Date,
    credentials: { privateKeyPem: string; certificatePem: string },
  ) {
    this.credentials = ok({
      connection: {
        id: CONNECTION_ID,
        alias: 'hubplataforma',
        represented_cuit: SAS_CUIT,
        status: 'connected',
      },
      private_key_pem: credentials.privateKeyPem,
      certificate_pem: credentials.certificatePem,
    })
  }

  row(environment: string, service: string): TicketRow {
    const key = `${environment}:${service}`
    let row = this.tickets.get(key)
    if (!row) {
      row = {
        token: null,
        sign: null,
        expiresAt: null,
        leaseId: null,
        leaseUntil: null,
        cooldownUntil: null,
        cooldownManual: false,
        lastErrorKey: null,
      }
      this.tickets.set(key, row)
    }
    return row
  }

  /** Un TA guardado (como si lo hubiera dejado otra instancia). */
  storeValid(
    environment: string,
    service: string,
    token: string,
    expiresAt: Date,
    sign = 'c2ln',
  ): void {
    Object.assign(this.row(environment, service), { token, sign, expiresAt: expiresAt.getTime() })
  }

  callsTo(fn: string): Array<Record<string, unknown>> {
    return this.calls.filter((c) => c.fn === fn).map((c) => c.args)
  }

  readonly rpc: ArcaRpc = async (fn, args) => {
    this.calls.push({ fn, args: structuredClone(args) })
    if (fn === 'acc_arca_ticket_get') return this.ticketGet(args)
    if (fn === 'acc_arca_ticket_put') return this.ticketPut(args)
    if (fn === 'acc_arca_get_credentials') return this.credentials
    const other = this.others.get(fn)
    if (other) return other(args)
    throw new Error(`RPC inesperada: ${fn}`)
  }

  private ticketGet(args: Record<string, unknown>): ArcaRpcResult {
    if (typeof args.p_secret_key !== 'string' || args.p_secret_key.length < 16) {
      return fail('invalid_payload')
    }
    if (this.ticketGetError) return { data: null, error: this.ticketGetError }
    const t = this.row(String(args.p_environment), String(args.p_service))
    const now = this.now().getTime()
    if (args.p_clear_manual_cooldown === true && t.cooldownManual) t.cooldownManual = false
    if (t.expiresAt !== null && t.expiresAt > now + 10 * 60_000) {
      return ok({
        status: 'valid',
        token: t.token,
        sign: t.sign,
        expires_at: new Date(t.expiresAt).toISOString(),
      })
    }
    if (t.cooldownManual || (t.cooldownUntil !== null && t.cooldownUntil > now)) {
      return ok({
        status: 'cooldown',
        until: t.cooldownUntil === null ? null : new Date(t.cooldownUntil).toISOString(),
        manual: t.cooldownManual,
        last_error_key: t.lastErrorKey,
      })
    }
    if (t.leaseUntil !== null && t.leaseUntil > now) {
      return ok({ status: 'busy', retry_after_ms: 1500 })
    }
    const seconds = Math.max(15, Math.min(Number(args.p_lease_seconds ?? 60), 120))
    t.leaseId = randomUUID()
    t.leaseUntil = now + seconds * 1000
    return ok({ status: 'lease', lease_id: t.leaseId })
  }

  private ticketPut(args: Record<string, unknown>): ArcaRpcResult {
    const injected = this.putErrors.shift()
    if (injected) return { data: null, error: injected }
    const t = this.row(String(args.p_environment), String(args.p_service))
    const result = args.p_result as Record<string, unknown> | null
    if (!result || typeof result.ok !== 'boolean') return fail('invalid_payload')
    if (!args.p_lease_id || t.leaseId !== args.p_lease_id) return fail('arca_lease_lost')
    const now = this.now().getTime()
    if (result.ok) {
      const token = result.token
      const sign = result.sign
      const exp = typeof result.expiration_time === 'string' ? result.expiration_time : ''
      const gen = typeof result.generation_time === 'string' ? result.generation_time : null
      if (typeof token !== 'string' || token === '' || typeof sign !== 'string' || sign === '') {
        return fail('invalid_payload')
      }
      if (!ISO_RE.test(exp) || Date.parse(exp) <= now || (gen !== null && !ISO_RE.test(gen))) {
        return fail('invalid_payload')
      }
      Object.assign(t, {
        token,
        sign,
        expiresAt: Date.parse(exp),
        leaseId: null,
        leaseUntil: null,
        cooldownUntil: null,
        cooldownManual: false,
        lastErrorKey: null,
      })
      return ok(null)
    }
    const key = result.key
    if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{1,59}$/.test(key))
      return fail('invalid_payload')
    const cooldown = result.cooldown
    let seconds: number | null
    if (cooldown === null || cooldown === undefined) seconds = 0
    else if (cooldown === 'manual') seconds = null
    else if (
      typeof cooldown === 'number' &&
      Number.isInteger(cooldown) &&
      cooldown >= 0 &&
      cooldown <= 3600
    ) {
      seconds = cooldown
    } else return fail('invalid_payload')
    Object.assign(t, {
      leaseId: null,
      leaseUntil: null,
      cooldownManual: seconds === null,
      cooldownUntil: seconds !== null && seconds > 0 ? now + seconds * 1000 : null,
      lastErrorKey: key,
    })
    return ok(null)
  }
}

// ─── Supabase (query builder mínimo) ─────────────────────────────────────────

export type TableRows = Record<string, Array<Record<string, unknown>>>

type Filter = (row: Record<string, unknown>) => boolean

/**
 * Lo mínimo de `supabase.from(…)` que usan las lecturas de ARCA. Las tablas son
 * listas de filas; `select` no recorta columnas (las lecturas igual leen solo lo
 * suyo). `tableErrors` hace fallar una tabla.
 */
export function fakeSupabase(
  tables: TableRows,
  rpc: ArcaRpc,
  tableErrors: Record<string, PgLikeError> = {},
) {
  const reads: Array<{ table: string; columns: string }> = []
  const from = (table: string) => {
    const filters: Filter[] = []
    let max = Number.POSITIVE_INFINITY
    let columns = '*'
    const run = () => {
      const error = tableErrors[table]
      if (error) return { data: null, error }
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, max)
      return { data: rows.map((r) => ({ ...r })), error: null }
    }
    const builder = {
      select(cols = '*') {
        columns = cols
        reads.push({ table, columns: cols })
        return builder
      },
      eq(column: string, value: unknown) {
        filters.push((r) => r[column] === value)
        return builder
      },
      in(column: string, values: readonly unknown[]) {
        filters.push((r) => values.includes(r[column]))
        return builder
      },
      order() {
        return builder
      },
      limit(n: number) {
        max = n
        return builder
      },
      maybeSingle() {
        const { data, error } = run()
        return Promise.resolve({ data: error ? null : (data?.[0] ?? null), error })
      },
      // biome-ignore lint/suspicious/noThenProperty: imita el query builder de supabase-js (thenable).
      then<T>(resolve: (value: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve(run()).then(resolve, reject)
      },
      get columns() {
        return columns
      },
    }
    return builder
  }
  return { from, rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args ?? {}), reads }
}
