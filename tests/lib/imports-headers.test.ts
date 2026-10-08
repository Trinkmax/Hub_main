import { describe, expect, it } from 'vitest'
import {
  classifyHeader,
  findHeaderRow,
  headerSignature,
  isMcHeader,
  MC_HEADER_RULES,
  type McColumn,
  normalizeHeader,
} from '@/lib/imports/headers'
import {
  G2_EMITIDOS_TITLES,
  G2_RECIBIDOS_TITLES,
  G3_RECIBIDOS_TITLES,
  G3_RECIBIDOS_TITLES_DEL_EMISOR,
  PORTAL_IVA_TITLES,
} from '@/tests/fixtures/imports/synth'

const classify = (titles: readonly string[]) =>
  titles.map((t) => classifyHeader(t, MC_HEADER_RULES))

describe('normalizeHeader (§9.2)', () => {
  it('los ejemplos de la investigación', () => {
    expect(normalizeHeader('Cód. Autorización')).toBe('cod autorizacion')
    expect(normalizeHeader('Imp. Neto Gravado IVA 10,5%')).toBe('imp neto gravado iva 10.5%')
    expect(normalizeHeader('Neto Grav. IVA 10,5%')).toBe('neto grav iva 10.5%')
    expect(normalizeHeader('Denominación del Emisor')).toBe('denominacion emisor')
  })

  it('más variantes: N°, guion bajo, barras, espacios duros y vacíos', () => {
    expect(normalizeHeader('N° Doc. Emisor')).toBe('n doc emisor')
    expect(normalizeHeader('NET_CREDIT_AMOUNT')).toBe('net credit amount')
    expect(normalizeHeader('D/C')).toBe('d/c')
    expect(normalizeHeader('Débito ($)')).toBe('debito')
    expect(normalizeHeader('Fecha de Emisión')).toBe('fecha emision')
    expect(normalizeHeader('Neto Grav. IVA 10.5 %')).toBe('neto grav iva 10.5 %')
    expect(normalizeHeader('...Total..')).toBe('total')
    expect(normalizeHeader(null)).toBe('')
    expect(normalizeHeader(21)).toBe('21')
  })
})

