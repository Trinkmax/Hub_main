import { describe, expect, it } from 'vitest'
import { ARCA_ENDPOINTS } from '@/lib/arca/endpoints'
import { classifyArcaError, describeArcaError } from '@/lib/arca/errors'
import {
  condicionFromPersona,
  createPadron,
  getPersonaListV2Body,
  getPersonaV2Body,
  PADRON_LIST_MAX,
  type PadronLookup,
  type PadronPersona,
  type PadronTax,
  padronCacheRow,
  padronDummyBody,
  parsePadronDummy,
  parsePersona,
  parsePersonaList,
} from '@/lib/arca/padron'
import { ArcaFault, ArcaRequestError, type ArcaTransport } from '@/lib/arca/soap'
import { nodeAt, parseXml } from '@/lib/xml/mini'
import { ARCA_XML, arcaXml, XML_CUITS } from '@/tests/fixtures/arca/xml/fixtures'

function persona(lookup: PadronLookup): PadronPersona {
  if (!lookup.found) throw new Error(`no encontrada: ${lookup.message}`)
  return lookup.persona
}

describe('pedidos', () => {
  it('getPersona_v2: el método con prefijo y los parámetros sin prefijo', () => {
    const call = getPersonaV2Body('TOKEN+/=', 'SIGN&', '30-71234567-1', XML_CUITS.monotributista)
    expect(call.soapAction).toBe('')
    expect(call.body).toBe(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">' +
        '<soapenv:Header/><soapenv:Body><a5:getPersona_v2>' +
        '<token>TOKEN+/=</token><sign>SIGN&amp;</sign><cuitRepresentada>30712345671</cuitRepresentada>' +
        '<idPersona>27123456780</idPersona></a5:getPersona_v2></soapenv:Body></soapenv:Envelope>',
    )
  })

  it('getPersonaList_v2: sin repetidas, en orden y hasta 250', () => {
    const call = getPersonaListV2Body('T', 'S', XML_CUITS.sas, [
      XML_CUITS.monotributista,
      XML_CUITS.exento,
      '27-12345678-0',
    ])
    const ids = (nodeAt(parseXml(call.body), 'Body/getPersonaList_v2')?.children ?? [])
      .filter((c) => c.name === 'idPersona')
      .map((c) => c.text)
    expect(ids).toEqual([XML_CUITS.monotributista, XML_CUITS.exento])
    expect(() => getPersonaListV2Body('T', 'S', XML_CUITS.sas, [])).toThrow(ArcaRequestError)
    const many = Array.from({ length: 300 }, (_, i) => {
      // CUIT válidas distintas: 20-1xxxxxxx-dv
      const ten = `201${String(i).padStart(7, '0')}`
      const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
      const sum = [...ten].reduce((acc, d, k) => acc + Number(d) * (w[k] ?? 0), 0)
      const dv = 11 - (sum % 11)
      return dv === 10 ? null : `${ten}${dv === 11 ? 0 : dv}`
    })
      .filter((c): c is string => c !== null)
      .slice(0, PADRON_LIST_MAX + 1)
    expect(many).toHaveLength(PADRON_LIST_MAX + 1)
    expect(() =>
      getPersonaListV2Body('T', 'S', XML_CUITS.sas, many.slice(0, PADRON_LIST_MAX)),
    ).not.toThrow()
    expect(() => getPersonaListV2Body('T', 'S', XML_CUITS.sas, many)).toThrow(ArcaRequestError)
  })

  it('rechaza CUIT inválidas y el ticket vacío', () => {
    expect(() => getPersonaV2Body('T', 'S', XML_CUITS.sas, '20123456787')).toThrow(ArcaRequestError)
    expect(() => getPersonaV2Body('T', 'S', '123', XML_CUITS.sas)).toThrow(ArcaRequestError)
    expect(() => getPersonaV2Body(' ', 'S', XML_CUITS.sas, XML_CUITS.sas)).toThrow(ArcaRequestError)
  })

  it('dummy, sin autenticación', () => {
    expect(padronDummyBody().body).toContain('<a5:dummy/>')
  })
})

