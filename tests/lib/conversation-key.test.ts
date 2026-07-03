import { describe, expect, it } from 'vitest'
import { conversationKey } from '@/lib/phone'

// El outbound guardaba el hilo con el E.164 AR (con el 9 de celular); el inbound
// usaba el wa_id de Meta (sin el 9). Sin unificar, cada cliente tenía DOS
// conversaciones. conversationKey normaliza ambos a la misma clave.
describe('conversationKey', () => {
  it('el E.164 AR (con 9) y el wa_id inbound (sin 9) dan la MISMA clave', () => {
    expect(conversationKey('+5493512345678')).toBe('543512345678')
    expect(conversationKey('543512345678')).toBe('543512345678')
    expect(conversationKey('+5493512345678')).toBe(conversationKey('543512345678'))
  })

  it('tolera que Meta mande el wa_id con el 9', () => {
    expect(conversationKey('5493512345678')).toBe('543512345678')
  })

  it('strippea el formato (+, espacios, guiones)', () => {
    expect(conversationKey('+54 9 351 234-5678')).toBe('543512345678')
  })

  it('no toca números de otros países', () => {
    expect(conversationKey('+14155550123')).toBe('14155550123')
  })
})
