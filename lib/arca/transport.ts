import 'server-only'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import https from 'node:https'
import { isArcaUrl } from './endpoints'
import { ArcaFault, type ArcaHttpRequest, type ArcaHttpResponse, type ArcaTransport } from './soap'

/**
 * Transporte HTTPS hacia ARCA (diseño §2.9; `arca-tecnico.md` §6.1 y §6.3). D3:
 * cliente propio sobre `node:https`, sin dependencias.
 *
 * **TLS.** `servicios1.afip.gov.ar` (WSFE de producción) negocia DHE de 1024 bits y
 * Node 22.20+ (OpenSSL 3.5) corta con `ERR_SSL_DH_KEY_TOO_SMALL`. El arreglo es un
 * `https.Agent` propio que solo ofrece suites ECDHE: no baja el nivel de seguridad y
 * no toca a nadie más. **Prohibido** cambiar `tls.DEFAULT_CIPHERS` o `NODE_OPTIONS`:
 * bajaría la seguridad de Supabase y de Meta en todo el proceso. No se fija (pin)
 * ningún certificado: los de ARCA son de Sectigo y rotan.
 *
 * **Límites.** 25 s por llamada (conexión, envío y respuesta) y 2 MB de respuesta.
 * Solo acepta URLs `https://*.afip.gov.ar` (`isArcaUrl`).
 *
 * **Reintentos.** Ninguno acá: los decide cada cliente (nunca a ciegas con
 * `FECAESolicitar`).
 *
 * **Relay.** Si un día ARCA bloquea las IP de afuera, `getTransport()` cambia al
 * relay de `createRelayTransport` cuando existe `ARCA_RELAY_URL` (hoy no hay
 * ninguno: queda la interfaz y su test).
 *
 * Solo servidor y runtime Node.js (Edge no tiene `node:https` ni deja elegir
 * ciphers). Nunca loguea cuerpos: llevan el token, el sign o el CMS firmado.
 */

export type { ArcaHttpRequest, ArcaHttpResponse, ArcaTransport } from './soap'

/** Solo ECDHE (forward secrecy, sin el DHE de 1024 bits de servicios1). */
export const ARCA_TLS_CIPHERS = 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256'

export const ARCA_AGENT_OPTIONS = {
  keepAlive: true,
  maxSockets: 4,
  ciphers: ARCA_TLS_CIPHERS,
  minVersion: 'TLSv1.2',
} as const satisfies https.AgentOptions

export const ARCA_TIMEOUT_MS = 25_000
export const ARCA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

let sharedAgent: https.Agent | null = null

/** El agente de ARCA, uno por instancia (reusa las conexiones TLS entre llamadas). */
export function arcaAgent(): https.Agent {
  sharedAgent ??= new https.Agent(ARCA_AGENT_OPTIONS)
  return sharedAgent
}

/** La forma de `https.request` que usa el transporte (los tests pasan una falsa). */
export type HttpsRequestFn = (
  url: string,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest

export type HttpsTransportOptions = {
  readonly request?: HttpsRequestFn
  /** Por defecto, `arcaAgent()`. */
  readonly agent?: https.Agent
  readonly maxResponseBytes?: number
  /** Por defecto, `isArcaUrl`. */
  readonly allowUrl?: (url: string) => boolean
}

/** Un transporte sobre `node:https` (por defecto, con el agente de ARCA). */
export function createHttpsTransport(options: HttpsTransportOptions = {}): ArcaTransport {
  const request: HttpsRequestFn = options.request ?? https.request
  const maxBytes = options.maxResponseBytes ?? ARCA_MAX_RESPONSE_BYTES
  const allowUrl = options.allowUrl ?? isArcaUrl

  return (req: ArcaHttpRequest) =>
    new Promise<ArcaHttpResponse>((resolve, reject) => {
      if (!allowUrl(req.url)) {
        reject(new ArcaFault('network', 'url_not_allowed'))
        return
      }
      const payload = Buffer.from(req.body, 'utf8')
      let settled = false
      let clientRequest: ClientRequest | null = null
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (error: Error | null, value?: ArcaHttpResponse) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) {
          // Cortar el socket: lo que llegue después ya no importa.
          clientRequest?.destroy()
          reject(error)
        } else if (value) {
          resolve(value)
        }
      }

      timer = setTimeout(() => finish(new ArcaFault('timeout', 'timeout')), req.timeoutMs)

      try {
        clientRequest = request(
          req.url,
          {
            method: 'POST',
            agent: options.agent ?? arcaAgent(),
            headers: { ...req.headers, 'Content-Length': String(payload.length) },
          },
          (res) => {
            const chunks: Buffer[] = []
            let size = 0
            res.on('data', (chunk: Buffer | string) => {
              const piece = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
              size += piece.length
              if (size > maxBytes) {
                finish(new ArcaFault('protocol', 'response_too_large'))
                res.destroy()
                return
              }
              chunks.push(piece)
            })
            res.on('end', () =>
              finish(null, {
                status: res.statusCode ?? 0,
                body: decodeBody(Buffer.concat(chunks), res.headers['content-type']),
              }),
            )
            res.on('error', (e) => finish(networkFault(e)))
            res.on('close', () => {
              if (!res.complete) finish(new ArcaFault('network', 'ECONNRESET'))
            })
          },
        )
      } catch (e) {
        finish(networkFault(e))
        return
      }
      clientRequest.on('error', (e) => finish(networkFault(e)))
      clientRequest.end(payload)
    })
}

