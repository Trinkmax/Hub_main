import { describe, expect, it } from 'vitest'
import { ARCA_ENDPOINTS } from '@/lib/arca/endpoints'
import { classifyArcaError, classifyArcaMessages, describeArcaError } from '@/lib/arca/errors'
import { type WsfeAmounts, wsfeAmounts } from '@/lib/arca/importes'
import {
  ArcaFault,
  type ArcaHttpResponse,
  ArcaRequestError,
  type ArcaTransport,
  readSoapResponse,
  soapHeaders,
} from '@/lib/arca/soap'
import {
  ARCA_QR_BASE_URL,
  associableCbteTipos,
  CBTE_TIPO,
  CBTE_TIPOS,
  CONDICION_IVA_RECEPTOR,
  cbteForVoucherType,
  condicionFromIvaCondition,
  docNroFor,
  docTipoFor,
  FINAL_CONSUMER_ID_THRESHOLD_CENTS,
  isCondicionValidForLetter,
  isNoteCbte,
  letterForCbte,
  letterForCondicion,
  qrJson,
  qrPayload,
  qrUrl,
  voucherTypeForCbte,
} from '@/lib/arca/vouchers'
import {
  type CaeRequest,
  caeRequestRecord,
  caeSolicitarBody,
  compConsultaMismatches,
  compConsultarBody,
  condicionIvaReceptorBody,
  createWsfe,
  feDummyBody,
  paramListBody,
  parseCaeResponse,
  parseCompConsultar,
  parseCondicionIvaReceptor,
  parseFeDummy,
  parseParamList,
  parsePtosVenta,
  parseUltimoAutorizado,
  pointOfSaleStatus,
  ptosVentaBody,
  readMessages,
  ultimoAutorizadoBody,
  WSFE_METHODS,
  type WsfeAuth,
  wsfeDate,
  wsfeProcessedAt,
  wsfeSoapAction,
} from '@/lib/arca/wsfe'
import { child, childrenNamed, nodeAt, parseXml, textAt } from '@/lib/xml/mini'
import {
  ARCA_XML,
  type ArcaXmlFixture,
  arcaXml,
  XML_CUITS,
} from '@/tests/fixtures/arca/xml/fixtures'

const AUTH: WsfeAuth = { token: 'PD94bWwg+/=', sign: 'U2lnbg==', cuit: XML_CUITS.sas }

/** Factura B a consumidor final por $ 121 (neto 100 + IVA 21 %), como la de prueba de §2.3. */
const B121: WsfeAmounts = wsfeAmounts({
  net_21_cents: 10_000,
  vat_21_cents: 2_100,
  total_cents: 12_100,
})

const FACTURA_B: CaeRequest = {
  ptoVta: 5,
  cbteTipo: 6,
  number: 105,
  concepto: 1,
  docTipo: 99,
  docNro: '0',
  cbteFch: '2026-10-08',
  amounts: B121,
  condicionIvaReceptorId: 5,
}

/** El orden de `FEDetRequest` en el WSDL (homologación, 08/10/2026). */
const WSDL_DET_ORDER = [
  'Concepto',
  'DocTipo',
  'DocNro',
  'CbteDesde',
  'CbteHasta',
  'CbteFch',
  'ImpTotal',
  'ImpTotConc',
  'ImpNeto',
  'ImpOpEx',
  'ImpTrib',
  'ImpIVA',
  'FchServDesde',
  'FchServHasta',
  'FchVtoPago',
  'MonId',
  'MonCotiz',
  'CanMisMonExt',
  'CondicionIVAReceptorId',
  'CbtesAsoc',
  'Tributos',
  'Iva',
  'Opcionales',
  'Compradores',
  'PeriodoAsoc',
  'Actividades',
]

function detOf(body: string) {
  const det = nodeAt(parseXml(body), 'Body/FECAESolicitar/FeCAEReq/FeDetReq/FECAEDetRequest')
  if (!det) throw new Error('no hay FECAEDetRequest')
  return det
}

function expectWsdlOrder(names: readonly string[]) {
  const positions = names.map((n) => WSDL_DET_ORDER.indexOf(n))
  expect(
    positions.every((p) => p >= 0),
    names.join(','),
  ).toBe(true)
  expect([...positions].sort((a, b) => a - b)).toEqual(positions)
}

function requestError(fn: () => unknown): ArcaRequestError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ArcaRequestError) return e
    throw new Error(`se esperaba ArcaRequestError y vino: ${String(e)}`)
  }
  throw new Error('se esperaba que fallara')
}

function faultFrom(fn: () => unknown): ArcaFault {
  try {
    fn()
  } catch (e) {
    if (e instanceof ArcaFault) return e
    throw new Error(`se esperaba ArcaFault y vino: ${String(e)}`)
  }
  throw new Error('se esperaba que fallara')
}

// ─── SOAPAction ──────────────────────────────────────────────────────────────

describe('SOAPAction de WSFE', () => {
  it('es exacto por método (vacío da HTTP 500 en ARCA)', () => {
    for (const method of WSFE_METHODS) {
      expect(wsfeSoapAction(method)).toBe(`http://ar.gov.afip.dif.FEV1/${method}`)
    }
    expect(soapHeaders('1.1', caeSolicitarBody(AUTH, FACTURA_B).soapAction)).toEqual({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"',
    })
    expect(feDummyBody().soapAction).toBe('http://ar.gov.afip.dif.FEV1/FEDummy')
    expect(ptosVentaBody(AUTH).method).toBe('FEParamGetPtosVenta')
  })
})

