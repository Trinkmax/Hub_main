import { describe, expect, it } from 'vitest'
import {
  countBodyVariables,
  fillTemplateBody,
  getTemplateBodyText,
  humanizeTemplateName,
  parseTemplateContent,
  renderSentTemplate,
} from '@/lib/bandeja/template-view'

const COMPONENTS = [
  { type: 'HEADER', format: 'TEXT', text: 'Hola' },
  { type: 'BODY', text: 'Hola {{1}}, te esperamos el {{2}} en el bar.' },
  { type: 'FOOTER', text: 'HUB' },
]

describe('getTemplateBodyText', () => {
  it('devuelve el texto del BODY', () => {
    expect(getTemplateBodyText(COMPONENTS)).toBe('Hola {{1}}, te esperamos el {{2}} en el bar.')
  })

  it('null si no hay BODY o el shape es inválido', () => {
    expect(getTemplateBodyText([{ type: 'HEADER', text: 'x' }])).toBeNull()
    expect(getTemplateBodyText('no-array')).toBeNull()
    expect(getTemplateBodyText(null)).toBeNull()
  })
})

describe('countBodyVariables', () => {
  it('cuenta {{n}} solo del BODY', () => {
    expect(countBodyVariables(COMPONENTS)).toBe(2)
  })

  it('0 sin variables o sin BODY', () => {
    expect(countBodyVariables([{ type: 'BODY', text: 'Sin variables' }])).toBe(0)
    expect(countBodyVariables([])).toBe(0)
  })
})

describe('fillTemplateBody', () => {
  it('reemplaza las variables cargadas', () => {
    expect(fillTemplateBody('Hola {{1}}, sos {{2}}', ['Juan', 'Oro'])).toBe('Hola Juan, sos Oro')
  })

  it('deja el marcador si la variable falta o está vacía', () => {
    expect(fillTemplateBody('Hola {{1}} y {{2}}', ['Juan'])).toBe('Hola Juan y {{2}}')
    expect(fillTemplateBody('Hola {{1}}', ['  '])).toBe('Hola {{1}}')
  })
})

describe('parseTemplateContent', () => {
  it('parsea nombre y variables', () => {
    expect(parseTemplateContent('[template:bienvenida_hub] Juan | 20:00')).toEqual({
      name: 'bienvenida_hub',
      variables: ['Juan', '20:00'],
    })
  })

  it('parsea sin variables', () => {
    expect(parseTemplateContent('[template:recordatorio]')).toEqual({
      name: 'recordatorio',
      variables: [],
    })
  })

  it('null para texto normal', () => {
    expect(parseTemplateContent('hola, ¿cómo va?')).toBeNull()
  })
})

describe('renderSentTemplate', () => {
  const templates = [
    {
      id: 't1',
      name: 'bienvenida_hub',
      language: 'es_AR',
      category: 'MARKETING',
      components: COMPONENTS,
    },
  ]

  it('resuelve el cuerpo real con variables', () => {
    const result = renderSentTemplate('[template:bienvenida_hub] Juan | viernes', templates)
    expect(result).toEqual({
      name: 'bienvenida_hub',
      body: 'Hola Juan, te esperamos el viernes en el bar.',
    })
  })

  it('body null si el template no existe localmente', () => {
    const result = renderSentTemplate('[template:borrado] Juan', templates)
    expect(result).toEqual({ name: 'borrado', body: null })
  })

  it('null si el contenido no es de plantilla', () => {
    expect(renderSentTemplate('mensaje normal', templates)).toBeNull()
  })
})

describe('humanizeTemplateName', () => {
  it('convierte snake_case a texto legible', () => {
    expect(humanizeTemplateName('bienvenida_hub_v2')).toBe('Bienvenida hub v2')
    expect(humanizeTemplateName('promo-viernes')).toBe('Promo viernes')
  })
})
