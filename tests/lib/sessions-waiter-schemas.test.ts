import { describe, expect, it } from 'vitest'
import {
  activateByIdSchema,
  activateByQrSchema,
  addStaffTicketSchema,
  updateAliasSchema,
  updatePartySizeSchema,
} from '@/lib/sessions-waiter/schemas'

const validQrToken = 'aBcDeFgHiJkLmNoP'
const validUuid = '11111111-1111-4111-8111-111111111111'

describe('activateByQrSchema', () => {
  it('acepta input válido', () => {
    const r = activateByQrSchema.parse({
      qrToken: validQrToken,
      partySize: 4,
      source: 'scan',
    })
    expect(r.partySize).toBe(4)
    expect(r.source).toBe('scan')
  })

  it('default source = scan', () => {
    const r = activateByQrSchema.parse({ qrToken: validQrToken, partySize: 2 })
    expect(r.source).toBe('scan')
  })

  it('coerce partySize string → int', () => {
    const r = activateByQrSchema.parse({ qrToken: validQrToken, partySize: '3' })
    expect(r.partySize).toBe(3)
  })

  it('rechaza partySize 0', () => {
    const r = activateByQrSchema.safeParse({ qrToken: validQrToken, partySize: 0 })
    expect(r.success).toBe(false)
  })

  it('rechaza partySize negativo', () => {
    const r = activateByQrSchema.safeParse({ qrToken: validQrToken, partySize: -1 })
    expect(r.success).toBe(false)
  })

  it('rechaza partySize > 100', () => {
    const r = activateByQrSchema.safeParse({ qrToken: validQrToken, partySize: 101 })
    expect(r.success).toBe(false)
  })

  it('rechaza partySize decimal', () => {
    const r = activateByQrSchema.safeParse({ qrToken: validQrToken, partySize: 2.5 })
    expect(r.success).toBe(false)
  })

  it('rechaza qrToken con longitud incorrecta', () => {
    const r = activateByQrSchema.safeParse({ qrToken: 'short', partySize: 2 })
    expect(r.success).toBe(false)
  })

  it('rechaza qrToken con chars inválidos', () => {
    const r = activateByQrSchema.safeParse({ qrToken: 'aBcDeFgH-jKlMnOp', partySize: 2 })
    expect(r.success).toBe(false)
  })

  it('rechaza source inválido', () => {
    const r = activateByQrSchema.safeParse({
      qrToken: validQrToken,
      partySize: 2,
      source: 'mystery',
    })
    expect(r.success).toBe(false)
  })
})

describe('activateByIdSchema', () => {
  it('default source = manual', () => {
    const r = activateByIdSchema.parse({ physicalTableId: validUuid, partySize: 2 })
    expect(r.source).toBe('manual')
  })

  it('rechaza UUID inválido', () => {
    const r = activateByIdSchema.safeParse({ physicalTableId: 'not-a-uuid', partySize: 2 })
    expect(r.success).toBe(false)
  })
})

describe('alias en activateByQrSchema', () => {
  it('alias opcional, undefined cuando no se pasa', () => {
    const r = activateByQrSchema.parse({ qrToken: validQrToken, partySize: 2 })
    expect(r.alias).toBeUndefined()
  })

  it('string trimmea espacios', () => {
    const r = activateByQrSchema.parse({
      qrToken: validQrToken,
      partySize: 2,
      alias: '  Cumple de Juan  ',
    })
    expect(r.alias).toBe('Cumple de Juan')
  })

  it('string vacío se transforma a null', () => {
    const r = activateByQrSchema.parse({ qrToken: validQrToken, partySize: 2, alias: '' })
    expect(r.alias).toBeNull()
  })

  it('rechaza alias > 60 chars', () => {
    const r = activateByQrSchema.safeParse({
      qrToken: validQrToken,
      partySize: 2,
      alias: 'x'.repeat(61),
    })
    expect(r.success).toBe(false)
  })
})

describe('updateAliasSchema', () => {
  it('acepta string válido', () => {
    const r = updateAliasSchema.parse({ sessionId: validUuid, alias: 'Cumple' })
    expect(r.alias).toBe('Cumple')
  })

  it('acepta null para borrar alias', () => {
    const r = updateAliasSchema.parse({ sessionId: validUuid, alias: null })
    expect(r.alias).toBeNull()
  })

  it('rechaza alias > 60 chars', () => {
    const r = updateAliasSchema.safeParse({ sessionId: validUuid, alias: 'x'.repeat(61) })
    expect(r.success).toBe(false)
  })

  it('rechaza sessionId no-UUID', () => {
    const r = updateAliasSchema.safeParse({ sessionId: 'bad', alias: 'x' })
    expect(r.success).toBe(false)
  })
})

describe('updatePartySizeSchema', () => {
  it('acepta input válido', () => {
    const r = updatePartySizeSchema.parse({ sessionId: validUuid, partySize: 5 })
    expect(r.partySize).toBe(5)
  })

  it('rechaza partySize 0', () => {
    const r = updatePartySizeSchema.safeParse({ sessionId: validUuid, partySize: 0 })
    expect(r.success).toBe(false)
  })

  it('rechaza sessionId no-UUID', () => {
    const r = updatePartySizeSchema.safeParse({ sessionId: 'bad', partySize: 2 })
    expect(r.success).toBe(false)
  })
})

describe('addStaffTicketSchema', () => {
  const validItem = { menuItemId: validUuid, quantity: 2, notes: null }

  it('acepta input válido', () => {
    const r = addStaffTicketSchema.parse({
      sessionId: validUuid,
      items: [validItem],
    })
    expect(r.items).toHaveLength(1)
    expect(r.assignedToGuestId).toBeUndefined()
  })

  it('acepta assignedToGuestId opcional', () => {
    const r = addStaffTicketSchema.parse({
      sessionId: validUuid,
      assignedToGuestId: validUuid,
      items: [validItem],
    })
    expect(r.assignedToGuestId).toBe(validUuid)
  })

  it('rechaza items vacíos', () => {
    const r = addStaffTicketSchema.safeParse({ sessionId: validUuid, items: [] })
    expect(r.success).toBe(false)
  })

  it('rechaza quantity 0 o negativa', () => {
    expect(
      addStaffTicketSchema.safeParse({
        sessionId: validUuid,
        items: [{ ...validItem, quantity: 0 }],
      }).success,
    ).toBe(false)
    expect(
      addStaffTicketSchema.safeParse({
        sessionId: validUuid,
        items: [{ ...validItem, quantity: -1 }],
      }).success,
    ).toBe(false)
  })

  it('rechaza quantity > 50', () => {
    const r = addStaffTicketSchema.safeParse({
      sessionId: validUuid,
      items: [{ ...validItem, quantity: 51 }],
    })
    expect(r.success).toBe(false)
  })

  it('notes vacías o solo espacios → null', () => {
    const r = addStaffTicketSchema.parse({
      sessionId: validUuid,
      items: [{ ...validItem, notes: '   ' }],
    })
    expect(r.items[0]?.notes).toBeNull()
  })

  it('rechaza notes > 200 chars', () => {
    const r = addStaffTicketSchema.safeParse({
      sessionId: validUuid,
      items: [{ ...validItem, notes: 'x'.repeat(201) }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza menuItemId no-UUID', () => {
    const r = addStaffTicketSchema.safeParse({
      sessionId: validUuid,
      items: [{ ...validItem, menuItemId: 'bad' }],
    })
    expect(r.success).toBe(false)
  })
})
