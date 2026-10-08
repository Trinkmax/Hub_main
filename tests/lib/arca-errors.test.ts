import { describe, expect, it } from 'vitest'
import {
  ARCA_ERROR_KEYS,
  ARCA_ERRORS,
  ArcaError,
  type ArcaErrorKey,
  classifyArcaError,
  classifyArcaMessages,
  describeArcaError,
  describeArcaErrorKey,
  ISSUER_SUBMESSAGES,
  isArcaErrorKey,
  issuerSubcodes,
  wsaaCooldown,
} from '@/lib/arca/errors'
import { isArcaGuideStepId } from '@/lib/arca/guide'
import { ArcaFault, type ArcaMsg, ArcaRequestError, readSoapResponse } from '@/lib/arca/soap'
import { parseCaeResponse, parseUltimoAutorizado } from '@/lib/arca/wsfe'
import { XmlParseError } from '@/lib/xml/mini'
import { ARCA_XML, type ArcaXmlFixture, arcaXml } from '@/tests/fixtures/arca/xml/fixtures'

/** Lo que tira leer un fixture como respuesta HTTP (o `null` si no tira). */
function thrownBy(fixture: ArcaXmlFixture, status: number): unknown {
  try {
    readSoapResponse({ status, body: arcaXml(fixture) })
  } catch (e) {
    return e
  }
  return null
}

const msg = (code: number, text = ''): ArcaMsg => ({ code, msg: text })

describe('catálogo', () => {
  it('cada clave tiene título, texto, reintento y un paso válido (o ninguno)', () => {
    for (const key of ARCA_ERROR_KEYS) {
      const info = ARCA_ERRORS[key]
      expect(info.title.trim().length, key).toBeGreaterThan(3)
      expect(info.body.trim().length, key).toBeGreaterThan(10)
      expect(['now', 'later', 'after_fix'], key).toContain(info.retry)
      if (info.step !== null) expect(isArcaGuideStepId(info.step), key).toBe(true)
      // La base guarda la clave en last_error_key: ^[a-z][a-z0-9_]{1,59}$.
      expect(key).toMatch(/^[a-z][a-z0-9_]{1,59}$/)
    }
  })

  it('si el texto tiene huecos, hay respaldo sin huecos', () => {
    for (const key of ARCA_ERROR_KEYS) {
      const info = ARCA_ERRORS[key]
      if (/\{\w+\}/.test(info.body)) {
        expect(info.fallback, key).toBeDefined()
        expect(info.fallback, key).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('los errores que se arreglan en ARCA apuntan a su paso (§2.7)', () => {
    const expected: Partial<Record<ArcaErrorKey, string>> = {
      arca_not_authorized: 's7_wsfe',
      arca_wrong_environment: 's6_certificado',
      arca_cert_expired: 's6_certificado',
      arca_key_mismatch: 's5_pedido',
      arca_already_authenticated: 's6_certificado',
      arca_cuit_not_in_token: 's7_wsfe',
      arca_pos_not_enabled: 's2_punto_venta',
      arca_pos_blocked: 's2_punto_venta',
      arca_issuer_problem: 's0_prereq',
      arca_class_a_not_enabled: 's3_factura_a',
    }
    for (const [key, step] of Object.entries(expected)) {
      expect(ARCA_ERRORS[key as ArcaErrorKey].step, key).toBe(step)
    }
    expect(ARCA_ERRORS.arca_unavailable.step).toBeNull()
    expect(ARCA_ERRORS.arca_amounts.bug).toBe(true)
    expect(isArcaErrorKey('arca_busy')).toBe(true)
    expect(isArcaErrorKey('arca_nada')).toBe(false)
  })
})

describe('cada fixture va a su clave', () => {
  const cases: Array<[ArcaXmlFixture, number, ArcaErrorKey]> = [
    [ARCA_XML.wsaaFaultCertUntrusted, 500, 'arca_wrong_environment'],
    [ARCA_XML.wsaaFaultBadBase64, 500, 'arca_internal'],
    [ARCA_XML.wsaaFaultAlreadyAuthenticated, 500, 'arca_already_authenticated'],
    [ARCA_XML.wsaaFaultNotAuthorized, 500, 'arca_not_authorized'],
    [ARCA_XML.wsfeFaultSoapAction, 500, 'arca_internal'],
    [ARCA_XML.padronFaultToken, 500, 'arca_token_rejected'],
    [ARCA_XML.htmlMantenimiento, 200, 'arca_unavailable'],
    [ARCA_XML.htmlMantenimiento, 503, 'arca_unavailable'],
  ]
  for (const [fixture, status, key] of cases) {
    it(`${fixture} (HTTP ${status}) → ${key}`, () => {
      expect(classifyArcaError(thrownBy(fixture, status))).toBe(key)
    })
  }

  it('Errors y Observaciones de WSFE', () => {
    expect(
      classifyArcaMessages(parseUltimoAutorizado(arcaXml(ARCA_XML.wsfeUltimoErr600)).errors),
    ).toBe('arca_token_rejected')
    expect(
      classifyArcaMessages(parseUltimoAutorizado(arcaXml(ARCA_XML.wsfeUltimoErr11002)).errors),
    ).toBe('arca_pos_not_enabled')
    expect(
      classifyArcaMessages(parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeRechazado10016)).obs),
    ).toBe('arca_number_mismatch')
    expect(
      classifyArcaMessages(parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeRechazado10000)).obs),
    ).toBe('arca_issuer_problem')
    expect(
      classifyArcaMessages(parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeErr600Relaciones)).errors),
    ).toBe('arca_cuit_not_in_token')
  })
})

