import { describe, expect, it } from 'vitest'
import { TAG_COLORS, updateConversationTagSchema } from '@/lib/conversation-tags/schemas'

describe('updateConversationTagSchema', () => {
  it('acepta id + name + color válidos', () => {
    const r = updateConversationTagSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'VIP',
      color: TAG_COLORS[0],
    })
    expect(r.success).toBe(true)
  })

  it('recorta el nombre y rechaza uno vacío', () => {
    const r = updateConversationTagSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      name: '   ',
      color: TAG_COLORS[0],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza un color fuera de la paleta curada', () => {
    const r = updateConversationTagSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'VIP',
      color: '#123456',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza un id que no es uuid', () => {
    const r = updateConversationTagSchema.safeParse({
      id: 'no-es-uuid',
      name: 'VIP',
      color: TAG_COLORS[0],
    })
    expect(r.success).toBe(false)
  })

  it('la paleta tiene 10 colores hex de 6 dígitos', () => {
    expect(TAG_COLORS).toHaveLength(10)
    for (const c of TAG_COLORS) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
