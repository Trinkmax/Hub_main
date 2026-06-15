import { describe, expect, it } from 'vitest'
import { renderTemplateBodyPreview } from '@/lib/broadcasts/preview'

describe('renderTemplateBodyPreview', () => {
  it('sustituye {{n}} por los valores dados', () => {
    const components = [{ type: 'BODY', text: 'Hola {{1}}, vení el {{2}}.' }]
    expect(renderTemplateBodyPreview(components, ['Ana', 'sábado'])).toBe(
      'Hola Ana, vení el sábado.',
    )
  })
  it('deja {{n}} si falta el valor', () => {
    expect(renderTemplateBodyPreview([{ type: 'BODY', text: 'Hola {{1}}' }], [])).toBe('Hola {{1}}')
  })
  it('string vacío si no hay BODY', () => {
    expect(renderTemplateBodyPreview([{ type: 'FOOTER', text: 'x' }], [])).toBe('')
  })
})
