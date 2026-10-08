import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { ARCA_ENDPOINTS, ARCA_SERVICE } from '@/lib/arca/endpoints'
import { classifyArcaError, wsaaCooldown } from '@/lib/arca/errors'
import { ArcaFault, ArcaRequestError, type ArcaTransport, readSoapResponse } from '@/lib/arca/soap'
import {
  decodeTokenInfo,
  decodeTokenRelations,
  isAlreadyAuthenticated,
  loginCmsBody,
  parseLoginCmsResponse,
  parseXsdDateTime,
  WSAA_SOAP_ACTION,
  wsaaLogin,
} from '@/lib/arca/wsaa'
import { nodeAt, parseXml, textAt } from '@/lib/xml/mini'
import {
  ARCA_CRYPTO_FILES as CRYPTO,
  FIXED_NOW,
  fixtureText,
} from '@/tests/fixtures/arca/crypto-fixtures'
import { ARCA_XML, arcaXml, XML_CUITS, XML_TICKET } from '@/tests/fixtures/arca/xml/fixtures'

const TOKEN = arcaXml(ARCA_XML.wsaaToken).trim()

function faultFrom(fn: () => unknown): ArcaFault {
  try {
    fn()
  } catch (e) {
    if (e instanceof ArcaFault) return e
    throw new Error(`se esperaba ArcaFault y vino: ${String(e)}`)
  }
  throw new Error('se esperaba que fallara')
}

/** Lo que dice el manual (cap. 6.2): el TA, decodificado. */
function expectTicket(ticket: ReturnType<typeof parseLoginCmsResponse>) {
  expect(ticket.token).toBe(TOKEN)
  expect(ticket.sign).toMatch(/^[A-Za-z0-9+/]+=*$/)
  expect(ticket.generationTime.toISOString()).toBe(XML_TICKET.generationTime)
  expect(ticket.expirationTime.toISOString()).toBe(XML_TICKET.expirationTime)
  expect(ticket.destination).toBe(XML_TICKET.destination)
  expect(ticket.source).toBe(XML_TICKET.source)
  expect(ticket.uniqueId).toBe(XML_TICKET.uniqueId)
}

describe('loginCmsBody', () => {
  it('arma loginCms/in0 en el namespace del WSAA, con SOAPAction vacío', () => {
    const body = loginCmsBody('TUlJR2==')
    const env = parseXml(body)
    expect(env.qname).toBe('soapenv:Envelope')
    expect(env.attrs['xmlns:wsaa']).toBe('http://wsaa.view.sua.dvadac.desein.afip.gov')
    expect(nodeAt(env, 'Body/loginCms/in0')?.qname).toBe('wsaa:in0')
    expect(textAt(env, 'Body/loginCms/in0')).toBe('TUlJR2==')
    expect(WSAA_SOAP_ACTION).toBe('')
  })

  it('rechaza lo que no es base64', () => {
    expect(() => loginCmsBody('no-es-base64!!')).toThrow(ArcaRequestError)
    expect(() => loginCmsBody('abc')).toThrow(ArcaRequestError)
  })
})

