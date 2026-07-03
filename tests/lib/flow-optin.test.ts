import { describe, expect, it } from 'vitest'
import { canSendFlowTemplate } from '@/lib/flows/runtime'

// Compliance §8 (CLAUDE.md §8 + política Meta): un flow no puede mandar un
// template de categoría MARKETING a un cliente sin opt-in. UTILITY/AUTHENTICATION
// son transaccionales y pueden enviarse sin opt-in (ej. recordatorio de reserva).
describe('canSendFlowTemplate — gate de opt-in por categoría', () => {
  it('BLOQUEA MARKETING sin opt-in (el bug de la auditoría)', () => {
    expect(canSendFlowTemplate({ category: 'MARKETING', optInMarketing: false })).toBe(false)
  })

  it('permite MARKETING con opt-in', () => {
    expect(canSendFlowTemplate({ category: 'MARKETING', optInMarketing: true })).toBe(true)
  })

  it('permite UTILITY sin opt-in (transaccional, ej. recordatorio de reserva)', () => {
    expect(canSendFlowTemplate({ category: 'UTILITY', optInMarketing: false })).toBe(true)
  })

  it('permite AUTHENTICATION sin opt-in', () => {
    expect(canSendFlowTemplate({ category: 'AUTHENTICATION', optInMarketing: false })).toBe(true)
  })

  it('es case-insensitive y tolera espacios', () => {
    expect(canSendFlowTemplate({ category: '  marketing ', optInMarketing: false })).toBe(false)
    expect(canSendFlowTemplate({ category: 'utility', optInMarketing: false })).toBe(true)
  })

  it('default seguro: categoría desconocida/vacía sin opt-in se BLOQUEA', () => {
    expect(canSendFlowTemplate({ category: '', optInMarketing: false })).toBe(false)
    expect(canSendFlowTemplate({ category: null, optInMarketing: false })).toBe(false)
    expect(canSendFlowTemplate({ category: 'promo', optInMarketing: false })).toBe(false)
  })

  it('categoría desconocida con opt-in se permite', () => {
    expect(canSendFlowTemplate({ category: null, optInMarketing: true })).toBe(true)
  })
})
