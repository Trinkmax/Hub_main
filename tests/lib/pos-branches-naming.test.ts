// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  branchSlug,
  chipLabel,
  cleanText,
  isNameTaken,
  nameKey,
  SHORT_NAME_MAX,
  SLUG_MAX,
  suggestShortName,
} from '@/lib/pos/branches/naming'

/** El `check` de `branches.slug` en la base. */
const VALID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe('cleanText', () => {
  it('saca los espacios de los costados y los dobles del medio', () => {
    expect(cleanText('  Alta   Córdoba ')).toBe('Alta Córdoba')
    expect(cleanText('\tCerro\n')).toBe('Cerro')
  })
})

describe('isNameTaken', () => {
  const branches = [
    { id: 'a', name: 'Alta Córdoba' },
    { id: 'b', name: 'Cerro' },
  ]

  it('compara como la base: sin mayúsculas ni espacios a los costados', () => {
    expect(nameKey('  CERRO ')).toBe('cerro')
    expect(isNameTaken(branches, 'cerro')).toBe(true)
    expect(isNameTaken(branches, ' ALTA CÓRDOBA ')).toBe(true)
    expect(isNameTaken(branches, 'Güemes')).toBe(false)
  })

  it('los acentos sí distinguen (la base también los distingue)', () => {
    expect(isNameTaken(branches, 'Alta Cordoba')).toBe(false)
  })

  it('renombrar una sucursal a su propio nombre no choca', () => {
    expect(isNameTaken(branches, 'Cerro', 'b')).toBe(false)
    expect(isNameTaken(branches, 'Cerro', 'a')).toBe(true)
  })

  it('un nombre vacío no está tomado: lo frena otra regla', () => {
    expect(isNameTaken(branches, '   ')).toBe(false)
  })
})

describe('branchSlug', () => {
  it('sale del nombre: sin acentos, sin espacios, en minúsculas', () => {
    expect(branchSlug('Cerro', [])).toBe('cerro')
    expect(branchSlug('Alta Córdoba', [])).toBe('alta-cordoba')
    expect(branchSlug('  Güemes & Cía. ', [])).toBe('guemes-cia')
  })

  it('si ya está en uso, suma un número', () => {
    expect(branchSlug('Cerro', ['cerro'])).toBe('cerro-2')
    expect(branchSlug('Cerro', ['cerro', 'cerro-2'])).toBe('cerro-3')
  })

  it('de un nombre del que no sale nada queda «sucursal»', () => {
    expect(branchSlug('!!!', [])).toBe('sucursal')
    expect(branchSlug('日本', ['sucursal'])).toBe('sucursal-2')
  })

  it('nunca pasa el tope ni termina en guion, ni siquiera con el número', () => {
    const long = 'Nueva Córdoba Centro Comercial Patio Olmos Local Doce Planta Alta'
    const first = branchSlug(long, [])
    expect(first.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(first).toMatch(VALID_SLUG)
    const second = branchSlug(long, [first])
    expect(second.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(second).toMatch(VALID_SLUG)
    expect(second).not.toBe(first)
  })

  it('siempre pasa la regla de la base', () => {
    for (const name of ['Cerro', 'A', '9 de Julio', 'Bv. San Juan 1.250', '--x--', 'ñandú']) {
      expect(branchSlug(name, []), name).toMatch(VALID_SLUG)
    }
  })
})

describe('suggestShortName', () => {
  it('un nombre que entra en la barra del salón no necesita uno corto', () => {
    expect(suggestShortName('Cerro')).toBeNull()
    expect(suggestShortName('Alta Córdoba')).toBeNull()
  })

  it('achica las palabras de adelante y deja entera la última', () => {
    expect(suggestShortName('Nueva Córdoba Centro')).toBe('N. C. Centro')
    expect(suggestShortName('Villa General Belgrano')).toBe('V. G. Belgrano')
  })

  it('primero prueba sin las palabras de relleno', () => {
    expect(suggestShortName('Cerro de las Rosas')).toBe('Cerro Rosas')
    expect(suggestShortName('Barrio de los Naranjos')).toBe('B. Naranjos')
  })

  it('una sola palabra larguísima se corta', () => {
    expect(suggestShortName('Constitucionalidades')).toBe('Constitucional')
  })

  it('nunca pasa el tope de la base', () => {
    for (const name of [
      'Aeropuerto Internacional Ambrosio Taravella',
      'Shopping Nuevocentro Córdoba',
      'Paseo del Buen Pastor',
      'Supercalifragilístico Local',
    ]) {
      const short = suggestShortName(name)
      expect(short, name).not.toBeNull()
      expect((short ?? '').length, name).toBeLessThanOrEqual(SHORT_NAME_MAX)
      expect((short ?? '').length, name).toBeGreaterThan(0)
    }
  })
})

describe('chipLabel', () => {
  it('usa el nombre corto si lo tiene, y si no el nombre', () => {
    expect(chipLabel({ name: 'Alta Córdoba', shortName: 'A. Córdoba' })).toBe('A. Córdoba')
    expect(chipLabel({ name: 'Cerro', shortName: null })).toBe('Cerro')
    expect(chipLabel({ name: 'Cerro', shortName: '   ' })).toBe('Cerro')
  })
})