describe('classifyArcaMessages', () => {
  const cases: Array<[ArcaMsg[], ArcaErrorKey]> = [
    [
      [msg(600, 'ValidacionDeToken: No aparecio CUIT en lista de relaciones: 30712345671')],
      'arca_cuit_not_in_token',
    ],
    [
      [msg(600, 'Error al verificar hash: VerificacionDeHash: No validó la firma digital.')],
      'arca_wrong_environment',
    ],
    [[msg(600, 'ValidacionDeToken: No valido token.')], 'arca_token_rejected'],
    [[msg(601, 'CUIT representada no incluida en token')], 'arca_cuit_not_in_token'],
    [
      [msg(502, 'Error interno de base de datos - Autorizador CAE - Transaccion Activa')],
      'arca_in_flight',
    ],
    [[msg(501, 'Error interno de base de datos')], 'arca_unavailable'],
    [[msg(500)], 'arca_unavailable'],
    [
      [
        msg(
          10000,
          '04 LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES CLASE "A"',
        ),
      ],
      'arca_class_a_not_enabled',
    ],
    [[msg(10000, '09 NO AUTORIZADA A A CON LEYENDA')], 'arca_class_a_not_enabled'],
    [
      [
        msg(
          10000,
          '02 LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES ELECTRONICOS',
        ),
      ],
      'arca_issuer_problem',
    ],
    [[msg(10234)], 'arca_class_a_not_enabled'],
    [[msg(10005)], 'arca_pos_not_enabled'],
    [[msg(11002)], 'arca_pos_not_enabled'],
    [[msg(10016)], 'arca_number_mismatch'],
    [[msg(10192)], 'arca_fce_required'],
    [[msg(10243)], 'arca_receiver_condition'],
    [[msg(10246)], 'arca_receiver_condition'],
    [[msg(10013)], 'arca_receiver_document'],
    [[msg(10015)], 'arca_receiver_document'],
    [[msg(10048)], 'arca_amounts'],
    [[msg(10051)], 'arca_amounts'],
    [[msg(10049)], 'arca_internal'],
    [[msg(10197)], 'arca_internal'],
    [[msg(602)], 'arca_unknown'],
    [[msg(99999)], 'arca_unknown'],
    [[], 'arca_unknown'],
    // El más importante gana: el emisor antes que los importes.
    [[msg(10048), msg(10000, '11 SIN DFE')], 'arca_issuer_problem'],
  ]
  for (const [messages, key] of cases) {
    it(`${messages.map((m) => m.code).join('+') || 'nada'} → ${key}`, () => {
      expect(classifyArcaMessages(messages)).toBe(key)
    })
  }

  it('submensajes del 10000', () => {
    expect(
      issuerSubcodes([
        msg(10000, '11 LA CUIT…'),
        msg(10000, '01 NO ES RI'),
        msg(10000, '11 otra vez'),
        msg(10016, '06 x'),
      ]),
    ).toEqual(['11', '01'])
    expect(issuerSubcodes([msg(10000, '123 no')])).toEqual([])
  })
})

