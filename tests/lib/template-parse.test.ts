import { describe, expect, it } from 'vitest'
import { parseMetaComponents } from '@/lib/meta/template-components'

describe('parseMetaComponents', () => {
  it('extrae header, body, footer y botones', () => {
    const components = [
      { type: 'HEADER', format: 'TEXT', text: 'Novedades' },
      { type: 'BODY', text: 'Hola {{1}}!' },
      { type: 'FOOTER', text: 'HUB · Córdoba' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'No recibir promociones' }] },
    ]
    expect(parseMetaComponents(components)).toEqual({
      header: 'Novedades',
      body: 'Hola {{1}}!',
      footer: 'HUB · Córdoba',
      buttons: ['No recibir promociones'],
    })
  })

  it('tolera components que no son array', () => {
    expect(parseMetaComponents(null)).toEqual({
      header: null,
      body: '',
      footer: null,
      buttons: [],
    })
  })

  it('un header de media (sin texto) queda en null', () => {
    const result = parseMetaComponents([
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'x' },
    ])
    expect(result.header).toBeNull()
    expect(result.body).toBe('x')
  })
})
