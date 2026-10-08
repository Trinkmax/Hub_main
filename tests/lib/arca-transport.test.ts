import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import { describe, expect, it } from 'vitest'
import { ARCA_ENDPOINTS, ARCA_ENVIRONMENTS, isArcaUrl } from '@/lib/arca/endpoints'
import { ArcaFault, readSoapResponse, soapCall, soapHeaders } from '@/lib/arca/soap'
import {
  ARCA_AGENT_OPTIONS,
  ARCA_TLS_CIPHERS,
  type ArcaTransport,
  arcaAgent,
  createHttpsTransport,
  createRelayTransport,
  fakeTimeoutEnabled,
  getTransport,
  type HttpsRequestFn,
  httpsTransport,
  RELAY_SIGNATURE_HEADER,
  withFakeTimeout,
} from '@/lib/arca/transport'
import { ARCA_XML, arcaXml } from '@/tests/fixtures/arca/xml/fixtures'

// ─── Un `https.request` falso: sin sockets ni red ───────────────────────────

type Outcome =
  | { kind: 'respond'; status: number; chunks: string[]; contentType?: string; bytes?: Buffer }
  | { kind: 'error'; code: string }
  | { kind: 'hang' }
  | { kind: 'cut'; status: number; chunks: string[] }

type Sent = { url: string; options: RequestOptions; body: string }

function fakeRequest(outcome: Outcome, sent: Sent[]): HttpsRequestFn {
  return (url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body?: Buffer) => void
      destroy: (error?: Error) => void
    }
    let destroyed = false
    req.destroy = () => {
      destroyed = true
    }
    req.end = (body) => {
      sent.push({ url, options, body: body ? body.toString('utf8') : '' })
      setImmediate(() => {
        if (destroyed) return
        if (outcome.kind === 'hang') return
        if (outcome.kind === 'error') {
          req.emit('error', Object.assign(new Error('falla de prueba'), { code: outcome.code }))
          return
        }
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number
          headers: Record<string, string>
          complete: boolean
          destroy: () => void
        }
        res.statusCode = outcome.status
        res.headers = {
          'content-type':
            outcome.kind === 'respond' && outcome.contentType
              ? outcome.contentType
              : 'text/xml; charset=utf-8',
        }
        res.complete = false
        res.destroy = () => {
          res.emit('close')
        }
        callback(res as unknown as IncomingMessage)
        if (outcome.kind === 'respond' && outcome.bytes) res.emit('data', outcome.bytes)
        for (const chunk of outcome.chunks) res.emit('data', Buffer.from(chunk, 'utf8'))
        if (outcome.kind === 'cut') {
          res.emit('close')
          return
        }
        res.complete = true
        res.emit('end')
        res.emit('close')
      })
    }
    return req as unknown as ClientRequest
  }
}

const WSFE_HOMO = ARCA_ENDPOINTS.homologacion.wsfe