// ─── Builders ────────────────────────────────────────────────────────────────

describe('builders', () => {
  it('FEDummy', () => {
    expect(feDummyBody().body).toBe(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">' +
        '<soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>',
    )
  })

  it('FECompUltimoAutorizado con Auth escapado', () => {
    const call = ultimoAutorizadoBody(
      { token: 'a&b<c>"d\'', sign: 'S', cuit: '30-71234567-1' },
      5,
      6,
    )
    expect(call.body).toContain(
      '<ar:FECompUltimoAutorizado><ar:Auth><ar:Token>a&amp;b&lt;c&gt;&quot;d&apos;</ar:Token>' +
        '<ar:Sign>S</ar:Sign><ar:Cuit>30712345671</ar:Cuit></ar:Auth>' +
        '<ar:PtoVta>5</ar:PtoVta><ar:CbteTipo>6</ar:CbteTipo></ar:FECompUltimoAutorizado>',
    )
    expect(textAt(parseXml(call.body), 'Body/FECompUltimoAutorizado/Auth/Token')).toBe('a&b<c>"d\'')
  })

  it('FECompConsultar va en el orden del WSDL: CbteTipo, CbteNro, PtoVta', () => {
    const req = nodeAt(
      parseXml(compConsultarBody(AUTH, 6, 5, 105).body),
      'Body/FECompConsultar/FeCompConsReq',
    )
    expect(req?.children.map((c) => c.name)).toEqual(['CbteTipo', 'CbteNro', 'PtoVta'])
    expect(req?.children.map((c) => c.text)).toEqual(['6', '105', '5'])
  })

  it('FEParamGetCondicionIvaReceptor lleva ClaseCmp opcional; las tablas solo Auth', () => {
    expect(condicionIvaReceptorBody(AUTH, 'B').body).toContain('<ar:ClaseCmp>B</ar:ClaseCmp>')
    expect(condicionIvaReceptorBody(AUTH).body).not.toContain('ClaseCmp')
    const tipos = parseXml(paramListBody(AUTH, 'FEParamGetTiposIva').body)
    expect(child(nodeAt(tipos, 'Body'), 'FEParamGetTiposIva')?.children.map((c) => c.name)).toEqual(
      ['Auth'],
    )
  })

  it('rechaza Auth sin ticket o con una CUIT inválida, y rangos de PtoVta', () => {
    expect(requestError(() => ultimoAutorizadoBody({ ...AUTH, token: ' ' }, 5, 6)).field).toBe(
      'Auth',
    )
    expect(
      requestError(() => ultimoAutorizadoBody({ ...AUTH, cuit: '30712345672' }, 5, 6)).field,
    ).toBe('Auth.Cuit')
    expect(requestError(() => ultimoAutorizadoBody(AUTH, 0, 6)).field).toBe('PtoVta')
    expect(requestError(() => ultimoAutorizadoBody(AUTH, 99_999, 6)).field).toBe('PtoVta')
    expect(requestError(() => compConsultarBody(AUTH, 6, 5, 0)).field).toBe('CbteNro')
  })
})