describe('reglas de Mis Comprobantes (§9.3): cubren el 100 % de los títulos', () => {
  const G3_KEYS: McColumn[] = [
    'fecha',
    'tipo',
    'pto_vta',
    'nro_desde',
    'nro_hasta',
    'cod_aut',
    'tipo_doc_emisor',
    'nro_doc_emisor',
    'denom_emisor',
    'tipo_doc_receptor',
    'nro_doc_receptor',
    'tipo_cambio',
    'moneda',
    'neto_0',
    'iva_2_5',
    'neto_2_5',
    'iva_5',
    'neto_5',
    'iva_10_5',
    'neto_10_5',
    'iva_21',
    'neto_21',
    'iva_27',
    'neto_27',
    'neto_gravado_total',
    'no_gravado',
    'exento',
    'otros_tributos',
    'iva_total',
    'total',
  ]

  it('G3 (CSV) y la variante «del Emisor»', () => {
    expect(classify(G3_RECIBIDOS_TITLES)).toEqual(G3_KEYS)
    expect(classify(G3_RECIBIDOS_TITLES_DEL_EMISOR)).toEqual(G3_KEYS)
  })

  it('G3 Excel (títulos cortos)', () => {
    const excel = [
      'Fecha',
      'Tipo',
      'Punto de Venta',
      'Número Desde',
      'Número Hasta',
      'Cód. Autorización',
      'Tipo Doc. Emisor',
      'Nro. Doc. Emisor',
      'Denominación Emisor',
      'Tipo Doc. Receptor',
      'Nro. Doc. Receptor',
      'Tipo Cambio',
      'Moneda',
      'Neto Grav. IVA 0%',
      'IVA 2,5%',
      'Neto Grav. IVA 2,5%',
      'IVA 5%',
      'Neto Grav. IVA 5%',
      'IVA 10,5%',
      'Neto Grav. IVA 10,5%',
      'IVA 21%',
      'Neto Grav. IVA 21%',
      'IVA 27%',
      'Neto Grav. IVA 27%',
      'Neto Gravado Total',
      'Neto No Gravado',
      'Op. Exentas',
      'Otros Tributos',
      'Total IVA',
      'Imp. Total',
    ]
    expect(classify(excel)).toEqual(G3_KEYS)
  })

  it('G2 Recibidos y Emitidos: «IVA» a secas es el total, nunca una alícuota', () => {
    expect(classify(G2_RECIBIDOS_TITLES)).toEqual([
      'fecha',
      'tipo',
      'pto_vta',
      'nro_desde',
      'nro_hasta',
      'cod_aut',
      'tipo_doc_emisor',
      'nro_doc_emisor',
      'denom_emisor',
      'tipo_cambio',
      'moneda',
      'neto_gravado_total',
      'no_gravado',
      'exento',
      'otros_tributos',
      'iva_total',
      'total',
    ])
    expect(classify(G2_EMITIDOS_TITLES).slice(6, 9)).toEqual([
      'tipo_doc_receptor',
      'nro_doc_receptor',
      'denom_receptor',
    ])
  })

  it('G1 y Portal IVA', () => {
    expect(classify(['Fecha', 'Tipo', 'Imp. Neto Gravado', 'IVA', 'Imp. Total'])).toEqual([
      'fecha',
      'tipo',
      'neto_gravado_total',
      'iva_total',
      'total',
    ])
    expect(classify(PORTAL_IVA_TITLES)).toEqual([
      'fecha',
      'tipo',
      'pto_vta',
      'nro_comprobante',
      'tipo_doc_emisor',
      'nro_doc_emisor',
      'denom_emisor',
      'total',
      'moneda',
      'tipo_cambio',
      'no_gravado',
      'exento',
      'cf_computable',
      'perc_otros_nac',
      'perc_iibb',
      'imp_municipales',
      'perc_iva',
      'imp_internos',
      'otros_tributos',
      'neto_0',
      'neto_2_5',
      'iva_2_5',
      'neto_5',
      'iva_5',
      'neto_10_5',
      'iva_10_5',
      'neto_21',
      'iva_21',
      'neto_27',
      'iva_27',
      'neto_gravado_total',
      'iva_total',
    ])
  })

  it('otros títulos que circulan', () => {
    expect(classifyHeader('N° Doc. Emisor', MC_HEADER_RULES)).toBe('nro_doc_emisor')
    expect(classifyHeader('Importe Total', MC_HEADER_RULES)).toBe('total')
    expect(classifyHeader('Neto Grav. IVA 10.5%', MC_HEADER_RULES)).toBe('neto_10_5')
    expect(classifyHeader('Pto. Vta.', MC_HEADER_RULES)).toBe('pto_vta')
    expect(classifyHeader('CAE', MC_HEADER_RULES)).toBe('cod_aut')
    expect(classifyHeader('Observaciones', MC_HEADER_RULES)).toBeNull()
  })
})

describe('findHeaderRow', () => {
  it('busca la fila de títulos (el Excel trae un título arriba)', () => {
    const rows = [
      ['Mis Comprobantes Recibidos - CUIT 30712345671'],
      ['Fecha', 'Tipo', 'Punto de Venta', 'Número Desde', 'Imp. Total'],
      ['01/12/2025', '1 - Factura A', 3, 110266, 33500],
    ]
    const found = findHeaderRow(rows, MC_HEADER_RULES, isMcHeader)
    expect(found).toEqual({
      index: 1,
      columns: { fecha: 0, tipo: 1, pto_vta: 2, nro_desde: 3, total: 4 },
      score: 5,
    })
  })

  it('a igual cantidad gana la primera; sin las cuatro claves no hay fila', () => {
    const rows = [
      ['Fecha', 'Tipo', 'Punto de Venta', 'Imp. Total'],
      ['Fecha', 'Tipo', 'Punto de Venta', 'Imp. Total'],
    ]
    expect(findHeaderRow(rows, MC_HEADER_RULES, isMcHeader)?.index).toBe(0)
    expect(findHeaderRow([['Fecha', 'Tipo', 'Total']], MC_HEADER_RULES, isMcHeader)).toBeNull()
  })

  it('cada clave se asigna una sola vez (gana la primera columna)', () => {
    const found = findHeaderRow(
      [['Fecha', 'Fecha', 'Tipo', 'Punto de Venta', 'Imp. Total']],
      MC_HEADER_RULES,
      isMcHeader,
    )
    expect(found?.columns.fecha).toBe(0)
  })
})

describe('headerSignature', () => {
  it('no cambia con tildes, mayúsculas, espacios ni celdas vacías al final; sí con el separador', () => {
    const a = headerSignature(['Fecha', 'Descripción', 'Importe', '', null], ';')
    const b = headerSignature(['FECHA', 'descripcion', ' Importe '], ';')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(headerSignature(['Fecha', 'Descripción', 'Importe'], ',')).not.toBe(a)
    expect(headerSignature(['Fecha', 'Importe', 'Descripción'], ';')).not.toBe(a)
  })
})