async function faultOf(promise: Promise<unknown>): Promise<ArcaFault> {
  try {
    await promise
  } catch (e) {
    if (e instanceof ArcaFault) return e
    throw new Error(`se esperaba ArcaFault y vino: ${String(e)}`)
  }
  throw new Error('se esperaba que fallara')
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

describe('endpoints de ARCA', () => {
  it('todos son https://*.afip.gov.ar y los dos ambientes no comparten host', () => {
    for (const env of ARCA_ENVIRONMENTS) {
      for (const url of Object.values(ARCA_ENDPOINTS[env])) {
        expect(isArcaUrl(url)).toBe(true)
        expect(new URL(url).hostname.endsWith('.afip.gov.ar')).toBe(true)
      }
    }
    const hosts = (env: (typeof ARCA_ENVIRONMENTS)[number]) =>
      new Set(Object.values(ARCA_ENDPOINTS[env]).map((u) => new URL(u).hostname))
    const shared = [...hosts('produccion')].filter((h) => hosts('homologacion').has(h))
    expect(shared).toEqual([])
    expect(ARCA_ENDPOINTS.produccion.wsfe).toBe(
      'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    )
    expect(ARCA_ENDPOINTS.homologacion.wsaa).toBe(
      'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    )
  })

  it('isArcaUrl rechaza otros dominios, http, puertos y credenciales', () => {
    for (const url of [
      'http://wsaa.afip.gov.ar/ws/services/LoginCms',
      'https://wsaa.arca.gob.ar/ws/services/LoginCms',
      'https://afip.gov.ar.example.com/',
      'https://wsaa.afip.gov.ar:8443/ws',
      'https://user:pass@wsaa.afip.gov.ar/ws',
      'https://.afip.gov.ar/',
      'no es una url',
    ]) {
      expect(isArcaUrl(url), url).toBe(false)
    }
  })
})

// ─── Agente TLS ──────────────────────────────────────────────────────────────

describe('agente TLS de ARCA', () => {
  it('solo ofrece suites ECDHE y TLS 1.2 como mínimo (el DHE de 1024 de servicios1 corta en Node 22.20+)', () => {
    const suites = ARCA_TLS_CIPHERS.split(':')
    expect(suites.length).toBeGreaterThan(0)
    for (const suite of suites) expect(suite.startsWith('ECDHE-')).toBe(true)
    expect(ARCA_AGENT_OPTIONS).toMatchObject({
      keepAlive: true,
      minVersion: 'TLSv1.2',
      ciphers: ARCA_TLS_CIPHERS,
    })
    const agent = arcaAgent()
    expect(agent.options.ciphers).toBe(ARCA_TLS_CIPHERS)
    expect(agent.options.minVersion).toBe('TLSv1.2')
    expect(arcaAgent()).toBe(agent)
  })
})

// ─── Transporte https ────────────────────────────────────────────────────────

describe('createHttpsTransport', () => {
  it('manda un POST con los headers, el largo y el cuerpo, con el agente de ARCA', async () => {
    const sent: Sent[] = []
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'respond', status: 200, chunks: ['<a>', 'ñ</a>'] }, sent),
    })
    const res = await transport({
      url: WSFE_HOMO,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"x"' },
      body: '<cuerpo>ñandú</cuerpo>',
      timeoutMs: 1000,
    })
    expect(res).toEqual({ status: 200, body: '<a>ñ</a>' })
    expect(sent).toHaveLength(1)
    const [call] = sent
    expect(call?.url).toBe(WSFE_HOMO)
    expect(call?.options.method).toBe('POST')
    expect(call?.options.agent).toBe(arcaAgent())
    expect(call?.options.headers).toMatchObject({
      SOAPAction: '"x"',
      'Content-Length': String(Buffer.byteLength('<cuerpo>ñandú</cuerpo>')),
    })
    expect(call?.body).toBe('<cuerpo>ñandú</cuerpo>')
  })

  it('devuelve el status de error tal cual (lo decide soapCall)', async () => {
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'respond', status: 500, chunks: ['<x/>'] }, []),
    })
    await expect(
      transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 }),
    ).resolves.toEqual({ status: 500, body: '<x/>' })
  })

  it('lee el charset del Content-Type', async () => {
    const transport = createHttpsTransport({
      request: fakeRequest(
        {
          kind: 'respond',
          status: 200,
          chunks: [],
          contentType: 'text/xml; charset=ISO-8859-1',
          bytes: Buffer.from([0x3c, 0x61, 0x3e, 0xe1, 0x3c, 0x2f, 0x61, 0x3e]),
        },
        [],
      ),
    })
    const res = await transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 })
    expect(res.body).toBe('<a>á</a>')
  })

  it('timeout → ArcaFault timeout', async () => {
    const transport = createHttpsTransport({ request: fakeRequest({ kind: 'hang' }, []) })
    const fault = await faultOf(transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 20 }))
    expect(fault.kind).toBe('timeout')
  })

  it('conexión rechazada → ArcaFault network con el código de Node', async () => {
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'error', code: 'ECONNREFUSED' }, []),
    })
    const fault = await faultOf(
      transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 }),
    )
    expect(fault.kind).toBe('network')
    expect(fault.code).toBe('ECONNREFUSED')
  })

  it('un error de TLS sale con su código (p. ej. el DH chico de servicios1)', async () => {
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'error', code: 'ERR_SSL_DH_KEY_TOO_SMALL' }, []),
    })
    const fault = await faultOf(
      transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 }),
    )
    expect(fault.code).toBe('ERR_SSL_DH_KEY_TOO_SMALL')
  })

  it('una respuesta cortada a la mitad → network ECONNRESET', async () => {
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'cut', status: 200, chunks: ['<a>'] }, []),
    })
    const fault = await faultOf(
      transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 }),
    )
    expect(fault).toMatchObject({ kind: 'network', code: 'ECONNRESET' })
  })

  it('corta las respuestas más grandes que el tope', async () => {
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'respond', status: 200, chunks: ['x'.repeat(64)] }, []),
      maxResponseBytes: 10,
    })
    const fault = await faultOf(
      transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 }),
    )
    expect(fault).toMatchObject({ kind: 'protocol', code: 'response_too_large' })
  })

  it('no le habla a nada que no sea https://*.afip.gov.ar', async () => {
    const sent: Sent[] = []
    const transport = createHttpsTransport({
      request: fakeRequest({ kind: 'respond', status: 200, chunks: [] }, sent),
    })
    const fault = await faultOf(
      transport({ url: 'https://example.com/', headers: {}, body: '', timeoutMs: 1000 }),
    )
    expect(fault).toMatchObject({ kind: 'network', code: 'url_not_allowed' })
    expect(sent).toHaveLength(0)
  })
})

