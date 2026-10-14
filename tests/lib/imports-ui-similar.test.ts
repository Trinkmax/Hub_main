/**
 * «¿Lo tenés de antes?» (`lib/imports/ui/similar.ts`): qué proveedores ya
 * cargados, sin CUIT, se le parecen a uno que llega en un archivo de ARCA.
 * Importa tanto lo que encuentra como lo que NO ofrece: nunca uno con CUIT,
 * nunca uno dado de baja, nunca por una palabra de relleno.
 */

import { describe, expect, it } from 'vitest'
import {
  isLinkable,
  nameSimilarity,
  nameTokens,
  type SimilarCandidate,
  similarParties,
} from '@/lib/imports/ui/similar'

const party = (
  over: Partial<SimilarCandidate> & { id: string; name: string },
): SimilarCandidate => ({
  taxId: null,
  active: true,
  kind: 'supplier',
  ...over,
})

describe('las palabras que identifican un nombre', () => {
  it('saca tildes, signos, la forma societaria y las palabras cortas', () => {
    expect(nameTokens('Distribuidora Norte S.R.L.')).toEqual(['distribuidora', 'norte'])
    expect(nameTokens('VERDULERÍA LOS ÁLAMOS DE JUAN PÉREZ')).toEqual([
      'verduleria',
      'alamos',
      'juan',
      'perez',
    ])
    expect(nameTokens('Cervecería Artesanal Sierras SRL')).toEqual([
      'cerveceria',
      'artesanal',
      'sierras',
    ])
    expect(nameTokens('S.A.')).toEqual([])
    expect(nameTokens('')).toEqual([])
    expect(nameTokens('   ---  ')).toEqual([])
  })

  it('no repite palabras', () => {
    expect(nameTokens('Hielo Hielo Hielo SA')).toEqual(['hielo'])
  })
})

describe('cuánto se parecen dos nombres', () => {
  it('iguales salvo la forma societaria: 1', () => {
    expect(nameSimilarity('Distribuidora Norte SRL', 'distribuidora norte')).toBe(1)
  })

  it('el nombre de fantasía dentro de la razón social se parece bastante', () => {
    expect(
      nameSimilarity('VERDULERIA LOS ALAMOS DE JUAN PEREZ', 'Verdulería Los Álamos'),
    ).toBeGreaterThanOrEqual(0.5)
  })

  it('una abreviatura cuenta como la palabra entera', () => {
    expect(nameSimilarity('Distrib. Norte', 'Distribuidora Norte')).toBe(1)
  })

  it('nombres distintos o sin palabras comparables: 0', () => {
    expect(nameSimilarity('Carnicería Demo SRL', 'Limpieza Total SA')).toBe(0)
    expect(nameSimilarity('S.A.', 'Distribuidora Norte')).toBe(0)
    expect(nameSimilarity('', '')).toBe(0)
  })
})

describe('a quién se le puede guardar el CUIT', () => {
  it('solo proveedores activos y sin CUIT', () => {
    expect(isLinkable(party({ id: 'a', name: 'A' }))).toBe(true)
    expect(isLinkable(party({ id: 'a', name: 'A', taxId: '   ' }))).toBe(true)
    expect(isLinkable(party({ id: 'a', name: 'A', taxId: '30712345671' }))).toBe(false)
    expect(isLinkable(party({ id: 'a', name: 'A', active: false }))).toBe(false)
    expect(isLinkable(party({ id: 'a', name: 'A', kind: 'customer' }))).toBe(false)
  })
})

describe('los parecidos que se ofrecen', () => {
  const parties: SimilarCandidate[] = [
    party({ id: 'norte', name: 'Distribuidora Norte' }),
    party({ id: 'sur', name: 'Distribuidora del Sur', tradeName: 'La Sureña' }),
    party({ id: 'con-cuit', name: 'Distribuidora Norte SRL', taxId: '30712345671' }),
    party({ id: 'baja', name: 'Distribuidora Norte (vieja)', active: false }),
    party({ id: 'alamos', name: 'Juan Pérez', tradeName: 'Verdulería Los Álamos' }),
    party({ id: 'cliente', name: 'Distribuidora Norte', kind: 'customer' }),
  ]

  it('el más parecido primero, sin los que ya tienen CUIT ni los dados de baja', () => {
    const found = similarParties('DISTRIBUIDORA NORTE S.R.L.', parties)
    expect(found[0]).toEqual({ id: 'norte', label: 'Distribuidora Norte', score: 1 })
    expect(found.map((f) => f.id)).not.toContain('con-cuit')
    expect(found.map((f) => f.id)).not.toContain('baja')
    expect(found.map((f) => f.id)).not.toContain('cliente')
  })

  it('compara también contra el nombre de fantasía, y lo usa de etiqueta', () => {
    expect(similarParties('VERDULERIA LOS ALAMOS', parties)).toEqual([
      { id: 'alamos', label: 'Verdulería Los Álamos', score: 1 },
    ])
  })

  it('respeta el máximo, y con cero no devuelve nada', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      party({ id: `d${i}`, name: `Distribuidora Norte ${i}` }),
    )
    expect(similarParties('Distribuidora Norte', many)).toHaveLength(3)
    expect(similarParties('Distribuidora Norte', many, 1)).toHaveLength(1)
    expect(similarParties('Distribuidora Norte', many, 0)).toEqual([])
  })

  it('sin proveedores, sin nombre o sin parecidos: lista vacía', () => {
    expect(similarParties('Distribuidora Norte', [])).toEqual([])
    expect(similarParties('S.A.', parties)).toEqual([])
    expect(similarParties('Hielo Polar', parties)).toEqual([])
  })

  it('un nombre de 60 caracteres no lo traba', () => {
    const long = 'Compañía Distribuidora de Bebidas y Alimentos del Norte Argentino SA'
    expect(similarParties(long, parties).map((f) => f.id)).toContain('norte')
  })
})