describe('classifyArcaError (todas las fallas)', () => {
  const fault = (kind: ArcaFault['kind'], code: string, detail = '') =>
    new ArcaFault(kind, code, { detail })
  const cases: Array<[unknown, ArcaErrorKey]> = [
    [fault('timeout', 'timeout'), 'arca_unavailable'],
    [fault('network', 'ECONNRESET'), 'arca_unavailable'],
    [fault('network', 'ENOTFOUND'), 'arca_unavailable'],
    [fault('network', 'ERR_SSL_DH_KEY_TOO_SMALL'), 'arca_internal'],
    [fault('network', 'url_not_allowed'), 'arca_internal'],
    [fault('network', 'relay_502'), 'arca_unavailable'],
    [new ArcaFault('http', 'http_404', { httpStatus: 404 }), 'arca_internal'],
    [new ArcaFault('http', 'http_502', { httpStatus: 502 }), 'arca_unavailable'],
    [fault('protocol', 'not_soap'), 'arca_unavailable'],
    [fault('fault', 'cms.cert.expired'), 'arca_cert_expired'],
    [fault('fault', 'cms.sign.invalid'), 'arca_key_mismatch'],
    [fault('fault', 'cms.cert.invalid'), 'arca_clock'],
    [fault('fault', 'xml.generationTime.invalid'), 'arca_clock'],
    [fault('fault', 'wsaa.unavailable'), 'arca_unavailable'],
    [fault('fault', 'wsn.unavailable'), 'arca_unavailable'],
    [
      fault('fault', 'Server', 'El CEE ya posee un TA valido para el acceso al WSN solicitado'),
      'arca_already_authenticated',
    ],
    [
      fault('fault', 'Server', 'La CUIT representada no se encuentra en las relaciones'),
      'arca_cuit_not_in_token',
    ],
    [
      fault('fault', 'Server', 'Computador no autorizado a acceder al servicio'),
      'arca_not_authorized',
    ],
    [fault('fault', 'Server', 'Error interno'), 'arca_unavailable'],
    [fault('fault', 'Client', 'Bad request'), 'arca_internal'],
    [fault('fault', 'algo.raro'), 'arca_unknown'],
    [new ArcaFault('service', '10016', { messages: [msg(10016)] }), 'arca_number_mismatch'],
    [new ArcaError('arca_busy'), 'arca_busy'],
    [Object.assign(new Error('x'), { name: 'ArcaError', key: 'arca_in_flight' }), 'arca_in_flight'],
    [
      Object.assign(new Error('x'), { name: 'ArcaCryptoError', code: 'key_mismatch' }),
      'arca_key_mismatch',
    ],
    [
      Object.assign(new Error('x'), { name: 'ArcaCryptoError', code: 'invalid_key' }),
      'arca_internal',
    ],
    [new ArcaRequestError('DocNro', 'no'), 'arca_internal'],
    [new XmlParseError('roto', 3), 'arca_unavailable'],
    [new TypeError('bug'), 'arca_internal'],
    ['un string', 'arca_internal'],
    [null, 'arca_internal'],
  ]
  for (const [error, key] of cases) {
    it(`${error instanceof Error ? `${error.name} ${error.message}` : String(error)} → ${key}`, () => {
      expect(classifyArcaError(error)).toBe(key)
    })
  }

  it('el mensaje de una ArcaFault no lleva el texto de ARCA (puede traer una CUIT)', () => {
    const f = new ArcaFault('service', '600', {
      detail: 'ValidacionDeToken: No aparecio CUIT en lista de relaciones: 30712345671',
      method: 'FECAESolicitar',
    })
    expect(f.message).toBe('ARCA service: 600 (FECAESolicitar)')
    expect(f.message).not.toContain('30712345671')
  })
})

