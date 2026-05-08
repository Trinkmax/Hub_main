import { describe, expect, it } from 'vitest'
import { audienceFilterSchema } from '@/lib/audiences/schemas'

describe('audienceFilterSchema', () => {
  it('parsea grupo con condition', () => {
    const ok = audienceFilterSchema.safeParse({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'visits_count', op: 'gte', value: 3 }],
    })
    expect(ok.success).toBe(true)
  })

  it('rechaza field desconocido', () => {
    const bad = audienceFilterSchema.safeParse({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'foo', op: 'eq', value: 1 }],
    })
    expect(bad.success).toBe(false)
  })

  it('rechaza op desconocido', () => {
    const bad = audienceFilterSchema.safeParse({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'visits_count', op: 'foo', value: 1 }],
    })
    expect(bad.success).toBe(false)
  })

  it('acepta grupos anidados sin profundidad arbitraria', () => {
    const nested = audienceFilterSchema.safeParse({
      kind: 'group',
      op: 'OR',
      nodes: [
        {
          kind: 'group',
          op: 'AND',
          nodes: [
            { kind: 'condition', field: 'visits_count', op: 'gte', value: 3 },
            { kind: 'condition', field: 'opt_in_marketing', op: 'is_true', value: null },
          ],
        },
        { kind: 'condition', field: 'birth_month', op: 'eq', value: 5 },
      ],
    })
    expect(nested.success).toBe(true)
  })
})
