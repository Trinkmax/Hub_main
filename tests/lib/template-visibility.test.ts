import { describe, expect, it } from 'vitest'
import { hiddenTemplates, isHiddenTemplate, visibleTemplates } from '@/lib/meta/template-visibility'

describe('isHiddenTemplate', () => {
  it('oculta lo que no está en español y las muestras de Meta', () => {
    expect(isHiddenTemplate({ name: 'hello_world', language: 'en_US' })).toBe(true)
    expect(isHiddenTemplate({ name: 'jaspers_market_image_cta_v1', language: 'en_US' })).toBe(true)
    expect(isHiddenTemplate({ name: 'sample_shipping_confirmation', language: 'es' })).toBe(true)
    expect(isHiddenTemplate({ name: 'promo_verano', language: 'en_GB' })).toBe(true)
  })

  it('deja ver las del bar en cualquier español', () => {
    expect(isHiddenTemplate({ name: 'hub_codigo_recuperacion', language: 'es_AR' })).toBe(false)
    expect(isHiddenTemplate({ name: 'test_difusiones', language: 'es' })).toBe(false)
    expect(isHiddenTemplate({ name: 'promo', language: 'ES_MX' })).toBe(false)
  })

  it('visibleTemplates y hiddenTemplates son complementarias', () => {
    const rows = [
      { id: 1, name: 'hello_world', language: 'en_US' },
      { id: 2, name: 'hub_codigo_recuperacion', language: 'es_AR' },
    ]
    expect(visibleTemplates(rows).map((r) => r.id)).toEqual([2])
    expect(hiddenTemplates(rows).map((r) => r.id)).toEqual([1])
  })
})