describe('describeArcaError', () => {
  it('completa los datos del bar y, si faltan, usa el respaldo', () => {
    const notAuth = new ArcaFault('fault', 'coe.notAuthorized', { service: 'wsaa', wsn: 'wsfe' })
    const withAlias = describeArcaError(notAuth, { alias: 'hubplataforma' })
    expect(withAlias).toMatchObject({
      key: 'arca_not_authorized',
      step: 's7_wsfe',
      code: 'coe.notAuthorized',
    })
    expect(withAlias.body).toContain('«hubplataforma»')
    expect(describeArcaError(notAuth).body).toContain('el alias de la plataforma')
  })

  it('no autorizado en el padrón → paso 8 y otro texto', () => {
    const view = describeArcaError(
      new ArcaFault('fault', 'coe.notAuthorized', {
        service: 'wsaa',
        wsn: 'ws_sr_constancia_inscripcion',
      }),
      { alias: 'hubplataforma' },
    )
    expect(view.step).toBe('s8_padron')
    expect(view.title).toBe('Falta autorizar la consulta del padrón')
    expect(view.body).toContain('Consulta de constancia de inscripción')
    expect(describeArcaErrorKey('arca_not_authorized', { service: 'padron' }).step).toBe(
      's8_padron',
    )
  })

  it('punto de venta, SAS, minutos y comprobante', () => {
    expect(describeArcaErrorKey('arca_pos_not_enabled', { pointOfSale: 5 }).body).toContain(
      'El punto de venta 0005 no está habilitado',
    )
    expect(
      describeArcaErrorKey('arca_cuit_not_in_token', { sasName: 'BAR DE PRUEBA SAS' }).body,
    ).toContain('«Actuando en representación de BAR DE PRUEBA SAS»')
    expect(
      describeArcaErrorKey('arca_already_authenticated', { environment: 'produccion' }).body,
    ).toContain('esperá 2 minutos')
    expect(
      describeArcaErrorKey('arca_already_authenticated', { environment: 'homologacion' }).body,
    ).toContain('esperá 10 minutos')
    expect(describeArcaErrorKey('arca_already_authenticated').body).toContain(
      'entre 2 y 10 minutos',
    )
    const posted = describeArcaErrorKey('arca_authorized_not_posted', {
      voucherLabel: 'Factura B 0005-00000105',
      cae: '76412345678901',
      reason: 'el mes está cerrado',
    })
    expect(posted.body).toBe(
      'ARCA autorizó la Factura B 0005-00000105 (CAE 76412345678901), pero no pudimos cargarla en los libros: el mes está cerrado. Tocá «Cargarla ahora».',
    )
    expect(describeArcaErrorKey('arca_authorized_not_posted', { cae: '1' }).body).not.toMatch(/\{/)
  })

  it('el 10000 dice qué le falta a la SAS', () => {
    const fault = new ArcaFault('service', '10000', {
      messages: [
        msg(10000, '11 LA CUIT INFORMADA NO TIENE ACTIVO EL DOMICILIO FISCAL ELECTRONICO'),
        msg(10000, '06 DEBE POSEER AL MENOS UNA ACTIVAD ACTIVA.'),
      ],
    })
    const view = describeArcaError(fault)
    expect(view.key).toBe('arca_issuer_problem')
    expect(view.step).toBe('s0_prereq')
    expect(view.body).toBe(
      `ARCA no deja facturar a la SAS: ${ISSUER_SUBMESSAGES['11']}; ${ISSUER_SUBMESSAGES['06']}. Lo resuelve quien maneja la clave fiscal de la SAS, con la contadora (paso 0).`,
    )
    expect(view.code).toBe('10000')
  })

  it('un código que no conocemos va con el código', () => {
    const view = describeArcaError(
      new ArcaFault('service', '12345', { messages: [msg(12345, 'x')] }),
    )
    expect(view.key).toBe('arca_unknown')
    expect(view.body).toContain('(código 12345)')
    expect(describeArcaErrorKey('arca_unknown').body).not.toContain('{codigo}')
  })

  it('los bugs se marcan para loguear', () => {
    expect(describeArcaError(new ArcaRequestError('x', 'y')).bug).toBe(true)
    expect(describeArcaError(new ArcaFault('timeout', 'timeout')).bug).toBe(false)
  })
})

describe('wsaaCooldown (especificación 1.2.2)', () => {
  it('60 s si ARCA no respondió; 2 o 10 min si ya hay ticket; manual para el resto', () => {
    expect(wsaaCooldown('arca_unavailable', 'produccion')).toBe(60)
    expect(wsaaCooldown('arca_already_authenticated', 'produccion')).toBe(120)
    expect(wsaaCooldown('arca_already_authenticated', 'homologacion')).toBe(600)
    for (const key of [
      'arca_not_authorized',
      'arca_wrong_environment',
      'arca_cert_expired',
      'arca_key_mismatch',
      'arca_clock',
      'arca_internal',
      'arca_unknown',
    ] as const) {
      expect(wsaaCooldown(key, 'produccion'), key).toBe('manual')
    }
    // La base acepta 0–3600 s o 'manual'.
    for (const key of ARCA_ERROR_KEYS) {
      for (const env of ['produccion', 'homologacion'] as const) {
        const c = wsaaCooldown(key, env)
        expect(c === 'manual' || (Number.isInteger(c) && c >= 0 && c <= 3600)).toBe(true)
      }
    }
  })
})
