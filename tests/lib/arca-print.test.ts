/**
 * La factura impresa (diseño §3.2.6): el QR de ARCA (RG 4892, especificación v1:
 * `{base}?p={JSON en base64}`), las leyendas obligatorias (Ley 27.743 a un
 * consumidor final; Ley 27.618 en una A a un monotributista) y lo que se lee de
 * vuelta del pedido guardado (`acc_arca_vouchers.request`).
 */

import { describe, expect, it } from 'vitest'
import {
  ARCA_DISCLAIMER,
  invoiceLegends,
  invoicePrintModel,
  invoiceQr,
  invoiceQrData,
  MONOTRIBUTO_A_LEGEND,
  readCaeRecord,
  TRANSPARENCY_TITLE,
} from '@/lib/arca/print'
import { ARCA_QR_BASE_URL } from '@/lib/arca/vouchers'
import { type CaeRequest, caeRequestRecord } from '@/lib/arca/wsfe'

const SAS = '30712345671'
const CLIENT_RI = '30711111111'
const CAE = '76412345678901'

function bRequest(over: Partial<CaeRequest> = {}): CaeRequest {
  return {
    ptoVta: 5,
    cbteTipo: 6,
    number: 104,
    concepto: 1,
    docTipo: 99,
    docNro: '0',
    cbteFch: '2026-10-08',
    amounts: {
      totalCents: 1_210_000,
      nonTaxedCents: 0,
      netCents: 1_000_000,
      exemptCents: 0,
      tributesCents: 0,
      vatCents: 210_000,
      unsupportedCents: 0,
      iva: [{ id: 5, rateBp: 2100, baseCents: 1_000_000, vatCents: 210_000 }],
    },
    condicionIvaReceptorId: 5,
    ...over,
  }
}

function aRequest(over: Partial<CaeRequest> = {}): CaeRequest {
  return bRequest({
    cbteTipo: 1,
    docTipo: 80,
    docNro: CLIENT_RI,
    condicionIvaReceptorId: 1,
    ...over,
  })
}

/** El JSON que lleva el QR (decodificando el `p` de la URL). */
function decodedQr(url: string): unknown {
  const p = new URL(url).searchParams.get('p') ?? ''
  return JSON.parse(Buffer.from(p, 'base64').toString('utf8'))
}

describe('pedido guardado', () => {
  it('se lee de vuelta igual a lo que se mandó (centavos y fechas ISO)', () => {
    for (const req of [
      bRequest(),
      aRequest(),
      bRequest({
        concepto: 2,
        serviceFrom: '2026-10-01',
        serviceTo: '2026-10-07',
        paymentDue: '2026-10-20',
      }),
      bRequest({
        cbteTipo: 8,
        number: 7,
        associated: [{ cbteTipo: 6, ptoVta: 5, number: 104, cuit: SAS, cbteFch: '2026-10-08' }],
      }),
    ]) {
      // Como queda en la base (jsonb): sin `undefined`.
      const stored = JSON.parse(JSON.stringify(caeRequestRecord(req)))
      const read = readCaeRecord(stored)
      expect(read).toEqual({
        serviceFrom: null,
        serviceTo: null,
        paymentDue: null,
        associated: [],
        ...req,
      })
    }
  })

  it('lo que no tiene la forma del pedido no se lee', () => {
    expect(readCaeRecord(null)).toBeNull()
    expect(readCaeRecord({})).toBeNull()
    expect(readCaeRecord({ FeCabReq: { PtoVta: '5', CbteTipo: '6' }, FeDetReq: {} })).toBeNull()
    expect(
      readCaeRecord({
        FeCabReq: { PtoVta: '5', CbteTipo: '51' },
        FeDetReq: { FECAEDetRequest: [{ CbteDesde: '1' }] },
      }),
    ).toBeNull()
  })
})