// ─── soapCall sobre un transporte falso ──────────────────────────────────────

describe('soapCall', () => {
  it('registra headers y cuerpo, y devuelve el Envelope', async () => {
    const seen: { headers: Readonly<Record<string, string>>; body: string; timeoutMs: number }[] =
      []
    const transport: ArcaTransport = async (req) => {
      seen.push(req)
      return { status: 200, body: arcaXml(ARCA_XML.wsfeDummyProduccion) }
    }
    const env = await soapCall(transport, {
      url: WSFE_HOMO,
      soapAction: 'http://ar.gov.afip.dif.FEV1/FEDummy',
      body: '<sobre/>',
    })
    expect(env.name).toBe('Envelope')
    expect(seen[0]?.headers).toEqual({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://ar.gov.afip.dif.FEV1/FEDummy"',
    })
    expect(seen[0]?.body).toBe('<sobre/>')
    expect(seen[0]?.timeoutMs).toBe(25_000)
  })

  it('un error del transporte que no es ArcaFault sale como network', async () => {
    const transport: ArcaTransport = async () => {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    }
    const fault = await faultOf(
      soapCall(transport, { url: WSFE_HOMO, soapAction: '', body: '', method: 'FEDummy' }),
    )
    expect(fault).toMatchObject({ kind: 'network', code: 'ECONNRESET', method: 'FEDummy' })
  })

  it('una ArcaFault del transporte pasa con el contexto de la llamada', async () => {
    const transport: ArcaTransport = async () => {
      throw new ArcaFault('timeout', 'timeout')
    }
    const fault = await faultOf(
      soapCall(transport, {
        url: WSFE_HOMO,
        soapAction: '',
        body: '',
        service: 'wsfe',
        wsn: 'wsfe',
      }),
    )
    expect(fault).toMatchObject({ kind: 'timeout', service: 'wsfe', wsn: 'wsfe' })
  })

  it('una página que no es SOAP: 200 → protocol, 503 → http', () => {
    const page = arcaXml(ARCA_XML.htmlMantenimiento)
    expect(() => readSoapResponse({ status: 200, body: page })).toThrow(
      expect.objectContaining({ kind: 'protocol', code: 'not_soap' }),
    )
    expect(() => readSoapResponse({ status: 503, body: page })).toThrow(
      expect.objectContaining({ kind: 'http', code: 'http_503', httpStatus: 503 }),
    )
    expect(() => readSoapResponse({ status: 502, body: '' })).toThrow(
      expect.objectContaining({ kind: 'http', code: 'http_502' }),
    )
    expect(() => readSoapResponse({ status: 200, body: 'Bad Gateway' })).toThrow(
      expect.objectContaining({ kind: 'protocol', code: 'bad_xml' }),
    )
  })

  it('un Fault con HTTP 500 → fault, con el código sin prefijo', () => {
    expect(() =>
      readSoapResponse({ status: 500, body: arcaXml(ARCA_XML.wsfeFaultSoapAction) }),
    ).toThrow(expect.objectContaining({ kind: 'fault', code: 'Client', httpStatus: 500 }))
  })

  it('SOAP 1.2 lleva el action en el Content-Type; 1.1 en SOAPAction (vacío = "")', () => {
    expect(soapHeaders('1.2', 'http://ar.gov.afip.dif.FEV1/FEDummy')).toEqual({
      'Content-Type':
        'application/soap+xml; charset=utf-8; action="http://ar.gov.afip.dif.FEV1/FEDummy"',
    })
    expect(soapHeaders('1.1', '')).toEqual({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
    })
    expect(() => soapHeaders('1.1', 'a"b')).toThrow()
  })
})

// ─── Relay (interfaz, sin relay real) ────────────────────────────────────────