describe('parseLoginCmsResponse', () => {
  it('lee el ticket con entidades escapadas (xsd:string, como responde Axis)', () => {
    expectTicket(parseLoginCmsResponse(arcaXml(ARCA_XML.wsaaLoginEscaped)))
  })

  it('lee el ticket dentro de un CDATA', () => {
    expectTicket(parseLoginCmsResponse(arcaXml(ARCA_XML.wsaaLoginCdata)))
  })

  it('tolera el ticket escapado dos veces', () => {
    const once = arcaXml(ARCA_XML.wsaaLoginEscaped)
    const inner = /<loginCmsReturn>([\s\S]*)<\/loginCmsReturn>/.exec(once)?.[1] ?? ''
    const twice = once.replace(inner, inner.replaceAll('&', '&amp;'))
    expect(twice).toContain('&amp;lt;loginTicketResponse')
    expectTicket(parseLoginCmsResponse(twice))
  })

  it('acepta el Envelope ya leído (lo que devuelve soapCall)', () => {
    const env = readSoapResponse({ status: 200, body: arcaXml(ARCA_XML.wsaaLoginCdata) })
    expectTicket(parseLoginCmsResponse(env))
  })

  it('los faults reales del WSAA salen con el código sin prefijo', () => {
    const untrusted = faultFrom(() =>
      readSoapResponse(
        { status: 500, body: arcaXml(ARCA_XML.wsaaFaultCertUntrusted) },
        { service: 'wsaa' },
      ),
    )
    expect(untrusted).toMatchObject({
      kind: 'fault',
      code: 'cms.cert.untrusted',
      detail: 'Certificado no emitido por AC de confianza',
      httpStatus: 500,
      service: 'wsaa',
    })
    expect(classifyArcaError(untrusted)).toBe('arca_wrong_environment')

    const badBase64 = faultFrom(() => parseLoginCmsResponse(arcaXml(ARCA_XML.wsaaFaultBadBase64)))
    expect(badBase64.code).toBe('cms.bad.base64')
    expect(classifyArcaError(badBase64)).toBe('arca_internal')
  })

  it('detecta «ya posee un TA válido» (por código o por texto)', () => {
    const fault = faultFrom(() =>
      parseLoginCmsResponse(arcaXml(ARCA_XML.wsaaFaultAlreadyAuthenticated)),
    )
    expect(fault.code).toBe('coe.alreadyAuthenticated')
    expect(isAlreadyAuthenticated(fault)).toBe(true)
    expect(
      isAlreadyAuthenticated(
        new ArcaFault('fault', 'Server', {
          detail: 'El CEE ya posee un TA valido para el acceso al WSN solicitado',
        }),
      ),
    ).toBe(true)
    expect(isAlreadyAuthenticated(new ArcaFault('fault', 'coe.notAuthorized'))).toBe(false)
    expect(isAlreadyAuthenticated(new Error('coe.alreadyAuthenticated'))).toBe(false)
  })

  it('un ticket ilegible, sin credenciales o con horarios imposibles es protocol', () => {
    const wrap = (inner: string) =>
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
      `<loginCmsResponse><loginCmsReturn>${inner}</loginCmsReturn></loginCmsResponse>` +
      '</soapenv:Body></soapenv:Envelope>'
    expect(faultFrom(() => parseLoginCmsResponse(wrap('basura'))).code).toBe(
      'bad:loginTicketResponse',
    )
    expect(faultFrom(() => parseLoginCmsResponse(wrap('&lt;otra/&gt;'))).code).toBe(
      'bad:loginTicketResponse',
    )
    const ticket = (times: string, credentials: string) =>
      wrap(
        `<![CDATA[<loginTicketResponse version="1.0"><header>${times}</header><credentials>${credentials}</credentials></loginTicketResponse>]]>`,
      )
    const okTimes =
      '<generationTime>2026-10-08T08:50:00-03:00</generationTime><expirationTime>2026-10-08T20:50:00-03:00</expirationTime>'
    expect(
      faultFrom(() => parseLoginCmsResponse(ticket(okTimes, '<token/><sign>x</sign>'))).code,
    ).toBe('missing:credentials')
    const backwards =
      '<generationTime>2026-10-08T20:50:00-03:00</generationTime><expirationTime>2026-10-08T08:50:00-03:00</expirationTime>'
    expect(
      faultFrom(() => parseLoginCmsResponse(ticket(backwards, '<token>t</token><sign>s</sign>')))
        .code,
    ).toBe('bad:ticketTimes')
    expect(
      faultFrom(() =>
        parseLoginCmsResponse(
          '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><otra/></soapenv:Body></soapenv:Envelope>',
        ),
      ).code,
    ).toBe('missing:loginCmsReturn')
  })
})

