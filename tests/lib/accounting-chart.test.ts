import { describe, expect, it } from 'vitest'
import {
  chartLevel,
  chartParentCode,
  childTypeAllowed,
  isResultType,
  nextChildCode,
  parsePastedChart,
  STANDARD_CHART,
  significantCode,
} from '@/lib/accounting/chart'

// Espejo TS de las reglas de la migración #16 (acc_chart_flex): códigos libres con el estilo del modelo
// de la contadora (1.1.01.01.001) o con puntos (1.1.01.04), tipos mixtos bajo resultados y plan pegado.

describe('códigos del estilo con ceros (private.acc_code_sig / acc_code_depth / acc_code_parent)', () => {
  it('código significativo y profundidad', () => {
    expect(significantCode('1.0.00.00.000')).toBe('1')
    expect(significantCode('1.1.01.01.000')).toBe('1.1.01.01')
    expect(significantCode('1.1.01.01.001')).toBe('1.1.01.01.001')
    expect(significantCode('1.10.00')).toBe('1.10')
    expect(significantCode('1.1.03.01')).toBe('1.1.03.01')
    expect(chartLevel('1.1.01.00.000')).toBe(3)
    expect(chartLevel('3.1.01.00.000')).toBe(3)
    expect(chartLevel('1.1.01.01.001')).toBe(5)
    expect(chartLevel('1.1.03.01')).toBe(4)
  })

  it('madre: el último segmento significativo pasa a ceros del mismo ancho', () => {
    expect(chartParentCode('1.1.01.01.001')).toBe('1.1.01.01.000')
    expect(chartParentCode('1.1.01.01.000')).toBe('1.1.01.00.000')
    expect(chartParentCode('1.1.00.00.000')).toBe('1.0.00.00.000')
    expect(chartParentCode('1.0.00.00.000')).toBeNull()
  })
})

describe('nextChildCode (private.acc_next_child_code)', () => {
  const plan = STANDARD_CHART.map((a) => a.code)

  it('estilo con ceros: numera el primer segmento en cero con el mismo ancho', () => {
    const cajas = ['1.1.01.01.001', '1.1.01.01.002', '1.1.01.01.003', '1.1.01.01.007']
    expect(nextChildCode('1.1.01.01.000', [...plan, ...cajas])).toBe('1.1.01.01.008')
    expect(nextChildCode('1.1.01.01.000', plan)).toBe('1.1.01.01.001')
    expect(nextChildCode('1.1.01.00.000', plan)).toBe('1.1.01.05.000')
    expect(nextChildCode('4.2.00.00.000', plan)).toBe('4.2.04.00.000')
    expect(nextChildCode('3.1.00.00.000', plan)).toBe('3.1.09.00.000')
    expect(nextChildCode('5.0.00.00.000', plan)).toBe('5.2.00.00.000')
    expect(nextChildCode('2.1.01.01.000', [...plan, '2.1.01.01.004'])).toBe('2.1.01.01.005')
  })

  it('el modelo: 1.1.01.00.000 con 1.1.01.01.000 y 1.1.01.02.000 → 1.1.01.03.000', () => {
    expect(
      nextChildCode('1.1.01.00.000', ['1.1.01.00.000', '1.1.01.01.000', '1.1.01.02.000']),
    ).toBe('1.1.01.03.000')
  })

  it('estilo con puntos: agrega .NN (mínimo dos cifras)', () => {
    expect(nextChildCode('1.1.01', ['1.1.01', '1.1.01.01', '1.1.01.02', '1.1.01.03'])).toBe(
      '1.1.01.04',
    )
    expect(nextChildCode('1', ['1', '1.1', '1.2'])).toBe('1.03')
    expect(nextChildCode('5.3.02', [])).toBe('5.3.02.01')
  })

  it('el ancho crece si se pasa (…999 → …1000)', () => {
    expect(nextChildCode('9.9.99.99.000', ['9.9.99.99.999'])).toBe('9.9.99.99.1000')
  })
})

describe('tipos mixtos bajo resultados (#16)', () => {
  it('bajo ingresos o egresos, la hija puede ser cualquiera de los dos; en el resto, el de la madre', () => {
    expect(isResultType('income')).toBe(true)
    expect(isResultType('asset')).toBe(false)
    expect(childTypeAllowed('income', 'expense')).toBe(true)
    expect(childTypeAllowed('expense', 'income')).toBe(true)
    expect(childTypeAllowed('asset', 'asset')).toBe(true)
    expect(childTypeAllowed('asset', 'liability')).toBe(false)
    expect(childTypeAllowed('income', 'asset')).toBe(false)
  })
})

describe('parsePastedChart (lo que se pega para acc_import_accounts)', () => {
  it('líneas del modelo, con encabezados, tabs y guiones', () => {
    const text = [
      'EMPRESA: Tiempo Libre S.A.                 28/09/2026',
      'PLAN DE CUENTAS',
      '',
      '1.0.00.00.000 ACTIVO',
      '   1.1.01.01.000  CAJA Y BANCOS',
      '1.1.01.01.001\tCAJA',
      '1.1.03.04.028 - IVA CREDITO FISCAL',
      '2.1.01.03.002: COMERCIO E INDUSTRIA A PAGAR',
      '28/09/2026',
      'Hoja N° 2',
    ].join('\n')
    expect(parsePastedChart(text)).toEqual({
      rows: [
        { code: '1.0.00.00.000', name: 'ACTIVO' },
        { code: '1.1.01.01.000', name: 'CAJA Y BANCOS' },
        { code: '1.1.01.01.001', name: 'CAJA' },
        { code: '1.1.03.04.028', name: 'IVA CREDITO FISCAL' },
        { code: '2.1.01.03.002', name: 'COMERCIO E INDUSTRIA A PAGAR' },
      ],
      errors: [],
    })
  })

  it('avisa los renglones con código y sin nombre, o demasiado largos', () => {
    const { rows, errors } = parsePastedChart(
      `1.1.01.01.005\n1.1.01.01.006 X\n1.2.3.4.5.6.7.8.9.10.11.12 LARGO\n1.1.01.01.007 ${'N'.repeat(81)}`,
    )
    expect(rows).toEqual([])
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [1, 'Falta el nombre de la cuenta.'],
      [2, 'Falta el nombre de la cuenta.'],
      [3, 'El código puede tener hasta 24 caracteres.'],
      [4, 'El nombre puede tener hasta 80 caracteres.'],
    ])
  })
})