describe('createRelayTransport', () => {
  const RELAY = 'https://relay.example.com/arca'
  const SECRET = 's'.repeat(40)

  it('firma el pedido con HMAC y devuelve lo que contesta ARCA a través del relay', async () => {
    const sent: Sent[] = []
    const transport = createRelayTransport({
      url: RELAY,
      secret: SECRET,
      now: () => 1_791_460_800_000,
      request: fakeRequest(
        {
          kind: 'respond',
          status: 200,
          chunks: [JSON.stringify({ status: 500, body: '<fault/>' })],
          contentType: 'application/json',
        },
        sent,
      ),
    })
    const res = await transport({
      url: WSFE_HOMO,
      headers: { SOAPAction: '"a"' },
      body: '<x/>',
      timeoutMs: 1000,
    })
    expect(res).toEqual({ status: 500, body: '<fault/>' })
    const [call] = sent
    expect(call?.url).toBe(RELAY)
    const payload = JSON.parse(call?.body ?? '{}')
    expect(payload).toEqual({
      url: WSFE_HOMO,
      headers: { SOAPAction: '"a"' },
      body: '<x/>',
      timeoutMs: 1000,
      ts: 1_791_460_800,
    })
    const signature = (call?.options.headers as Record<string, string>)[RELAY_SIGNATURE_HEADER]
    const expected = createHmac('sha256', SECRET)
      .update(`1791460800.${call?.body ?? ''}`)
      .digest('hex')
    expect(signature).toBe(`t=1791460800,v1=${expected}`)
  })

  it('no reenvía a nada que no sea ARCA y trata un error del relay como red', async () => {
    const transport = createRelayTransport({
      url: RELAY,
      secret: SECRET,
      request: fakeRequest({ kind: 'respond', status: 502, chunks: ['bad gateway'] }, []),
    })
    expect(
      await faultOf(
        transport({ url: 'https://example.com/', headers: {}, body: '', timeoutMs: 10 }),
      ),
    ).toMatchObject({ kind: 'network', code: 'url_not_allowed' })
    expect(
      await faultOf(transport({ url: WSFE_HOMO, headers: {}, body: '', timeoutMs: 1000 })),
    ).toMatchObject({ kind: 'network', code: 'relay_502' })
  })

  it('exige https y un secreto largo', () => {
    expect(() => createRelayTransport({ url: 'http://relay', secret: SECRET })).toThrow()
    expect(() => createRelayTransport({ url: RELAY, secret: 'corto' })).toThrow()
  })
})

// ─── getTransport y el corte simulado ────────────────────────────────────────

describe('getTransport', () => {
  it('sin relay usa node:https directo', () => {
    expect(getTransport({ NODE_ENV: 'test' })).toBe(httpsTransport)
  })

  it('con ARCA_RELAY_URL usa el relay (y exige el secreto)', () => {
    const relay = getTransport({
      NODE_ENV: 'test',
      ARCA_RELAY_URL: 'https://relay.example.com/arca',
      ARCA_RELAY_SECRET: 'x'.repeat(32),
    })
    expect(relay).not.toBe(httpsTransport)
    expect(() =>
      getTransport({ NODE_ENV: 'test', ARCA_RELAY_URL: 'https://relay.example.com/arca' }),
    ).toThrow()
  })

  it('ARCA_FAKE_TIMEOUT=1 solo fuera de producción', () => {
    expect(fakeTimeoutEnabled({ NODE_ENV: 'development', ARCA_FAKE_TIMEOUT: '1' })).toBe(true)
    expect(fakeTimeoutEnabled({ NODE_ENV: 'production', ARCA_FAKE_TIMEOUT: '1' })).toBe(false)
    expect(fakeTimeoutEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(getTransport({ NODE_ENV: 'production', ARCA_FAKE_TIMEOUT: '1' })).toBe(httpsTransport)
    expect(getTransport({ NODE_ENV: 'development', ARCA_FAKE_TIMEOUT: '1' })).not.toBe(
      httpsTransport,
    )
  })

  it('withFakeTimeout manda FECAESolicitar de verdad y después tira timeout; el resto pasa', async () => {
    const calls: string[] = []
    const inner: ArcaTransport = async (req) => {
      calls.push(req.headers.SOAPAction ?? '')
      return { status: 200, body: '<ok/>' }
    }
    const transport = withFakeTimeout(inner)
    const cae = await faultOf(
      transport({
        url: WSFE_HOMO,
        headers: soapHeaders('1.1', 'http://ar.gov.afip.dif.FEV1/FECAESolicitar'),
        body: '',
        timeoutMs: 10,
      }),
    )
    expect(cae.kind).toBe('timeout')
    await expect(
      transport({
        url: WSFE_HOMO,
        headers: soapHeaders('1.1', 'http://ar.gov.afip.dif.FEV1/FECompConsultar'),
        body: '',
        timeoutMs: 10,
      }),
    ).resolves.toEqual({ status: 200, body: '<ok/>' })
    expect(calls).toEqual([
      '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"',
      '"http://ar.gov.afip.dif.FEV1/FECompConsultar"',
    ])
  })
})
