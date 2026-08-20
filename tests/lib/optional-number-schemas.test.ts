import { describe, expect, it } from 'vitest'
import { createMenuItemSchema } from '@/lib/menu/schemas'
import { createRewardSchema, createTierBenefitSchema } from '@/lib/points/schemas'

// Regresión del bug "AGOTADO fantasma".
//
// `z.coerce.number()` convierte `''` y `null` en 0 (`Number('') === 0`) y una
// `z.union` se queda con la primera rama que valida. Con el schema numérico
// primero, "campo vacío" — que en toda la app significa "sin límite" / "sin
// override" — se guardaba como 0. En `rewards.stock` eso dejó 26 recompensas
// mostrándose AGOTADAS en la billetera y rechazadas por la RPC de canje.
//
// Los schemas con `.min(1)` se salvaban de casualidad (el 0 no valida y cae a la
// rama siguiente), así que el test apunta a los que aceptan 0 como valor real.

const REWARD_BASE = {
  name: 'Trago gratis',
  cost_points: '100',
  category: '',
  min_tier_id: '',
  image_url: '',
  description: '',
}

const MENU_ITEM_BASE = {
  category_id: '11111111-1111-4111-8111-111111111111',
  name: 'Fernet',
  description: '',
  price_cents: '500000',
  image_url: '',
  video_url: '',
}

const BENEFIT_BASE = {
  tier_id: '22222222-2222-4222-8222-222222222222',
  kind: 'perk' as const,
  label: 'Fila preferencial',
  description: '',
  icon: '',
  image_url: '',
  reward_id: '',
  discount_scope: '',
  partner_id: '',
}

describe('rewards.stock — vacío es ilimitado, no agotado', () => {
  it.each([
    ['string vacío (FormData de un input sin tocar)', ''],
    ['null (payload del diálogo de edición)', null],
    ['undefined (campo ausente con el switch en Ilimitado)', undefined],
  ])('%s → null', (_label, input) => {
    const parsed = createRewardSchema.parse({ ...REWARD_BASE, stock: input })
    expect(parsed.stock).toBeNull()
  })

  it('un 0 explícito sigue significando agotado', () => {
    expect(createRewardSchema.parse({ ...REWARD_BASE, stock: '0' }).stock).toBe(0)
  })

  it('un número real se conserva', () => {
    expect(createRewardSchema.parse({ ...REWARD_BASE, stock: '12' }).stock).toBe(12)
    expect(createRewardSchema.parse({ ...REWARD_BASE, stock: 12 }).stock).toBe(12)
  })

  it('rechaza basura y negativos', () => {
    expect(createRewardSchema.safeParse({ ...REWARD_BASE, stock: 'abc' }).success).toBe(false)
    expect(createRewardSchema.safeParse({ ...REWARD_BASE, stock: '-1' }).success).toBe(false)
  })
})

describe('menu_items.points_override — vacío es sin override, no +0 pts', () => {
  it.each([
    ['string vacío', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s → null', (_label, input) => {
    const parsed = createMenuItemSchema.parse({ ...MENU_ITEM_BASE, points_override: input })
    expect(parsed.points_override).toBeNull()
  })

  it('un override real se conserva', () => {
    expect(
      createMenuItemSchema.parse({ ...MENU_ITEM_BASE, points_override: '20' }).points_override,
    ).toBe(20)
  })
})

describe('tier_benefits.discount_pct — vacío es sin descuento', () => {
  it('sin porcentaje queda en null', () => {
    const parsed = createTierBenefitSchema.parse({ ...BENEFIT_BASE, discount_pct: '' })
    expect(parsed.discount_pct).toBeNull()
  })

  it('un beneficio de descuento sin porcentaje ahora falla la validación', () => {
    // Antes `''` se coercía a 0 y el superRefine (`discount_pct === null`) nunca
    // disparaba: se podía guardar un "descuento" del 0%.
    const result = createTierBenefitSchema.safeParse({
      ...BENEFIT_BASE,
      kind: 'discount',
      discount_pct: '',
    })
    expect(result.success).toBe(false)
  })

  it('un porcentaje real se conserva', () => {
    const parsed = createTierBenefitSchema.parse({
      ...BENEFIT_BASE,
      kind: 'discount',
      discount_pct: '15',
    })
    expect(parsed.discount_pct).toBe(15)
  })
})
