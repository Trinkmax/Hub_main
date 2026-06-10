import { describe, expect, it } from 'vitest'
import { moveTicketItemsSchema } from '@/lib/tickets/schemas'

// UUIDs RFC 4122 válidos (zod v4 valida version [1-8] y variant [89ab]).
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-9222-222222222222'
const UUID_ITEM = '33333333-3333-4333-a333-333333333333'
const UUID_GUEST = '44444444-4444-4444-b444-444444444444'

describe('moveTicketItemsSchema', () => {
  it('parsea input válido y aplica assign="auto" por defecto', () => {
    const r = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 2 }],
    })
    expect(r.moves[0]?.assign).toBe('auto')
    expect(r.moves[0]?.quantity).toBe(2)
  })

  it('coacciona quantity desde string', () => {
    const r = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: '3' }],
    })
    expect(r.moves[0]?.quantity).toBe(3)
  })

  it('acepta assign="shared" y assign=<uuid de comensal>', () => {
    const shared = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1, assign: 'shared' }],
    })
    expect(shared.moves[0]?.assign).toBe('shared')
    const toGuest = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1, assign: UUID_GUEST }],
    })
    expect(toGuest.moves[0]?.assign).toBe(UUID_GUEST)
  })

  it('rechaza assign con string arbitrario (ni auto/shared ni uuid)', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1, assign: 'pepe' }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza quantity < 1', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 0 }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza moves vacío', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza uuids inválidos', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: 'no-uuid',
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1 }],
    })
    expect(r.success).toBe(false)
  })
})