describe('parsePersona', () => {
  it('SAS responsable inscripta', () => {
    const p = persona(parsePersona(arcaXml(ARCA_XML.padronPersonaRi)))
    expect(p).toMatchObject({
      cuit: XML_CUITS.sas,
      personKind: 'juridica',
      name: 'BAR DE PRUEBA SAS',
      razonSocial: 'BAR DE PRUEBA SAS',
      estadoClave: 'ACTIVO',
      active: true,
      esSucesion: false,
      address: {
        direccion: 'AV COLON 1234 PISO 1',
        localidad: 'CORDOBA',
        codPostal: '5000',
        provincia: 'CORDOBA',
        idProvincia: 3,
        datoAdicional: null,
      },
      // La principal es la de orden 1, aunque venga segunda.
      mainActivity: { code: '561014', description: 'SERVICIOS DE EXPENDIO DE BEBIDAS EN BARES' },
      monotributo: null,
      notices: [],
    })
    expect(p.taxes.map((t) => [t.id, t.state])).toEqual([
      [10, 'AC'],
      [30, 'AC'],
      [301, 'AC'],
    ])
    expect(condicionFromPersona(p)).toEqual({
      ivaCondition: 'responsable_inscripto',
      condicionIvaReceptorId: 1,
      needsReview: false,
      reason: 'responsable_inscripto',
    })
  })

  it('monotributista (persona humana)', () => {
    const p = persona(parsePersona(arcaXml(ARCA_XML.padronPersonaMonotributo)))
    expect(p).toMatchObject({
      cuit: XML_CUITS.monotributista,
      personKind: 'fisica',
      name: 'PRUEBA ANA SINTETICA',
      apellido: 'PRUEBA',
      nombre: 'ANA SINTETICA',
      monotributo: { categoryId: '36', category: 'B LOCACIONES DE SERVICIO', taxId: 20 },
      mainActivity: { code: '8', description: 'PREST. DE SERVICIO O LOCACION' },
    })
    expect(condicionFromPersona(p)).toMatchObject({
      ivaCondition: 'monotributo',
      condicionIvaReceptorId: 6,
      needsReview: false,
    })
  })

  it('IVA exento', () => {
    const p = persona(parsePersona(arcaXml(ARCA_XML.padronPersonaExento)))
    expect(condicionFromPersona(p)).toMatchObject({
      ivaCondition: 'exento',
      condicionIvaReceptorId: 4,
    })
  })

  it('sin datos impositivos: los avisos de ARCA y consumidor final para revisar', () => {
    const p = persona(parsePersona(arcaXml(ARCA_XML.padronPersonaSinDatos)))
    expect(p.taxes).toEqual([])
    expect(p.notices).toEqual([
      'El contribuyente no posee impuestos activos en el Regimen General',
      'No cumple con las condiciones para enviar datos del regimen general',
    ])
    expect(condicionFromPersona(p)).toEqual({
      ivaCondition: 'consumidor_final',
      condicionIvaReceptorId: 5,
      needsReview: true,
      reason: 'sin_datos',
    })
  })

  it('«No existe persona con ese Id»', () => {
    expect(parsePersona(arcaXml(ARCA_XML.padronPersonaNoExiste))).toEqual({
      found: false,
      cuit: XML_CUITS.noExiste,
      reason: 'not_found',
      message: 'No existe persona con ese Id',
    })
  })

  it('getPersonaList_v2: una por persona, en orden', () => {
    const list = parsePersonaList(arcaXml(ARCA_XML.padronPersonaLista))
    expect(list.map((l) => (l.found ? l.persona.cuit : `x${l.cuit}`))).toEqual([
      XML_CUITS.sas,
      XML_CUITS.monotributista,
      `x${XML_CUITS.noExiste}`,
    ])
  })

  it('el Fault real «Token malformado» → permiso rechazado', () => {
    let fault: unknown = null
    try {
      parsePersona(arcaXml(ARCA_XML.padronFaultToken))
    } catch (e) {
      fault = e
    }
    expect(fault).toBeInstanceOf(ArcaFault)
    expect(fault).toMatchObject({
      kind: 'fault',
      code: 'Server',
      detail: 'Token malformado',
      service: 'padron',
    })
    expect(classifyArcaError(fault)).toBe('arca_token_rejected')
  })

  it('dummy real de producción', () => {
    expect(parsePadronDummy(arcaXml(ARCA_XML.padronDummyProduccion))).toEqual({
      appServer: 'OK',
      authServer: 'OK',
      dbServer: 'OK',
      ok: true,
    })
  })
})