describe('QR (RG 4892)', () => {
  it('Factura B a consumidor final: sin documento del receptor', () => {
    const qr = invoiceQr(invoiceQrData({ issuerCuit: SAS, request: bRequest(), cae: CAE }))
    expect(qr.url.startsWith(`${ARCA_QR_BASE_URL}?p=`)).toBe(true)
    expect(qr.json).toBe(
      `{"ver":1,"fecha":"2026-10-08","cuit":${SAS},"ptoVta":5,"tipoCmp":6,"nroCmp":104,"importe":12100,"moneda":"PES","ctz":1,"tipoCodAut":"E","codAut":${CAE}}`,
    )
    expect(decodedQr(qr.url)).toEqual({
      ver: 1,
      fecha: '2026-10-08',
      cuit: Number(SAS),
      ptoVta: 5,
      tipoCmp: 6,
      nroCmp: 104,
      importe: 12100,
      moneda: 'PES',
      ctz: 1,
      tipoCodAut: 'E',
      codAut: Number(CAE),
    })
  })

  it('Factura A: con el documento del receptor y centavos en el importe', () => {
    const req = aRequest({
      amounts: { ...aRequest().amounts, totalCents: 1_210_050, netCents: 1_000_050 },
    })
    const qr = invoiceQr(invoiceQrData({ issuerCuit: '30-71234567-1', request: req, cae: CAE }))
    const json = decodedQr(qr.url) as Record<string, unknown>
    expect(json).toMatchObject({
      cuit: Number(SAS),
      tipoCmp: 1,
      importe: 12100.5,
      tipoDocRec: 80,
      nroDocRec: Number(CLIENT_RI),
    })
    // El orden de las claves es el de la especificación.
    expect(Object.keys(json)).toEqual([
      'ver',
      'fecha',
      'cuit',
      'ptoVta',
      'tipoCmp',
      'nroCmp',
      'importe',
      'moneda',
      'ctz',
      'tipoDocRec',
      'nroDocRec',
      'tipoCodAut',
      'codAut',
    ])
  })

  it('la base del QR se puede cambiar en un solo lugar (P-T11)', () => {
    const data = invoiceQrData({ issuerCuit: SAS, request: bRequest(), cae: CAE })
    expect(invoiceQr(data, 'https://www.afip.gob.ar/fe/qr/').url).toMatch(
      /^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=/,
    )
  })
})

describe('leyendas', () => {
  it('a un consumidor final: Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', () => {
    const legends = invoiceLegends({ cbteTipo: 6, condicionIvaReceptorId: 5, vatCents: 210_000 })
    expect(legends.transparency).toEqual({
      title: TRANSPARENCY_TITLE,
      vatText: 'IVA Contenido: $\u00a02.100,00',
      otherTaxesText: 'Otros Impuestos Nacionales Indirectos: $\u00a00,00',
    })
    expect(TRANSPARENCY_TITLE).toContain('Ley 27.743')
    expect(legends.lines).toEqual([])
  })

  it('Factura A a un monotributista (6, 13 y 16): la leyenda de la Ley 27.618', () => {
    for (const condicion of [6, 13, 16]) {
      const legends = invoiceLegends({
        cbteTipo: 1,
        condicionIvaReceptorId: condicion,
        vatCents: 1,
      })
      expect(legends.lines).toEqual([MONOTRIBUTO_A_LEGEND])
      expect(legends.transparency).toBeNull()
    }
    expect(MONOTRIBUTO_A_LEGEND).toContain('Ley Nº 27.618')
  })

  it('A a un inscripto o B a un exento: ninguna de las dos', () => {
    expect(invoiceLegends({ cbteTipo: 1, condicionIvaReceptorId: 1, vatCents: 1 })).toEqual({
      transparency: null,
      lines: [],
    })
    expect(invoiceLegends({ cbteTipo: 6, condicionIvaReceptorId: 4, vatCents: 1 })).toEqual({
      transparency: null,
      lines: [],
    })
  })
})

const ISSUER = {
  legalName: 'Bar de Prueba SAS',
  tradeName: 'El Bar',
  cuit: SAS,
  ivaCondition: 'responsable_inscripto',
  iibbNumber: '280-123456-7',
  activityStartDate: '2024-03-01',
  address: 'Av. Siempre Viva 123, Córdoba',
}