describe('FECAESolicitar', () => {
  it('Factura B a consumidor final: el sobre exacto', () => {
    expect(caeSolicitarBody(AUTH, FACTURA_B).body).toBe(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">' +
        '<soapenv:Header/><soapenv:Body><ar:FECAESolicitar>' +
        '<ar:Auth><ar:Token>PD94bWwg+/=</ar:Token><ar:Sign>U2lnbg==</ar:Sign><ar:Cuit>30712345671</ar:Cuit></ar:Auth>' +
        '<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>5</ar:PtoVta><ar:CbteTipo>6</ar:CbteTipo></ar:FeCabReq>' +
        '<ar:FeDetReq><ar:FECAEDetRequest>' +
        '<ar:Concepto>1</ar:Concepto><ar:DocTipo>99</ar:DocTipo><ar:DocNro>0</ar:DocNro>' +
        '<ar:CbteDesde>105</ar:CbteDesde><ar:CbteHasta>105</ar:CbteHasta><ar:CbteFch>20261008</ar:CbteFch>' +
        '<ar:ImpTotal>121.00</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>100.00</ar:ImpNeto>' +
        '<ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>21.00</ar:ImpIVA>' +
        '<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>' +
        '<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>100.00</ar:BaseImp><ar:Importe>21.00</ar:Importe></ar:AlicIva></ar:Iva>' +
        '</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>',
    )
  })

  it('Factura A con dos alícuotas, no gravado y exento: orden del WSDL y CondicionIVAReceptorId siempre', () => {
    const amounts = wsfeAmounts({
      net_105_cents: 50_000,
      vat_105_cents: 5_250,
      net_21_cents: 1_000_000,
      vat_21_cents: 210_000,
      non_taxed_cents: 1_000,
      exempt_cents: 2_000,
      total_cents: 1_268_250,
    })
    const det = detOf(
      caeSolicitarBody(AUTH, {
        ...FACTURA_B,
        cbteTipo: 1,
        number: 12,
        docTipo: 80,
        docNro: '30-70000000-8',
        amounts,
        condicionIvaReceptorId: 1,
      }).body,
    )
    const names = det.children.map((c) => c.name)
    expectWsdlOrder(names)
    expect(names).toContain('CondicionIVAReceptorId')
    expect(textAt(det, 'DocNro')).toBe('30700000008')
    expect(textAt(det, 'ImpTotal')).toBe('12682.50')
    expect(textAt(det, 'ImpTotConc')).toBe('10.00')
    expect(textAt(det, 'ImpNeto')).toBe('10500.00')
    expect(textAt(det, 'ImpOpEx')).toBe('20.00')
    expect(textAt(det, 'ImpIVA')).toBe('2152.50')
    const alics = childrenNamed(child(det, 'Iva'), 'AlicIva').map((a) => [
      textAt(a, 'Id'),
      textAt(a, 'BaseImp'),
      textAt(a, 'Importe'),
    ])
    expect(alics).toEqual([
      ['4', '500.00', '52.50'],
      ['5', '10000.00', '2100.00'],
    ])
  })

  it('servicios (concepto 2): fechas entre ImpIVA y MonId', () => {
    const det = detOf(
      caeSolicitarBody(AUTH, {
        ...FACTURA_B,
        concepto: 2,
        serviceFrom: '2026-10-01',
        serviceTo: '2026-10-31',
        paymentDue: '2026-11-10',
      }).body,
    )
    const names = det.children.map((c) => c.name)
    expectWsdlOrder(names)
    expect(names.slice(11, 16)).toEqual([
      'ImpIVA',
      'FchServDesde',
      'FchServHasta',
      'FchVtoPago',
      'MonId',
    ])
    expect(textAt(det, 'FchVtoPago')).toBe('20261110')
  })

  it('nota de crédito B: CbtesAsoc antes de Iva, en el orden Tipo, PtoVta, Nro, Cuit, CbteFch', () => {
    const det = detOf(
      caeSolicitarBody(AUTH, {
        ...FACTURA_B,
        cbteTipo: 8,
        number: 7,
        associated: [
          { cbteTipo: 6, ptoVta: 5, number: 105, cuit: XML_CUITS.sas, cbteFch: '2026-10-08' },
        ],
      }).body,
    )
    expectWsdlOrder(det.children.map((c) => c.name))
    const asoc = nodeAt(det, 'CbtesAsoc/CbteAsoc')
    expect(asoc?.children.map((c) => [c.name, c.text])).toEqual([
      ['Tipo', '6'],
      ['PtoVta', '5'],
      ['Nro', '105'],
      ['Cuit', '30712345671'],
      ['CbteFch', '20261008'],
    ])
  })

  it('nota de débito con período asociado: PeriodoAsoc al final', () => {
    const det = detOf(
      caeSolicitarBody(AUTH, {
        ...FACTURA_B,
        cbteTipo: 7,
        number: 3,
        associatedPeriod: { from: '2026-09-01', to: '2026-09-30' },
      }).body,
    )
    const names = det.children.map((c) => c.name)
    expectWsdlOrder(names)
    expect(names.at(-1)).toBe('PeriodoAsoc')
    expect(textAt(det, 'PeriodoAsoc/FchDesde')).toBe('20260901')
  })

  it('solo IVA 0 %: AlicIva con Id 3 y ImpIVA 0', () => {
    const det = detOf(
      caeSolicitarBody(AUTH, {
        ...FACTURA_B,
        amounts: wsfeAmounts({ net_0_cents: 5_000, total_cents: 5_000 }),
      }).body,
    )
    expect(textAt(det, 'ImpIVA')).toBe('0.00')
    expect(textAt(det, 'Iva/AlicIva/Id')).toBe('3')
    expect(textAt(det, 'Iva/AlicIva/Importe')).toBe('0.00')
  })

  it('el registro para guardar no lleva Auth', () => {
    const record = caeRequestRecord(FACTURA_B)
    const json = JSON.stringify(record)
    expect(json).not.toContain('Token')
    expect(json).not.toContain(AUTH.sign)
    expect(record.FeCabReq).toEqual({ CantReg: '1', PtoVta: '5', CbteTipo: '6' })
    expect(Object.keys(record.FeDetReq.FECAEDetRequest[0] ?? {})).toEqual([
      'Concepto',
      'DocTipo',
      'DocNro',
      'CbteDesde',
      'CbteHasta',
      'CbteFch',
      'ImpTotal',
      'ImpTotConc',
      'ImpNeto',
      'ImpOpEx',
      'ImpTrib',
      'ImpIVA',
      'MonId',
      'MonCotiz',
      'CondicionIVAReceptorId',
      'Iva',
    ])
  })

  it('no arma pedidos que ARCA rechazaría', () => {
    const cases: Array<[Partial<CaeRequest>, string]> = [
      [{ cbteTipo: 11 as CaeRequest['cbteTipo'] }, 'CbteTipo'],
      [{ ptoVta: 0 }, 'PtoVta'],
      [{ number: 0 }, 'CbteDesde'],
      [{ number: 100_000_000 }, 'CbteDesde'],
      [{ concepto: 4 as CaeRequest['concepto'] }, 'Concepto'],
      [{ docNro: '20123456786' }, 'DocNro'], // con 99 va 0
      [{ docTipo: 80, docNro: '30712345672' }, 'DocNro'],
      [{ docTipo: 96, docNro: '0' }, 'DocNro'],
      [{ docTipo: 87 as CaeRequest['docTipo'], docNro: '1' }, 'DocTipo'],
      [{ cbteTipo: 1, condicionIvaReceptorId: 1 }, 'DocTipo'], // A sin CUIT (10013)
      [{ condicionIvaReceptorId: 1 }, 'CondicionIVAReceptorId'], // B a un RI (10243)
      [
        { cbteTipo: 1, docTipo: 80, docNro: XML_CUITS.sas, condicionIvaReceptorId: 5 },
        'CondicionIVAReceptorId',
      ],
      [{ condicionIvaReceptorId: 2 }, 'CondicionIVAReceptorId'], // no existe (10242)
      [{ cbteFch: '2026-02-30' }, 'CbteFch'],
      [{ serviceFrom: '2026-10-01' }, 'FchServDesde'], // concepto 1 con fechas
      [{ concepto: 2 }, 'FchServDesde'], // concepto 2 sin fechas (10049)
      [
        {
          concepto: 3,
          serviceFrom: '2026-10-31',
          serviceTo: '2026-10-01',
          paymentDue: '2026-11-01',
        },
        'FchServHasta',
      ],
      [{ cbteTipo: 8 }, 'CbtesAsoc'], // NC sin asociado (10197)
      [{ associated: [{ cbteTipo: 6, ptoVta: 5, number: 1 }] }, 'CbtesAsoc'], // factura con asociado
      [{ cbteTipo: 8, associated: [{ cbteTipo: 1, ptoVta: 5, number: 1 }] }, 'CbtesAsoc.0.Tipo'], // 10040
      [
        {
          cbteTipo: 8,
          associated: [
            { cbteTipo: 6, ptoVta: 5, number: 1 },
            { cbteTipo: 6, ptoVta: 5, number: 1 },
          ],
        },
        'CbtesAsoc.1',
      ],
      [
        { cbteTipo: 7, associatedPeriod: { from: '2026-09-30', to: '2026-09-01' } },
        'PeriodoAsoc.FchHasta',
      ],
      [
        {
          cbteTipo: 8,
          associated: [{ cbteTipo: 6, ptoVta: 5, number: 1 }],
          associatedPeriod: { from: '2026-09-01', to: '2026-09-30' },
        },
        'CbtesAsoc',
      ],
      [{ amounts: { ...B121, totalCents: 12_101 } }, 'importes'], // 10048
    ]
    for (const [patch, field] of cases) {
      expect(
        requestError(() => caeSolicitarBody(AUTH, { ...FACTURA_B, ...patch })).field,
        field,
      ).toBe(field)
    }
  })
})