describe('parseXsdDateTime', () => {
  it('lee las formas que usa ARCA', () => {
    expect(parseXsdDateTime('2019-09-26T13:56:14.467-03:00')?.toISOString()).toBe(
      '2019-09-26T16:56:14.467Z',
    )
    expect(parseXsdDateTime('2026-10-08T02:46:30.804Z')?.toISOString()).toBe(
      '2026-10-08T02:46:30.804Z',
    )
    // Sin zona: hora de Argentina.
    expect(parseXsdDateTime('2026-10-08T09:00:00')?.toISOString()).toBe('2026-10-08T12:00:00.000Z')
    // .NET manda 7 decimales.
    expect(parseXsdDateTime('2026-10-08T02:04:44.4796359-03:00')?.toISOString()).toBe(
      '2026-10-08T05:04:44.479Z',
    )
    expect(parseXsdDateTime('20011231T12:00:0203:00')).toBeNull()
    expect(parseXsdDateTime('2026-13-40T99:00:00Z')).toBeNull()
    expect(parseXsdDateTime(null)).toBeNull()
  })
})

describe('token del TA', () => {
  it('decodeTokenRelations: las CUIT que el certificado puede representar', () => {
    expect(decodeTokenRelations(TOKEN)).toEqual([XML_CUITS.persona, XML_CUITS.sas])
  })

  it('decodeTokenInfo: servicio, DN y vigencia', () => {
    const info = decodeTokenInfo(TOKEN)
    expect(info).toMatchObject({
      service: 'wsfe',
      uid: 'SERIALNUMBER=CUIT 20123456786, CN=plataformatest',
      relations: [XML_CUITS.persona, XML_CUITS.sas],
    })
    expect(info?.generatedAt?.toISOString()).toBe('2026-10-08T11:50:00.000Z')
    expect(info?.expiresAt?.toISOString()).toBe('2026-10-08T23:50:00.000Z')
  })

  it('un token ilegible da null (no es lo mismo que «sin relaciones»)', () => {
    expect(decodeTokenRelations('no es base64 !!')).toBeNull()
    expect(decodeTokenRelations(Buffer.from('<otra/>').toString('base64'))).toBeNull()
    expect(decodeTokenRelations(Buffer.from('no es xml').toString('base64'))).toBeNull()
    const empty = Buffer.from('<sso version="2.0"><id/><operation><login/></operation></sso>')
    expect(decodeTokenRelations(empty.toString('base64'))).toEqual([])
  })

  it('tolera la CUIT de la relación en otro atributo o como texto', () => {
    const other = Buffer.from(
      '<sso><operation><login><relations><relation reltype="4" cuit="30712345671"/>' +
        '<relation reltype="4">20123456786</relation><relation key="123"/></relations></login></operation></sso>',
    )
    expect(decodeTokenRelations(other.toString('base64'))).toEqual([
      XML_CUITS.sas,
      XML_CUITS.persona,
    ])
  })
})

