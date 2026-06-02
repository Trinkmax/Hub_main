import { describe, expect, it } from 'vitest'
import { uniqueSlugFrom } from '@/lib/salon/slug-dedupe'

describe('uniqueSlugFrom', () => {
  it('slugifica un nombre simple', () => {
    expect(uniqueSlugFrom('Pizza Libre', [])).toBe('pizza-libre')
  })

  it('normaliza acentos y mayúsculas', () => {
    expect(uniqueSlugFrom('Ramen Día Único', [])).toBe('ramen-dia-unico')
  })

  it('agrega sufijo numérico ante colisión', () => {
    expect(uniqueSlugFrom('Pizza Libre', ['pizza-libre'])).toBe('pizza-libre-2')
  })

  it('encuentra el primer sufijo libre', () => {
    expect(uniqueSlugFrom('Pizza Libre', ['pizza-libre', 'pizza-libre-2', 'pizza-libre-3'])).toBe(
      'pizza-libre-4',
    )
  })

  it('usa fallback cuando el slug queda vacío', () => {
    const r = uniqueSlugFrom('🎂🎂', [])
    expect(r).toBe('formato')
  })

  it('usa fallback cuando el slug tiene un solo carácter', () => {
    expect(uniqueSlugFrom('a', [])).toBe('formato')
  })

  it('respeta el máximo de 40 caracteres incluyendo el sufijo', () => {
    const long = 'a'.repeat(60)
    const r = uniqueSlugFrom(long, ['a'.repeat(40)])
    expect(r.length).toBeLessThanOrEqual(40)
    expect(r.endsWith('-2')).toBe(true)
  })
})