// ─── Parsers ─────────────────────────────────────────────────────────────────

describe('parsers', () => {
  it('FEDummy real de producción y de homologación', () => {
    for (const fixture of [ARCA_XML.wsfeDummyProduccion, ARCA_XML.wsfeDummyHomologacion]) {
      expect(parseFeDummy(arcaXml(fixture))).toEqual({
        appServer: 'OK',
        dbServer: 'OK',
        authServer: 'OK',
        ok: true,
      })
    }
    const down = arcaXml(ARCA_XML.wsfeDummyProduccion).replace(
      '<DbServer>OK</DbServer>',
      '<DbServer>No disponible</DbServer>',
    )
    expect(parseFeDummy(down).ok).toBe(false)
  })

  it('FECompUltimoAutorizado: el número y los errores reales', () => {
    expect(parseUltimoAutorizado(arcaXml(ARCA_XML.wsfeUltimoOk))).toEqual({
      ptoVta: 5,
      cbteTipo: 6,
      cbteNro: 104,
      errors: [],
      events: [],
    })
    const err = parseUltimoAutorizado(arcaXml(ARCA_XML.wsfeUltimoErr600))
    expect(err.errors).toEqual([{ code: 600, msg: 'ValidacionDeToken: No valido token.' }])
    expect(classifyArcaMessages(err.errors)).toBe('arca_token_rejected')
  })

  it('CAE aprobado', () => {
    expect(parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeAprobado))).toEqual({
      resultado: 'A',
      reproceso: 'N',
      cae: '76412345678901',
      caeDue: '2026-10-18',
      fchProceso: '20261008123456',
      processedAt: '2026-10-08T12:34:56-03:00',
      cbteDesde: 105,
      cbteHasta: 105,
      cbteFch: '2026-10-08',
      obs: [],
      errors: [],
      events: [],
    })
  })

  it('CAE aprobado con observaciones (Factura A a un monotributista)', () => {
    const r = parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeAprobadoObs))
    expect(r.resultado).toBe('A')
    expect(r.cae).toBe('76412345678902')
    expect(r.obs.map((o) => o.code)).toEqual([10217])
    expect(r.obs[0]?.msg).toContain('Ley Nº 27.618')
  })

  it('rechazos: Observaciones del comprobante y Errors del pedido', () => {
    const r10016 = parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeRechazado10016))
    expect(r10016).toMatchObject({ resultado: 'R', cae: null, caeDue: null })
    expect(classifyArcaMessages([...r10016.errors, ...r10016.obs])).toBe('arca_number_mismatch')

    const r10000 = parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeRechazado10000))
    expect(classifyArcaMessages(r10000.obs)).toBe('arca_issuer_problem')

    const r600 = parseCaeResponse(arcaXml(ARCA_XML.wsfeCaeErr600Relaciones))
    expect(r600.resultado).toBe('R') // sin Resultado: lo dan los Errors
    expect(r600.errors[0]?.code).toBe(600)
    expect(classifyArcaMessages(r600.errors)).toBe('arca_cuit_not_in_token')
  })

  it('A sin CAE válido o sin vencimiento, o sin Resultado ni errores, es protocol (se reconcilia)', () => {
    const ok = arcaXml(ARCA_XML.wsfeCaeAprobado)
    expect(faultFrom(() => parseCaeResponse(ok.replace('76412345678901', '7641234'))).code).toBe(
      'bad:CAE',
    )
    expect(
      faultFrom(() => parseCaeResponse(ok.replace('<CAEFchVto>20261018', '<CAEFchVto>'))).code,
    ).toBe('bad:CAEFchVto')
    const empty = ok.replace(/<FeCabResp>[\s\S]*<\/FeDetResp>/, '')
    expect(faultFrom(() => parseCaeResponse(empty)).code).toBe('missing:Resultado')
  })

  it('tolera el orden invertido de los ejemplos del manual (FEDetResponse > Obs > Observaciones)', () => {
    const manual = arcaXml(ARCA_XML.wsfeCaeRechazado10016)
      .replace('<FECAEDetResponse>', '<FEDetResponse>')
      .replace('</FECAEDetResponse>', '</FEDetResponse>')
      .replace('<Observaciones><Obs>', '<Obs><Observaciones>')
      .replace('</Obs></Observaciones>', '</Observaciones></Obs>')
    expect(parseCaeResponse(manual).obs.map((o) => o.code)).toEqual([10016])
  })

  it('FECompConsultar: el comprobante, en centavos, y el 602', () => {
    const { voucher, errors } = parseCompConsultar(arcaXml(ARCA_XML.wsfeCompConsultarOk))
    expect(errors).toEqual([])
    expect(voucher).toMatchObject({
      resultado: 'A',
      cae: '76412345678901',
      caeDue: '2026-10-18',
      emisionTipo: 'CAE',
      processedAt: '2026-10-08T12:34:56-03:00',
      ptoVta: 5,
      cbteTipo: 6,
      cbteDesde: 105,
      cbteFch: '2026-10-08',
      concepto: 1,
      docTipo: 99,
      docNro: '0',
      totalCents: 1_210_000,
      netCents: 1_000_000,
      vatCents: 210_000,
      nonTaxedCents: 0,
      condicionIvaReceptorId: 5,
      iva: [{ id: 5, baseCents: 1_000_000, vatCents: 210_000 }],
    })
    const none = parseCompConsultar(arcaXml(ARCA_XML.wsfeCompConsultar602))
    expect(none.voucher).toBeNull()
    expect(none.errors.map((e) => e.code)).toEqual([602])
  })

  it('compConsultaMismatches: vacío si es el mismo comprobante', () => {
    const { voucher } = parseCompConsultar(arcaXml(ARCA_XML.wsfeCompConsultarOk))
    if (!voucher) throw new Error('falta el comprobante')
    const req: CaeRequest = {
      ...FACTURA_B,
      amounts: wsfeAmounts({
        net_21_cents: 1_000_000,
        vat_21_cents: 210_000,
        total_cents: 1_210_000,
      }),
    }
    expect(compConsultaMismatches(voucher, req)).toEqual([])
    expect(compConsultaMismatches(voucher, { ...req, number: 106 })).toEqual(['CbteDesde'])
    expect(compConsultaMismatches(voucher, FACTURA_B)).toEqual(['ImpTotal', 'ImpNeto', 'ImpIVA'])
  })

  it('FEParamGetPtosVenta y el estado de cada punto de venta', () => {
    const { items, errors } = parsePtosVenta(arcaXml(ARCA_XML.wsfePtosVenta))
    expect(errors).toEqual([])
    expect(items).toEqual([
      { nro: 3, emisionTipo: 'CAE', bloqueado: false, fchBaja: null },
      { nro: 5, emisionTipo: 'CAE', bloqueado: false, fchBaja: null },
      { nro: 7, emisionTipo: 'CAEA', bloqueado: false, fchBaja: null },
      { nro: 9, emisionTipo: 'CAE', bloqueado: true, fchBaja: null },
      { nro: 11, emisionTipo: 'CAE', bloqueado: false, fchBaja: '2025-06-30' },
    ])
    expect(pointOfSaleStatus(items, 5)).toBe('ok')
    expect(pointOfSaleStatus(items, 7)).toBe('caea')
    expect(pointOfSaleStatus(items, 9)).toBe('blocked')
    expect(pointOfSaleStatus(items, 11)).toBe('dropped')
    expect(pointOfSaleStatus(items, 4)).toBe('missing')
    // Homologación sin puntos de venta: «Sin Resultados» (602).
    const none = parsePtosVenta(arcaXml(ARCA_XML.wsfePtosVenta602))
    expect(none.items).toEqual([])
    expect(none.errors.map((e) => e.code)).toEqual([602])
  })

  it('FEParamGetCondicionIvaReceptor: las 11 condiciones de la RG 5616', () => {
    const { items } = parseCondicionIvaReceptor(arcaXml(ARCA_XML.wsfeCondicionIvaReceptor))
    expect(items.map((i) => i.id)).toEqual(CONDICION_IVA_RECEPTOR.map((c) => c.id))
    expect(items[0]).toEqual({ id: 1, desc: 'IVA Responsable Inscripto', clase: 'A/M/C' })
  })

  it('una tabla de parámetros: filas con sus campos', () => {
    const { items } = parseParamList(arcaXml(ARCA_XML.wsfeTiposIva), 'FEParamGetTiposIva')
    expect(items).toHaveLength(6)
    expect(items[2]).toEqual({ Id: '5', Desc: '21%', FchDesde: '20090220', FchHasta: 'NULL' })
  })

  it('la respuesta de otro método es protocol', () => {
    const fault = faultFrom(() => parseUltimoAutorizado(arcaXml(ARCA_XML.wsfeDummyProduccion)))
    expect(fault).toMatchObject({
      kind: 'protocol',
      code: 'missing:FECompUltimoAutorizadoResult',
      service: 'wsfe',
      method: 'FECompUltimoAutorizado',
    })
  })

  it('un SOAPAction que ARCA no reconoce: soap:Client → bug nuestro', () => {
    const fault = faultFrom(() =>
      readSoapResponse({ status: 500, body: arcaXml(ARCA_XML.wsfeFaultSoapAction) }),
    )
    expect(fault.code).toBe('Client')
    expect(fault.detail).toContain('did not recognize the value of HTTP Header SOAPAction')
    expect(classifyArcaError(fault)).toBe('arca_internal')
  })

  it('readMessages lee Err, Obs y Evt', () => {
    const node = parseXml(
      '<Errors><Err><Code>10016</Code><Msg> El numero\n no coincide </Msg></Err><Err><Code>x</Code></Err></Errors>',
    )
    expect(readMessages(node)).toEqual([
      { code: 10016, msg: 'El numero no coincide' },
      { code: 0, msg: '' },
    ])
    expect(readMessages(null)).toEqual([])
  })

  it('fechas de WSFE', () => {
    expect(wsfeDate('20261018')).toBe('2026-10-18')
    expect(wsfeDate('20260230')).toBeNull()
    expect(wsfeDate('NULL')).toBeNull()
    expect(wsfeProcessedAt('20261008123456')).toBe('2026-10-08T12:34:56-03:00')
    expect(wsfeProcessedAt('20261008')).toBeNull()
    expect(wsfeProcessedAt('20261008253456')).toBeNull()
  })
})