describe('condicionFromPersona (precedencia de pyafipws)', () => {
  const base: PadronPersona = {
    cuit: XML_CUITS.monotributista,
    personKind: 'fisica',
    name: 'X',
    razonSocial: null,
    apellido: 'X',
    nombre: null,
    estadoClave: 'ACTIVO',
    active: true,
    esSucesion: false,
    address: null,
    taxes: [],
    activities: [],
    mainActivity: null,
    monotributo: null,
    notices: [],
  }
  const tax = (
    id: number,
    state: string | null = 'AC',
    source: PadronTax['source'] = 'general',
  ) => ({
    id,
    description: null,
    state,
    period: null,
    source,
  })
  const cases: Array<[string, Partial<PadronPersona>, string, number | null, boolean]> = [
    ['32 IVA exento', { taxes: [tax(32)] }, 'exento', 4, false],
    ['32 gana sobre 30', { taxes: [tax(30), tax(32)] }, 'exento', 4, false],
    ['30 en estado EX', { taxes: [tax(30, 'EX')] }, 'exento', 4, false],
    ['33 no inscripto (legado)', { taxes: [tax(33)] }, 'sin_datos', null, true],
    ['34 IVA no alcanzado', { taxes: [tax(34)] }, 'no_alcanzado', 15, false],
    ['30 en estado NA', { taxes: [tax(30, 'NA')] }, 'no_alcanzado', 15, false],
    ['30 activo', { taxes: [tax(30)] }, 'responsable_inscripto', 1, false],
    [
      '30 sin estado cuenta como activo',
      { taxes: [tax(30, null)] },
      'responsable_inscripto',
      1,
      false,
    ],
    [
      '30 dado de baja y monotributo activo',
      { taxes: [tax(30, 'BD'), tax(20, 'AC', 'monotributo')] },
      'monotributo',
      6,
      false,
    ],
    ['monotributo 21', { taxes: [tax(21, 'AC', 'monotributo')] }, 'monotributo', 6, false],
    [
      'monotributo social',
      { monotributo: { categoryId: '99', category: 'B MONOTRIBUTO SOCIAL LOCACION', taxId: 20 } },
      'monotributo',
      13,
      true,
    ],
    [
      'trabajador independiente promovido',
      {
        monotributo: { categoryId: '1', category: 'TRABAJADOR INDEPENDIENTE PROMOVIDO', taxId: 20 },
      },
      'monotributo',
      16,
      true,
    ],
    [
      'monotributo dado de baja no cuenta',
      { taxes: [tax(20, 'BD', 'monotributo')] },
      'consumidor_final',
      5,
      true,
    ],
    ['nada, persona humana', {}, 'consumidor_final', 5, true],
    ['nada, persona jurídica', { personKind: 'juridica' }, 'sin_datos', null, true],
  ]
  for (const [name, patch, iva, id, review] of cases) {
    it(name, () => {
      const r = condicionFromPersona({ ...base, ...patch })
      expect([r.ivaCondition, r.condicionIvaReceptorId, r.needsReview]).toEqual([iva, id, review])
    })
  }
})

