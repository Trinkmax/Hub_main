import { describe, expect, it } from 'vitest'
import { formatForWhatsApp } from '@/lib/phone'

describe('formatForWhatsApp', () => {
  it('saca el 9 de celular argentino (+549… → +54…)', () => {
    expect(formatForWhatsApp('+5493512345678')).toBe('+543512345678')
    expect(formatForWhatsApp('+5493854405374')).toBe('+543854405374')
  })

  it('deja igual un número AR sin 9 (fijo)', () => {
    expect(formatForWhatsApp('+543512345678')).toBe('+543512345678')
  })

  it('no toca otros países', () => {
    expect(formatForWhatsApp('+15551234567')).toBe('+15551234567')
    expect(formatForWhatsApp('+5511999998888')).toBe('+5511999998888')
  })
})