// ─── Cliente ─────────────────────────────────────────────────────────────────

type Route = ArcaXmlFixture | (() => ArcaHttpResponse | Promise<ArcaHttpResponse>)

function router(routes: Partial<Record<string, Route | Route[]>>) {
  const calls: { method: string; url: string; body: string }[] = []
  const transport: ArcaTransport = async (req) => {
    const method = /FEV1\/(\w+)"$/.exec(req.headers.SOAPAction ?? '')?.[1] ?? '?'
    calls.push({ method, url: req.url, body: req.body })
    const entry = routes[method]
    const route = Array.isArray(entry)
      ? entry[calls.filter((c) => c.method === method).length - 1]
      : entry
    if (route === undefined) throw new Error(`sin ruta para ${method}`)
    if (typeof route === 'function') return route()
    return { status: 200, body: arcaXml(route) }
  }
  return { transport, calls }
}

const networkError = () => {
  throw new ArcaFault('network', 'ECONNRESET')
}

describe('createWsfe', () => {
  const getAuth = async () => AUTH

  it('dummy contra el WSFE del ambiente, sin ticket', async () => {
    let asked = false
    const { transport, calls } = router({ FEDummy: ARCA_XML.wsfeDummyProduccion })
    const wsfe = createWsfe(transport, 'produccion', async () => {
      asked = true
      return AUTH
    })
    expect((await wsfe.dummy()).ok).toBe(true)
    expect(calls[0]?.url).toBe(ARCA_ENDPOINTS.produccion.wsfe)
    expect(asked).toBe(false)
  })

  it('ultimoAutorizado: el número, o la falla de servicio con su clave', async () => {
    const ok = router({ FECompUltimoAutorizado: ARCA_XML.wsfeUltimoOk })
    const wsfe = createWsfe(ok.transport, 'homologacion', getAuth)
    expect(await wsfe.ultimoAutorizado(5, 6)).toBe(104)
    expect(ok.calls[0]?.url).toBe(ARCA_ENDPOINTS.homologacion.wsfe)
    expect(ok.calls[0]?.body).toContain('<ar:Token>PD94bWwg+/=</ar:Token>')

    const bad = router({ FECompUltimoAutorizado: ARCA_XML.wsfeUltimoErr11002 })
    const fault = await createWsfe(bad.transport, 'homologacion', getAuth)
      .ultimoAutorizado(5, 6)
      .catch((e: unknown) => e)
    expect(fault).toMatchObject({
      kind: 'service',
      code: '11002',
      method: 'FECompUltimoAutorizado',
    })
    expect(classifyArcaError(fault)).toBe('arca_pos_not_enabled')
    expect(describeArcaError(fault, { pointOfSale: 5 }).body).toContain('0005')
  })

  it('las consultas se reintentan una vez ante un error de red', async () => {
    const { transport, calls } = router({
      FECompUltimoAutorizado: [networkError, ARCA_XML.wsfeUltimoOk],
    })
    expect(await createWsfe(transport, 'homologacion', getAuth).ultimoAutorizado(5, 6)).toBe(104)
    expect(calls).toHaveLength(2)
  })

  it('un timeout no se reintenta (ya tardó 25 s)', async () => {
    const { transport, calls } = router({
      FECompUltimoAutorizado: () => {
        throw new ArcaFault('timeout', 'timeout')
      },
    })
    await expect(
      createWsfe(transport, 'homologacion', getAuth).ultimoAutorizado(5, 6),
    ).rejects.toMatchObject({ kind: 'timeout' })
    expect(calls).toHaveLength(1)
  })

  it('FECAESolicitar NUNCA se reintenta solo', async () => {
    const { transport, calls } = router({
      FECAESolicitar: [networkError, ARCA_XML.wsfeCaeAprobado],
    })
    await expect(
      createWsfe(transport, 'homologacion', getAuth).caeSolicitar(FACTURA_B),
    ).rejects.toMatchObject({ kind: 'network', method: 'FECAESolicitar' })
    expect(calls).toHaveLength(1)
  })

  it('caeSolicitar devuelve el resultado (también un rechazo) y desconfía de otro número', async () => {
    const ok = router({ FECAESolicitar: ARCA_XML.wsfeCaeAprobado })
    const result = await createWsfe(ok.transport, 'homologacion', getAuth).caeSolicitar(FACTURA_B)
    expect(result).toMatchObject({ resultado: 'A', cae: '76412345678901' })

    const rejected = router({ FECAESolicitar: ARCA_XML.wsfeCaeRechazado10016 })
    expect(
      (await createWsfe(rejected.transport, 'homologacion', getAuth).caeSolicitar(FACTURA_B))
        .resultado,
    ).toBe('R')

    const other = router({ FECAESolicitar: ARCA_XML.wsfeCaeAprobado })
    await expect(
      createWsfe(other.transport, 'homologacion', getAuth).caeSolicitar({
        ...FACTURA_B,
        number: 106,
      }),
    ).rejects.toMatchObject({ kind: 'protocol', code: 'cae_number_mismatch' })
  })

  it('compConsultar: el comprobante, null con 602, y falla con otros errores', async () => {
    const found = router({ FECompConsultar: ARCA_XML.wsfeCompConsultarOk })
    expect(
      (await createWsfe(found.transport, 'produccion', getAuth).compConsultar(6, 5, 105))?.cae,
    ).toBe('76412345678901')
    const none = router({ FECompConsultar: ARCA_XML.wsfeCompConsultar602 })
    expect(
      await createWsfe(none.transport, 'produccion', getAuth).compConsultar(6, 5, 105),
    ).toBeNull()
    const err = router({
      FECompConsultar: () => ({
        status: 200,
        body: arcaXml(ARCA_XML.wsfeCompConsultar602).replace(
          '<Code>602</Code>',
          '<Code>600</Code>',
        ),
      }),
    })
    await expect(
      createWsfe(err.transport, 'produccion', getAuth).compConsultar(6, 5, 105),
    ).rejects.toMatchObject({ kind: 'service', code: '600' })
  })

  it('ptosVenta: [] con «Sin Resultados» (homologación)', async () => {
    const none = router({ FEParamGetPtosVenta: ARCA_XML.wsfePtosVenta602 })
    expect(await createWsfe(none.transport, 'homologacion', getAuth).ptosVenta()).toEqual([])
    const some = router({ FEParamGetPtosVenta: ARCA_XML.wsfePtosVenta })
    expect(await createWsfe(some.transport, 'produccion', getAuth).ptosVenta()).toHaveLength(5)
  })

  it('condiciones de IVA y tablas de parámetros', async () => {
    const { transport } = router({
      FEParamGetCondicionIvaReceptor: ARCA_XML.wsfeCondicionIvaReceptor,
      FEParamGetTiposIva: ARCA_XML.wsfeTiposIva,
    })
    const wsfe = createWsfe(transport, 'homologacion', getAuth)
    expect(await wsfe.condicionesIvaReceptor('B')).toHaveLength(11)
    expect(await wsfe.paramList('FEParamGetTiposIva')).toHaveLength(6)
  })
})

