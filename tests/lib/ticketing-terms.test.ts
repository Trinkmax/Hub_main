import { describe, expect, it } from 'vitest'
import { splitTerms } from '@/lib/ticketing/terms'

describe('splitTerms', () => {
  it('las condiciones de HUB: la primera frase y el resto', () => {
    const terms =
      'Importante: las señas no tienen devolución. Lo único que se puede hacer en caso de no poder asistir es:\na) Consultar a HUB disponibilidad para otra fecha.\nb) Pasar el nombre de un reemplazo.'
    expect(splitTerms(terms)).toEqual({
      first: 'Importante: las señas no tienen devolución.',
      rest: 'Lo único que se puede hacer en caso de no poder asistir es:\na) Consultar a HUB disponibilidad para otra fecha.\nb) Pasar el nombre de un reemplazo.',
    })
  })

  it('corta en el primer salto de línea si viene antes que el punto', () => {
    expect(splitTerms('Sin devolución\nAvisá 3 días antes.')).toEqual({
      first: 'Sin devolución',
      rest: 'Avisá 3 días antes.',
    })
  })

  it('no corta en el punto de un número', () => {
    expect(splitTerms('La seña de $20.000 no se devuelve. Avisá antes.').first).toBe(
      'La seña de $20.000 no se devuelve.',
    )
  })

  it('una sola frase: todo es la primera', () => {
    expect(splitTerms('Menores acompañados por un adulto')).toEqual({
      first: 'Menores acompañados por un adulto',
      rest: '',
    })
  })
})
