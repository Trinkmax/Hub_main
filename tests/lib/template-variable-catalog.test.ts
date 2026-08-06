import { describe, expect, it } from 'vitest'
import {
  resolveTemplateVariables,
  TEMPLATE_VARIABLES,
  variableDefinition,
  variableLabel,
} from '@/lib/broadcasts/variables'
import { caretOutsideVariable, renumberPositionalVars } from '@/lib/meta/template-components'

const customer = {
  first_name: 'Juan',
  last_name: 'Pérez',
  phone: '+5493510000000',
  birthdate: '1990-03-15',
  points_balance: 250,
}

describe('catálogo de variables', () => {
  it('cada entrada tiene etiqueta corta, larga y ejemplo', () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.longLabel.length).toBeGreaterThan(0)
      expect(v.example.length).toBeGreaterThan(0)
      expect(v.hint.length).toBeGreaterThan(0)
    }
  })

  it('variableDefinition/variableLabel resuelven por clave', () => {
    expect(variableDefinition('birthdate')?.label).toBe('Cumpleaños')
    expect(variableLabel('points')).toBe('Puntos')
    expect(variableDefinition('no_existe')).toBeNull()
    expect(variableLabel('no_existe')).toBe('Dato del cliente')
  })
})

describe('resolveTemplateVariables — datos nuevos', () => {
  it('resuelve nombre y apellido juntos', () => {
    const out = resolveTemplateVariables({ '1': { source: 'full_name' } }, customer, 1)
    expect(out).toEqual(['Juan Pérez'])
  })

  it('el cumpleaños sale como dd/MM, sin año ni corrimiento de zona', () => {
    const out = resolveTemplateVariables({ '1': { source: 'birthdate' } }, customer, 1)
    expect(out).toEqual(['15/03'])
  })

  it('sin cumpleaños cargado usa el texto de respaldo', () => {
    const out = resolveTemplateVariables(
      { '1': { source: 'birthdate', fallback: 'tu cumple' } },
      { ...customer, birthdate: null },
      1,
    )
    expect(out).toEqual(['tu cumple'])
  })

  it('cero puntos es un valor válido, no cae al respaldo', () => {
    const out = resolveTemplateVariables(
      { '1': { source: 'points', fallback: 'algunos' } },
      { ...customer, points_balance: 0 },
      1,
    )
    expect(out).toEqual(['0'])
  })

  it('sin saldo conocido sí cae al respaldo', () => {
    const out = resolveTemplateVariables(
      { '1': { source: 'points', fallback: 'varios' } },
      { ...customer, points_balance: null },
      1,
    )
    expect(out).toEqual(['varios'])
  })

  it('un cliente viejo sin los campos nuevos no rompe', () => {
    const out = resolveTemplateVariables(
      { '1': { source: 'first_name' }, '2': { source: 'birthdate', fallback: '—' } },
      { first_name: 'Ana', last_name: 'Gómez', phone: '+549351' },
      2,
    )
    expect(out).toEqual(['Ana', '—'])
  })
})

describe('renumberPositionalVars', () => {
  it('deja 1..n en orden de aparición y arrastra ejemplos y significados', () => {
    const out = renumberPositionalVars('Hola {{2}}, tenés {{3}} puntos', {
      examples: ['Juan', 'Pérez', '250'],
      hints: { '1': 'first_name', '2': 'last_name', '3': 'points' },
    })
    expect(out.text).toBe('Hola {{1}}, tenés {{2}} puntos')
    expect(out.examples).toEqual(['Pérez', '250'])
    expect(out.hints).toEqual({ '1': 'last_name', '2': 'points' })
  })

  it('la misma variable repetida sigue siendo una sola', () => {
    const out = renumberPositionalVars('{{2}} y de nuevo {{2}}', {
      examples: ['Juan', 'Pérez'],
      hints: { '2': 'last_name' },
    })
    expect(out.text).toBe('{{1}} y de nuevo {{1}}')
    expect(out.examples).toEqual(['Pérez'])
    expect(out.hints).toEqual({ '1': 'last_name' })
  })

  it('un texto ya ordenado queda igual', () => {
    const out = renumberPositionalVars('Hola {{1}}, {{2}}', {
      examples: ['Juan', 'Pérez'],
      hints: { '1': 'first_name', '2': 'last_name' },
    })
    expect(out.text).toBe('Hola {{1}}, {{2}}')
    expect(out.examples).toEqual(['Juan', 'Pérez'])
    expect(out.hints).toEqual({ '1': 'first_name', '2': 'last_name' })
  })

  it('sin variables devuelve listas vacías', () => {
    const out = renumberPositionalVars('Mensaje sin huecos', {
      examples: ['Juan'],
      hints: { '1': 'first_name' },
    })
    expect(out.text).toBe('Mensaje sin huecos')
    expect(out.examples).toEqual([])
    expect(out.hints).toEqual({})
  })

  it('tolera espacios adentro de las llaves', () => {
    const out = renumberPositionalVars('Hola {{ 3 }}', { examples: [], hints: {} })
    expect(out.text).toBe('Hola {{1}}')
  })
})

describe('caretOutsideVariable', () => {
  const text = 'Hola {{1}}, ¿todo bien?'

  it('empuja el cursor al final de la variable si cayó adentro', () => {
    // 'Hola {{' = 7 → el cursor quedó entre las llaves y el número.
    expect(caretOutsideVariable(text, 7)).toBe(10)
    expect(caretOutsideVariable(text, 8)).toBe(10)
  })

  it('no toca el cursor si está justo antes o justo después', () => {
    expect(caretOutsideVariable(text, 5)).toBe(5)
    expect(caretOutsideVariable(text, 10)).toBe(10)
  })

  it('deja el cursor donde está si no hay variables', () => {
    expect(caretOutsideVariable('Sin huecos', 4)).toBe(4)
  })

  it('funciona con varias variables', () => {
    const many = '{{1}} y {{2}}'
    expect(caretOutsideVariable(many, 2)).toBe(5)
    expect(caretOutsideVariable(many, 10)).toBe(13)
  })
})