// ─── vouchers.ts ─────────────────────────────────────────────────────────────

describe('comprobantes y tablas (vouchers.ts)', () => {
  it('tipos de comprobante de la v1 y su ida y vuelta', () => {
    expect(CBTE_TIPOS).toEqual([1, 2, 3, 6, 7, 8])
    for (const tipo of CBTE_TIPOS) {
      const type = voucherTypeForCbte(tipo)
      expect(CBTE_TIPO[type]).toBe(tipo)
      expect(cbteForVoucherType(type)).toBe(tipo)
    }
    expect(cbteForVoucherType('factura_c')).toBeNull()
    expect(cbteForVoucherType('tique_factura_b')).toBeNull()
    expect([1, 2, 3, 6, 7, 8].map((t) => letterForCbte(t as 1))).toEqual([
      'A',
      'A',
      'A',
      'B',
      'B',
      'B',
    ])
    expect(CBTE_TIPOS.filter(isNoteCbte)).toEqual([2, 3, 7, 8])
    expect(associableCbteTipos(8)).toContain(6)
    expect(associableCbteTipos(8)).not.toContain(1)
    expect(associableCbteTipos(3)).toContain(1)
    expect(associableCbteTipos(6)).toEqual([])
  })

  it('condición del receptor: 11 de la RG 5616, A para 1, 6, 13 y 16', () => {
    expect(CONDICION_IVA_RECEPTOR.map((c) => c.id)).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16])
    expect(
      CONDICION_IVA_RECEPTOR.filter((c) => letterForCondicion(c.id) === 'A').map((c) => c.id),
    ).toEqual([1, 6, 13, 16])
    expect(letterForCondicion(2)).toBeNull()
    expect(isCondicionValidForLetter(6, 'A')).toBe(true) // RG 5003: al monotributista, A
    expect(isCondicionValidForLetter(6, 'B')).toBe(false)
    expect(isCondicionValidForLetter(5, 'B')).toBe(true)
    expect(condicionFromIvaCondition('responsable_inscripto')).toBe(1)
    expect(condicionFromIvaCondition('monotributo')).toBe(6)
    expect(condicionFromIvaCondition('exento')).toBe(4)
    expect(condicionFromIvaCondition('consumidor_final')).toBe(5)
    expect(condicionFromIvaCondition('no_alcanzado')).toBe(15)
    expect(condicionFromIvaCondition('sin_datos')).toBeNull()
  })

  it('documento del receptor', () => {
    expect(docTipoFor('cuit')).toBe(80)
    expect(docTipoFor('cuil')).toBe(86)
    expect(docTipoFor('dni')).toBe(96)
    expect(docTipoFor('none')).toBe(99)
    expect(docNroFor(80, '30-71234567-1')).toBe('30712345671')
    expect(docNroFor(80, '30-71234567-2')).toBeNull()
    expect(docNroFor(96, '12.345.678')).toBe('12345678')
    expect(docNroFor(96, '0')).toBeNull()
    expect(docNroFor(99, 'lo que sea')).toBe('0')
    expect(FINAL_CONSUMER_ID_THRESHOLD_CENTS).toBe(10_000_000 * 100)
  })

  it('QR: reproduce el ejemplo de la especificación de ARCA byte a byte', () => {
    const spec = {
      fecha: '2020-10-13',
      cuit: '30000000007',
      ptoVta: 10,
      tipoCmp: 1,
      nroCmp: 94,
      importeCents: 1_210_000,
      moneda: 'DOL',
      ctz: '65',
      docTipo: 80,
      docNro: '20000000001',
      codAut: '70417054367476',
    }
    expect(qrJson(spec)).toBe(
      '{"ver":1,"fecha":"2020-10-13","cuit":30000000007,"ptoVta":10,"tipoCmp":1,"nroCmp":94,"importe":12100,' +
        '"moneda":"DOL","ctz":65,"tipoDocRec":80,"nroDocRec":20000000001,"tipoCodAut":"E","codAut":70417054367476}',
    )
    expect(qrPayload(spec)).toBe(
      'eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIsImN1aXQiOjMwMDAwMDAwMDA3LCJwdG9WdGEiOjEwLCJ0aXBvQ21wIjoxLCJucm9DbXAiOjk0LCJpbXBvcnRlIjoxMjEwMCwibW9uZWRhIjoiRE9MIiwiY3R6Ijo2NSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6MjAwMDAwMDAwMDEsInRpcG9Db2RBdXQiOiJFIiwiY29kQXV0Ijo3MDQxNzA1NDM2NzQ3Nn0=',
    )
    expect(qrUrl(spec, 'https://www.afip.gob.ar/fe/qr/')).toBe(
      `https://www.afip.gob.ar/fe/qr/?p=${qrPayload(spec)}`,
    )
  })

  it('QR de una Factura B a consumidor final: pesos, sin documento y con centavos', () => {
    const json = qrJson({
      fecha: '2026-10-08',
      cuit: XML_CUITS.sas,
      ptoVta: 5,
      tipoCmp: 6,
      nroCmp: 105,
      importeCents: 12_150,
      docTipo: 99,
      docNro: '0',
      codAut: '76412345678901',
    })
    expect(json).toBe(
      '{"ver":1,"fecha":"2026-10-08","cuit":30712345671,"ptoVta":5,"tipoCmp":6,"nroCmp":105,"importe":121.5,' +
        '"moneda":"PES","ctz":1,"tipoCodAut":"E","codAut":76412345678901}',
    )
    expect(JSON.parse(json).importe).toBe(121.5)
    const url = qrUrl({
      fecha: '2026-10-08',
      cuit: XML_CUITS.sas,
      ptoVta: 5,
      tipoCmp: 6,
      nroCmp: 1,
      importeCents: 5,
      codAut: '76412345678901',
    })
    expect(url.startsWith(`${ARCA_QR_BASE_URL}?p=`)).toBe(true)
    expect(ARCA_QR_BASE_URL).toBe('https://www.arca.gob.ar/fe/qr/')
    expect(() =>
      qrJson({
        fecha: '2026-02-30',
        cuit: XML_CUITS.sas,
        ptoVta: 5,
        tipoCmp: 6,
        nroCmp: 1,
        importeCents: 1,
        codAut: '76412345678901',
      }),
    ).toThrow()
    expect(() =>
      qrJson({
        fecha: '2026-10-08',
        cuit: '123',
        ptoVta: 5,
        tipoCmp: 6,
        nroCmp: 1,
        importeCents: 1,
        codAut: '76412345678901',
      }),
    ).toThrow()
    expect(() =>
      qrJson({
        fecha: '2026-10-08',
        cuit: XML_CUITS.sas,
        ptoVta: 5,
        tipoCmp: 6,
        nroCmp: 1,
        importeCents: 1,
        codAut: '1',
      }),
    ).toThrow()
  })
})
