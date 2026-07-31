import { describe, expect, it } from 'vitest'
import {
  createPunchCardSchema,
  PUNCH_TRIGGER_TYPES,
  triggerNeedsRef,
  updatePunchCardSchema,
} from '@/lib/punch-cards/schemas'

const REWARD_ID = '11111111-1111-4111-8111-111111111111'
const REF_ID = '22222222-2222-4222-8222-222222222222'
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'

/** "Junta 6 sellos y el 7mo café va de regalo", sellada a mano por el cajero. */
function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Tarjeta del café',
    trigger_type: 'manual',
    threshold: 6,
    reward_id: REWARD_ID,
    ...overrides,
  }
}

describe('PUNCH_TRIGGER_TYPES', () => {
  it('incluye "manual" — es el disparador que eligió el dueño', () => {
    expect(PUNCH_TRIGGER_TYPES).toContain('manual')
  })
})

describe('triggerNeedsRef', () => {
  it('sólo item/category/tag apuntan a algo del catálogo', () => {
    expect(triggerNeedsRef('item')).toBe(true)
    expect(triggerNeedsRef('category')).toBe(true)
    expect(triggerNeedsRef('tag')).toBe(true)
  })

  it('manual y visit_window no necesitan referencia', () => {
    expect(triggerNeedsRef('manual')).toBe(false)
    expect(triggerNeedsRef('visit_window')).toBe(false)
  })

  it('un trigger desconocido no pide referencia', () => {
    expect(triggerNeedsRef('lo-que-sea')).toBe(false)
  })
})

describe('createPunchCardSchema', () => {
  it('acepta la tarjeta manual mínima', () => {
    const parsed = createPunchCardSchema.safeParse(baseCard())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.trigger_type).toBe('manual')
      expect(parsed.data.threshold).toBe(6)
    }
  })

  it('rechaza un threshold menor a 2 con un mensaje accionable', () => {
    const parsed = createPunchCardSchema.safeParse(baseCard({ threshold: 1 }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Mínimo 2 sellos')
    }
  })

  it('exige elegir la recompensa', () => {
    const parsed = createPunchCardSchema.safeParse(baseCard({ reward_id: '' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Elegí qué se gana al completarla')
    }
  })

  it('pide la referencia cuando el disparador es por ítem', () => {
    const parsed = createPunchCardSchema.safeParse(baseCard({ trigger_type: 'item' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['trigger_ref_id'])
    }
  })

  it('acepta el disparador por ítem con su referencia', () => {
    const parsed = createPunchCardSchema.safeParse(
      baseCard({ trigger_type: 'item', trigger_ref_id: REF_ID }),
    )
    expect(parsed.success).toBe(true)
  })

  it('rechaza una referencia colgada en un disparador manual', () => {
    const parsed = createPunchCardSchema.safeParse(baseCard({ trigger_ref_id: REF_ID }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Este disparador no apunta a un ítem.')
    }
  })

  it('guarda el texto del premio y el ícono del sello', () => {
    const parsed = createPunchCardSchema.safeParse(
      baseCard({ reward_label: 'El 7mo café va de regalo', stamp_icon: 'Coffee' }),
    )
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.reward_label).toBe('El 7mo café va de regalo')
      expect(parsed.data.stamp_icon).toBe('Coffee')
    }
  })

  it('acepta el tope diario en la config (lo lee add_punch_stamp)', () => {
    const parsed = createPunchCardSchema.safeParse(baseCard({ config: { max_per_day: 1 } }))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.config?.max_per_day).toBe(1)
    }
  })

  it('acepta la config completa de visit_window', () => {
    const parsed = createPunchCardSchema.safeParse(
      baseCard({
        trigger_type: 'visit_window',
        config: {
          hours_from: '12:00',
          hours_to: '15:30',
          days_of_week: [1, 2, 3, 4, 5],
          max_per_day: 1,
          period_days: 30,
        },
      }),
    )
    expect(parsed.success).toBe(true)
  })

  it('rechaza un horario con formato inválido', () => {
    const parsed = createPunchCardSchema.safeParse(
      baseCard({ trigger_type: 'visit_window', config: { hours_from: '12hs' } }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rechaza un día de la semana fuera de rango', () => {
    const parsed = createPunchCardSchema.safeParse(
      baseCard({ trigger_type: 'visit_window', config: { days_of_week: [0] } }),
    )
    expect(parsed.success).toBe(false)
  })
})

describe('updatePunchCardSchema', () => {
  it('exige el id y por defecto deja la tarjeta activa', () => {
    const parsed = updatePunchCardSchema.safeParse(baseCard({ id: TEMPLATE_ID }))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.id).toBe(TEMPLATE_ID)
      expect(parsed.data.active).toBe(true)
    }
  })

  it('permite apagar la tarjeta sin borrarla', () => {
    const parsed = updatePunchCardSchema.safeParse(baseCard({ id: TEMPLATE_ID, active: false }))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.active).toBe(false)
  })

  it('rechaza un id que no es uuid', () => {
    const parsed = updatePunchCardSchema.safeParse(baseCard({ id: 'nope' }))
    expect(parsed.success).toBe(false)
  })
})
