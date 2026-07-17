import { describe, expect, it } from 'vitest'
import {
  buildTemplateComponents,
  extractPositionalVars,
  fillExamples,
  isContiguousFrom1,
} from '@/lib/meta/template-components'

describe('extractPositionalVars', () => {
  it('devuelve los números únicos ordenados', () => {
    expect(extractPositionalVars('Hola {{1}}, tu pedido {{2}} llega el {{2}}')).toEqual([1, 2])
  })
  it('tolera espacios dentro de las llaves', () => {
    expect(extractPositionalVars('Hola {{ 1 }}!')).toEqual([1])
  })
  it('devuelve vacío sin variables', () => {
    expect(extractPositionalVars('Sin variables')).toEqual([])
  })
})

describe('isContiguousFrom1', () => {
  it('acepta 1,2,3', () => expect(isContiguousFrom1([1, 2, 3])).toBe(true))
  it('acepta vacío', () => expect(isContiguousFrom1([])).toBe(true))
  it('rechaza huecos', () => expect(isContiguousFrom1([1, 3])).toBe(false))
  it('rechaza si no arranca en 1', () => expect(isContiguousFrom1([2])).toBe(false))
})

describe('fillExamples', () => {
  it('reemplaza variables por ejemplos', () => {
    expect(fillExamples('Hola {{1}}, código {{2}}', ['Ana', 'X5'])).toBe('Hola Ana, código X5')
  })
  it('deja el placeholder si falta el ejemplo', () => {
    expect(fillExamples('Hola {{1}}', [])).toBe('Hola {{1}}')
  })
})

describe('buildTemplateComponents', () => {
  it('body sin variables no lleva example ni parameterFormat', () => {
    const { components, parameterFormat } = buildTemplateComponents({
      bodyText: 'Gracias por venir',
    })
    expect(parameterFormat).toBeUndefined()
    expect(components).toEqual([{ type: 'BODY', text: 'Gracias por venir' }])
  })

  it('body con variables incluye example.body_text y parameterFormat positional', () => {
    const { components, parameterFormat } = buildTemplateComponents({
      bodyText: 'Hola {{1}}, tu código es {{2}}',
      bodyExamples: ['Ana', 'X5'],
    })
    expect(parameterFormat).toBe('positional')
    expect(components[0]).toEqual({
      type: 'BODY',
      text: 'Hola {{1}}, tu código es {{2}}',
      example: { body_text: [['Ana', 'X5']] },
    })
  })

  it('header de texto con variable lleva example.header_text', () => {
    const { components } = buildTemplateComponents({
      bodyText: 'Cuerpo',
      headerText: '¡Hola {{1}}!',
      headerExample: 'Ana',
    })
    expect(components[0]).toEqual({
      type: 'HEADER',
      format: 'TEXT',
      text: '¡Hola {{1}}!',
      example: { header_text: ['Ana'] },
    })
  })

  it('header sin variable no lleva example', () => {
    const { components } = buildTemplateComponents({ bodyText: 'Cuerpo', headerText: 'Novedades' })
    expect(components[0]).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Novedades' })
  })

  it('agrega footer y botones (URL + quick reply) en orden', () => {
    const { components } = buildTemplateComponents({
      bodyText: 'Cuerpo',
      footerText: 'HUB · Córdoba',
      buttons: [
        { type: 'url', text: 'Ver más', url: 'https://hub.bar' },
        { type: 'quick_reply', text: 'No recibir promociones' },
      ],
    })
    expect(components).toContainEqual({ type: 'FOOTER', text: 'HUB · Córdoba' })
    expect(components.at(-1)).toEqual({
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Ver más', url: 'https://hub.bar' },
        { type: 'QUICK_REPLY', text: 'No recibir promociones' },
      ],
    })
  })
})
