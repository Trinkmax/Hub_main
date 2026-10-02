import { describe, expect, it } from 'vitest'
import { humanizeSalonError } from '@/lib/salon/humanize'
import { EVENT_IS_PRIVATE_GROUP, PRIVATE_GROUP_HAS_MONEY } from '@/lib/salon/private-groups'
import { scheduledEventSchema, scheduledTemplateSchema } from '@/lib/salon/schemas'

// El tilde «Grupo privado» (C1 de los socios, 02/10/2026) saca una fecha de los
// reportes de eventos: un `'false'` leído como `true` (lo que hace
// `z.coerce.boolean()`) no puede pasar, y sin el campo NO se pisa lo guardado.

const EVENT = {
  template_id: '3f2a1c4e-8b7d-4e21-9a6f-0c5d2b1e7a90',
  event_date: '2026-10-20',
  starts_at_local: '21:00',
  capacity: 60,
  meal_type: 'dinner',
}

describe('scheduledEventSchema.private_group', () => {
  it('booleano, texto de FormData y casilla', () => {
    expect(scheduledEventSchema.parse({ ...EVENT, private_group: true }).private_group).toBe(true)
    expect(scheduledEventSchema.parse({ ...EVENT, private_group: false }).private_group).toBe(false)
    expect(scheduledEventSchema.parse({ ...EVENT, private_group: 'true' }).private_group).toBe(true)
    // Lo que `z.coerce.boolean()` leería como `true`.
    expect(scheduledEventSchema.parse({ ...EVENT, private_group: 'false' }).private_group).toBe(
      false,
    )
    expect(scheduledEventSchema.parse({ ...EVENT, private_group: 'on' }).private_group).toBe(true)
  })

  it('sin el campo queda sin definir: la acción no pisa lo guardado', () => {
    expect(scheduledEventSchema.parse(EVENT).private_group).toBeUndefined()
  })

  it('cualquier otra cosa no es un tilde', () => {
    expect(scheduledEventSchema.safeParse({ ...EVENT, private_group: 'sí' }).success).toBe(false)
    expect(scheduledEventSchema.safeParse({ ...EVENT, private_group: 1 }).success).toBe(false)
  })
})

describe('scheduledTemplateSchema.default_private_group', () => {
  const TEMPLATE = { name: 'Merienda Libre', slug: 'merienda-libre' }

  it('«Se usa para grupos privados» viaja como el tilde de la fecha', () => {
    expect(
      scheduledTemplateSchema.parse({ ...TEMPLATE, default_private_group: true })
        .default_private_group,
    ).toBe(true)
    expect(
      scheduledTemplateSchema.parse({ ...TEMPLATE, default_private_group: 'false' })
        .default_private_group,
    ).toBe(false)
    expect(scheduledTemplateSchema.parse(TEMPLATE).default_private_group).toBeUndefined()
  })
})

describe('los triggers de la base, en palabras (calendario)', () => {
  it('marcar privada una fecha con pauta', () => {
    expect(humanizeSalonError('private_group_has_money')).toBe(PRIVATE_GROUP_HAS_MONEY)
  })

  it('cargar plata en una fecha que ya es privada', () => {
    expect(humanizeSalonError('event_is_private_group')).toBe(EVENT_IS_PRIVATE_GROUP)
  })

  it('el resto sigue igual', () => {
    expect(humanizeSalonError('forbidden')).toBe('No tenés permiso para esa acción.')
  })
})