describe('padronCacheRow', () => {
  it('arma la fila de la caché (≤ 4 KB) con los nombres de la base', () => {
    const lookup = parsePersona(arcaXml(ARCA_XML.padronPersonaRi))
    const row = padronCacheRow(lookup, '30-71234567-1')
    expect(row).toEqual({
      cuit: XML_CUITS.sas,
      found: true,
      data: {
        name: 'BAR DE PRUEBA SAS',
        person_kind: 'juridica',
        active: true,
        iva_condition: 'responsable_inscripto',
        condicion_iva_receptor_id: 1,
        needs_review: false,
        monotributo_category: null,
        address: 'AV COLON 1234 PISO 1',
        locality: 'CORDOBA',
        province: 'CORDOBA',
        activity: { code: '561014', description: 'SERVICIOS DE EXPENDIO DE BEBIDAS EN BARES' },
      },
    })
    expect(Buffer.byteLength(JSON.stringify(row.data))).toBeLessThan(4096)
    expect(
      padronCacheRow(parsePersona(arcaXml(ARCA_XML.padronPersonaNoExiste)), XML_CUITS.noExiste),
    ).toEqual({
      cuit: XML_CUITS.noExiste,
      found: false,
      data: { reason: 'not_found', message: 'No existe persona con ese Id' },
    })
  })
})

describe('createPadron', () => {
  const getAuth = async () => ({ token: 'T', sign: 'S', cuit: XML_CUITS.sas })

  it('consulta el padrón del ambiente con SOAPAction vacío', async () => {
    const calls: { url: string; headers: Readonly<Record<string, string>> }[] = []
    const transport: ArcaTransport = async (req) => {
      calls.push(req)
      return { status: 200, body: arcaXml(ARCA_XML.padronPersonaRi) }
    }
    const padron = createPadron(transport, 'produccion', getAuth)
    expect(persona(await padron.getPersona(XML_CUITS.sas)).name).toBe('BAR DE PRUEBA SAS')
    expect(calls[0]?.url).toBe(ARCA_ENDPOINTS.produccion.padronA5)
    expect(calls[0]?.headers.SOAPAction).toBe('""')
  })

  it('«No existe persona» como Fault también es «no encontrada»', async () => {
    const transport: ArcaTransport = async () => ({
      status: 500,
      body: arcaXml(ARCA_XML.padronFaultToken).replace(
        'Token malformado',
        'No existe persona con ese Id',
      ),
    })
    expect(
      await createPadron(transport, 'homologacion', getAuth).getPersona(XML_CUITS.noExiste),
    ).toEqual({
      found: false,
      cuit: XML_CUITS.noExiste,
      reason: 'not_found',
      message: 'No existe persona con ese Id',
    })
  })

  it('se reintenta una vez ante un error de red; el token malo no', async () => {
    let n = 0
    const flaky: ArcaTransport = async () => {
      n++
      if (n === 1) throw new ArcaFault('network', 'ECONNRESET')
      return { status: 200, body: arcaXml(ARCA_XML.padronPersonaMonotributo) }
    }
    expect(
      (await createPadron(flaky, 'homologacion', getAuth).getPersona(XML_CUITS.monotributista))
        .found,
    ).toBe(true)
    expect(n).toBe(2)

    let m = 0
    const badToken: ArcaTransport = async () => {
      m++
      return { status: 500, body: arcaXml(ARCA_XML.padronFaultToken) }
    }
    const fault = await createPadron(badToken, 'homologacion', getAuth)
      .getPersona(XML_CUITS.monotributista)
      .catch((e: unknown) => e)
    expect(m).toBe(1)
    expect(describeArcaError(fault).key).toBe('arca_token_rejected')
  })

  it('la lista y el dummy', async () => {
    const transport: ArcaTransport = async (req) => ({
      status: 200,
      body: arcaXml(
        req.body.includes('getPersonaList_v2')
          ? ARCA_XML.padronPersonaLista
          : ARCA_XML.padronDummyProduccion,
      ),
    })
    const padron = createPadron(transport, 'produccion', getAuth)
    expect(
      await padron.getPersonaList([XML_CUITS.sas, XML_CUITS.monotributista, XML_CUITS.noExiste]),
    ).toHaveLength(3)
    expect((await padron.dummy()).ok).toBe(true)
  })
})