/** El cuerpo como texto, según el `charset` del Content-Type (UTF-8 si no dice). */
function decodeBody(bytes: Buffer, contentType: string | undefined): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? '')?.[1]?.toLowerCase()
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    try {
      return new TextDecoder(charset).decode(bytes)
    } catch {
      // Un charset que no conocemos: se lee como UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function networkFault(e: unknown): ArcaFault {
  if (e instanceof ArcaFault) return e
  const code = (e as { code?: unknown } | null)?.code
  return new ArcaFault(
    'network',
    typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : 'network_error',
    { cause: e },
  )
}

/** El transporte de todos los días: `node:https` con el agente solo-ECDHE. */
export const httpsTransport: ArcaTransport = createHttpsTransport()

// ─── Relay (plan B de §2.9, sin usar) ────────────────────────────────────────

export type RelayConfig = {
  /** `https://…` del relay. */
  readonly url: string
  /** Secreto compartido del HMAC (32 caracteres o más). */
  readonly secret: string
  readonly request?: HttpsRequestFn
  readonly now?: () => number
}

/** Header con la firma del pedido al relay. */
export const RELAY_SIGNATURE_HEADER = 'X-Arca-Relay-Signature'

/**
 * Transporte por un relay HTTPS con IP argentina. **No hay relay hoy**: es la
 * interfaz para no tocar la lógica si ARCA bloquea las IP de afuera.
 *
 * Protocolo: `POST <url>` con JSON `{ url, headers, body, timeoutMs, ts }` y el header
 * `X-Arca-Relay-Signature: t=<ts>,v1=<hex>`, donde `hex` = HMAC-SHA256(secret,
 * `<ts>.<cuerpo JSON>`). El relay valida la firma (±5 min), reenvía **solo** a
 * `https://*.afip.gov.ar` con su propio agente solo-ECDHE y contesta 200 con JSON
 * `{ status, body }` (el status y el cuerpo de ARCA). Cualquier otra respuesta del
 * relay es `network` (`relay_<status>`).
 */
export function createRelayTransport(config: RelayConfig): ArcaTransport {
  if (!/^https:\/\//.test(config.url)) throw new Error('ARCA_RELAY_URL tiene que ser https://')
  if (config.secret.length < 32)
    throw new Error('ARCA_RELAY_SECRET tiene que tener 32 caracteres o más')
  const now = config.now ?? Date.now
  const base = createHttpsTransport({
    request: config.request,
    agent: https.globalAgent,
    allowUrl: (url) => url === config.url,
  })
  return async (req) => {
    if (!isArcaUrl(req.url)) throw new ArcaFault('network', 'url_not_allowed')
    const ts = Math.floor(now() / 1000)
    const body = JSON.stringify({
      url: req.url,
      headers: req.headers,
      body: req.body,
      timeoutMs: req.timeoutMs,
      ts,
    })
    const signature = createHmac('sha256', config.secret).update(`${ts}.${body}`).digest('hex')
    const res = await base({
      url: config.url,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        [RELAY_SIGNATURE_HEADER]: `t=${ts},v1=${signature}`,
      },
      body,
      // El relay necesita un margen para su propia llamada.
      timeoutMs: req.timeoutMs + 5_000,
    })
    if (res.status !== 200) throw new ArcaFault('network', `relay_${res.status}`)
    let parsed: unknown
    try {
      parsed = JSON.parse(res.body)
    } catch {
      throw new ArcaFault('network', 'relay_bad_response')
    }
    const status = (parsed as { status?: unknown } | null)?.status
    const text = (parsed as { body?: unknown } | null)?.body
    if (typeof status !== 'number' || !Number.isInteger(status) || typeof text !== 'string') {
      throw new ArcaFault('network', 'relay_bad_response')
    }
    return { status, body: text }
  }
}

// ─── Corte de red simulado (solo para probar la emisión a mano) ──────────────

/**
 * Manda el pedido de verdad y después tira `timeout`, como si se hubiera cortado la
 * red esperando la respuesta: el caso más difícil de la saga de emisión (ARCA puede
 * haber dado el CAE). Solo afecta los métodos de `methods` (por defecto,
 * `FECAESolicitar`, según el SOAPAction).
 */
export function withFakeTimeout(
  transport: ArcaTransport,
  methods: readonly string[] = ['FECAESolicitar'],
): ArcaTransport {
  return async (req) => {
    const action = req.headers.SOAPAction ?? req.headers['Content-Type'] ?? ''
    const hit = methods.some((m) => action.includes(`/${m}"`))
    const res = await transport(req)
    if (hit) throw new ArcaFault('timeout', 'timeout')
    return res
  }
}

/** `ARCA_FAKE_TIMEOUT=1` fuera de producción (en producción se ignora siempre). */
export function fakeTimeoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ARCA_FAKE_TIMEOUT === '1' && env.NODE_ENV !== 'production'
}

/**
 * El transporte que corresponde: el relay si existe `ARCA_RELAY_URL` (con
 * `ARCA_RELAY_SECRET`); si no, `node:https` directo. Con `ARCA_FAKE_TIMEOUT=1`
 * (nunca en producción) envuelve con `withFakeTimeout`.
 */
export function getTransport(env: NodeJS.ProcessEnv = process.env): ArcaTransport {
  const relayUrl = env.ARCA_RELAY_URL?.trim()
  const transport = relayUrl
    ? createRelayTransport({ url: relayUrl, secret: env.ARCA_RELAY_SECRET ?? '' })
    : httpsTransport
  return fakeTimeoutEnabled(env) ? withFakeTimeout(transport) : transport
}