describe('wsaaLogin (transporte falso, firma de verdad con los fixtures de WP1)', () => {
  const cert = fixtureText(CRYPTO.testCrt)
  const key = fixtureText(CRYPTO.testKey)

  it('firma un TRA del servicio pedido y lo manda al WSAA del ambiente', async () => {
    const requests: Parameters<ArcaTransport>[0][] = []
    const transport: ArcaTransport = async (req) => {
      requests.push(req)
      return { status: 200, body: arcaXml(ARCA_XML.wsaaLoginEscaped) }
    }
    const ticket = await wsaaLogin(
      transport,
      'homologacion',
      ARCA_SERVICE.wsfe,
      cert,
      key,
      FIXED_NOW,
    )
    expectTicket(ticket)

    expect(requests).toHaveLength(1)
    const [req] = requests
    expect(req?.url).toBe(ARCA_ENDPOINTS.homologacion.wsaa)
    expect(req?.headers).toEqual({ 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' })
    const in0 = textAt(parseXml(req?.body ?? ''), 'Body/loginCms/in0') ?? ''
    expect(in0).toMatch(/^[A-Za-z0-9+/]+=*$/)
    // El CMS lleva el TRA adentro (contenido adjunto) con el servicio y la ventana de ±10 min.
    const cms = Buffer.from(in0, 'base64').toString('latin1')
    expect(cms).toContain('<service>wsfe</service>')
    expect(cms).toContain('<uniqueId>1791460800</uniqueId>')
    expect(cms).toContain('<generationTime>2026-10-08T11:50:00.000Z</generationTime>')
    expect(cms).toContain('<expirationTime>2026-10-08T12:10:00.000Z</expirationTime>')
  })

  it('pide el padrón con su propio servicio y al WSAA de producción', async () => {
    let body = ''
    let url = ''
    const transport: ArcaTransport = async (req) => {
      body = req.body
      url = req.url
      return { status: 200, body: arcaXml(ARCA_XML.wsaaLoginCdata) }
    }
    await wsaaLogin(transport, 'produccion', ARCA_SERVICE.padron, cert, key, FIXED_NOW)
    expect(url).toBe(ARCA_ENDPOINTS.produccion.wsaa)
    const cms = Buffer.from(textAt(parseXml(body), 'Body/loginCms/in0') ?? '', 'base64')
    expect(cms.toString('latin1')).toContain('<service>ws_sr_constancia_inscripcion</service>')
  })

  it('un Fault sale con el servicio y el WSN; ya autenticado → cooldown de 2 o 10 minutos', async () => {
    const transport: ArcaTransport = async () => ({
      status: 500,
      body: arcaXml(ARCA_XML.wsaaFaultAlreadyAuthenticated),
    })
    const fault = await wsaaLogin(transport, 'produccion', 'wsfe', cert, key, FIXED_NOW).then(
      () => null,
      (e: unknown) => e,
    )
    expect(fault).toBeInstanceOf(ArcaFault)
    expect(fault).toMatchObject({
      kind: 'fault',
      code: 'coe.alreadyAuthenticated',
      service: 'wsaa',
      wsn: 'wsfe',
      method: 'loginCms',
    })
    const key2 = classifyArcaError(fault)
    expect(key2).toBe('arca_already_authenticated')
    expect(wsaaCooldown(key2, 'produccion')).toBe(120)
    expect(wsaaCooldown(key2, 'homologacion')).toBe(600)
  })

  it('no autorizado para el padrón → la falla dice qué servicio era', async () => {
    const transport: ArcaTransport = async () => ({
      status: 500,
      body: arcaXml(ARCA_XML.wsaaFaultNotAuthorized),
    })
    const fault = await wsaaLogin(
      transport,
      'homologacion',
      'ws_sr_constancia_inscripcion',
      cert,
      key,
      FIXED_NOW,
    ).catch((e: unknown) => e)
    expect(fault).toMatchObject({ code: 'coe.notAuthorized', wsn: 'ws_sr_constancia_inscripcion' })
    expect(classifyArcaError(fault)).toBe('arca_not_authorized')
    expect(wsaaCooldown('arca_not_authorized', 'produccion')).toBe('manual')
  })

  it('un ticket que ya venció al llegar es protocol', async () => {
    const transport: ArcaTransport = async () => ({
      status: 200,
      body: arcaXml(ARCA_XML.wsaaLoginEscaped),
    })
    const tomorrow = new Date('2026-10-09T12:00:00.000Z')
    const fault = await wsaaLogin(transport, 'homologacion', 'wsfe', cert, key, tomorrow).catch(
      (e: unknown) => e,
    )
    expect(fault).toMatchObject({ kind: 'protocol', code: 'ticket_expired', wsn: 'wsfe' })
  })

  it('un certificado de otra clave no llega al WSAA', async () => {
    let called = false
    const transport: ArcaTransport = async () => {
      called = true
      return { status: 200, body: '' }
    }
    const otherKey = fixtureText(CRYPTO.testKey).replace(/A/g, 'B')
    await expect(
      wsaaLogin(transport, 'homologacion', 'wsfe', cert, otherKey, FIXED_NOW),
    ).rejects.toThrow()
    expect(called).toBe(false)
  })
})
