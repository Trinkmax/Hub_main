import { describe, expect, it } from 'vitest'
import {
  resolveTemplateVariables,
  templateBodyParamCount,
  type VariableMapping,
} from '@/lib/broadcasts/variables'

const customer = { first_name: 'Ana', last_name: 'Pérez', phone: '+5493510000000' }

describe('templateBodyParamCount', () => {
  it('cuenta los {{n}} del componente BODY', () => {
    const components = [
      { type: 'BODY', text: 'Hola {{1}}, te esperamos el {{2}}.' },
      { type: 'FOOTER', text: 'HUB' },
    ]
    expect(templateBodyParamCount(components)).toBe(2)
  })
  it('0 si no hay body o no hay placeholders', () => {
    expect(templateBodyParamCount([{ type: 'BODY', text: 'Sin variables' }])).toBe(0)
    expect(templateBodyParamCount([])).toBe(0)
    expect(templateBodyParamCount(null)).toBe(0)
  })
})

describe('resolveTemplateVariables', () => {
  it('mapea por índice a campos del customer, en orden', () => {
    const mapping: VariableMapping = { '1': { source: 'first_name' }, '2': { source: 'last_name' } }
    expect(resolveTemplateVariables(mapping, customer, 2)).toEqual(['Ana', 'Pérez'])
  })
  it('usa value literal cuando source = custom', () => {
    const mapping: VariableMapping = { '1': { source: 'custom', value: 'VIP' } }
    expect(resolveTemplateVariables(mapping, customer, 1)).toEqual(['VIP'])
  })
  it('usa fallback cuando el campo del customer está vacío', () => {
    const mapping: VariableMapping = { '1': { source: 'first_name', fallback: 'cliente' } }
    expect(resolveTemplateVariables(mapping, { ...customer, first_name: '' }, 1)).toEqual([
      'cliente',
    ])
  })
  it('rellena con string vacío los índices sin mapeo (nunca undefined)', () => {
    const mapping: VariableMapping = { '1': { source: 'first_name' } }
    expect(resolveTemplateVariables(mapping, customer, 2)).toEqual(['Ana', ''])
  })
})