describe('la factura entera', () => {
  it('B a consumidor final: solo el total, con el IVA contenido abajo', () => {
    const model = invoicePrintModel({
      environment: 'produccion',
      issuer: ISSUER,
      request: bRequest(),
      cae: CAE,
      caeDue: '2026-10-18',
      receiver: { name: null, address: null },
      detail: 'Catering para 40 personas, evento del 12/10',
    })
    expect(model).toMatchObject({
      testData: false,
      letter: 'B',
      codeText: 'Cód. 006',
      title: 'FACTURA',
      copy: 'ORIGINAL',
      pointOfSaleText: '00005',
      numberText: '00000104',
      issueDateText: '08/10/2026',
      totalText: '$\u00a012.100,00',
      caeText: CAE,
      caeDueText: '18/10/2026',
      documentLabel: 'Factura B 00005-00000104',
    })
    expect(model.issuer.name).toBe('El Bar')
    expect(model.issuer.legalName).toBe('Bar de Prueba SAS')
    expect(model.issuer.lines).toEqual([
      'Domicilio comercial: Av. Siempre Viva 123, Córdoba',
      'Condición frente al IVA: IVA Responsable Inscripto',
      'CUIT: 30-71234567-1',
      'Ingresos Brutos: 280-123456-7',
      'Inicio de actividades: 01/03/2024',
    ])
    expect(model.receiver).toEqual({
      name: 'Consumidor final',
      docText: 'Sin identificar',
      conditionText: 'Consumidor Final',
      addressText: null,
    })
    expect(model.item).toEqual({
      description: 'Catering para 40 personas, evento del 12/10',
      amount: '$\u00a012.100,00',
    })
    expect(model.amountRows).toEqual([])
    expect(model.legends.transparency?.vatText).toBe('IVA Contenido: $\u00a02.100,00')
    expect(model.qrUrl.startsWith(ARCA_QR_BASE_URL)).toBe(true)
    expect(ARCA_DISCLAIMER).toContain('ARCA')
  })

  it('A: neto e IVA por alícuota, el detalle sin IVA y la CUIT del cliente', () => {
    const req = aRequest({
      amounts: {
        totalCents: 1_218_000,
        nonTaxedCents: 0,
        netCents: 1_000_000,
        exemptCents: 50_000,
        tributesCents: 0,
        vatCents: 168_000,
        unsupportedCents: 0,
        iva: [
          { id: 4, rateBp: 1050, baseCents: 400_000, vatCents: 42_000 },
          { id: 5, rateBp: 2100, baseCents: 600_000, vatCents: 126_000 },
        ],
      },
    })
    const model = invoicePrintModel({
      environment: 'produccion',
      issuer: { ...ISSUER, tradeName: 'Bar de Prueba SAS' },
      request: req,
      cae: CAE,
      caeDue: '2026-10-18',
      receiver: { name: 'Distribuidora Ejemplo SA', address: 'Calle 1' },
      detail: 'Servicio de catering',
    })
    expect(model.letter).toBe('A')
    expect(model.codeText).toBe('Cód. 001')
    expect(model.issuer.legalName).toBeNull() // el nombre del bar es la razón social
    expect(model.receiver).toMatchObject({
      name: 'Distribuidora Ejemplo SA',
      docText: 'CUIT 30-71111111-1',
      conditionText: 'IVA Responsable Inscripto',
      addressText: 'Calle 1',
    })
    expect(model.item.amount).toBe('$\u00a010.500,00') // neto 10.000 + exento 500, sin IVA
    expect(model.amountRows).toEqual([
      { label: 'Neto gravado 10,5\u00a0%', amount: '$\u00a04.000,00' },
      { label: 'Neto gravado 21\u00a0%', amount: '$\u00a06.000,00' },
      { label: 'IVA 10,5\u00a0%', amount: '$\u00a0420,00' },
      { label: 'IVA 21\u00a0%', amount: '$\u00a01.260,00' },
      { label: 'Exento', amount: '$\u00a0500,00' },
    ])
    expect(model.totalText).toBe('$\u00a012.180,00')
    expect(model.legends.transparency).toBeNull()
  })

  it('nota de crédito de prueba: dice a qué factura corresponde y que no vale', () => {
    const model = invoicePrintModel({
      environment: 'homologacion',
      issuer: ISSUER,
      request: bRequest({
        cbteTipo: 8,
        number: 3,
        associated: [{ cbteTipo: 6, ptoVta: 5, number: 104, cuit: SAS, cbteFch: '2026-10-08' }],
      }),
      cae: CAE,
      caeDue: '2026-10-18',
      receiver: { name: null, address: null },
      detail: '',
    })
    expect(model.testData).toBe(true)
    expect(model.title).toBe('NOTA DE CRÉDITO')
    expect(model.associatedText).toBe('Corresponde a: Factura B 00005-00000104 del 08/10/2026')
    expect(model.item.description).toBe('Nota de crédito B')
  })

  it('servicios: el período y el vencimiento del pago', () => {
    const model = invoicePrintModel({
      environment: 'produccion',
      issuer: ISSUER,
      request: bRequest({
        concepto: 2,
        serviceFrom: '2026-10-01',
        serviceTo: '2026-10-07',
        paymentDue: '2026-10-20',
      }),
      cae: CAE,
      caeDue: '2026-10-18',
      receiver: { name: null, address: null },
      detail: 'Alquiler del salón',
    })
    expect(model.conceptText).toBe('Servicios')
    expect(model.serviceText).toBe('Período facturado: del 01/10/2026 al 07/10/2026')
    expect(model.paymentDueText).toBe('Vencimiento del pago: 20/10/2026')
  })
})
