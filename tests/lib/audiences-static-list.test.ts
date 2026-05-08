import { describe, expect, it } from 'vitest'
import { compileFilter } from '@/lib/audiences/compiler'
import { audienceFilterSchema } from '@/lib/audiences/schemas'

const A = '11111111-2222-4333-8444-555555555555'
const B = '22222222-3333-4444-9555-666666666666'

describe('audienceFilterSchema — static_list', () => {
  it('acepta una lista de uuids válidos', () => {
    const ok = audienceFilterSchema.safeParse({
      kind: 'static_list',
      customer_ids: [A, B],
    })
    expect(ok.success).toBe(true)
  })

  it('rechaza un uuid inválido', () => {
    const bad = audienceFilterSchema.safeParse({
      kind: 'static_list',
      customer_ids: ['no-uuid'],
    })
    expect(bad.success).toBe(false)
  })

  it('acepta como nodo dentro de un grupo OR junto con condition', () => {
    const ok = audienceFilterSchema.safeParse({
      kind: 'group',
      op: 'OR',
      nodes: [
        { kind: 'static_list', customer_ids: [A] },
        { kind: 'condition', field: 'visits_count', op: 'gte', value: 5 },
      ],
    })
    expect(ok.success).toBe(true)
  })
})

describe('compileFilter — static_list', () => {
  it('genera c.id IN (...) con placeholders parametrizados', () => {
    const out = compileFilter({ kind: 'static_list', customer_ids: [A, B] })
    expect(out.where).toContain('c.id IN ($2, $3)')
    expect(out.params).toEqual([
      { type: 'uuid', value: A },
      { type: 'uuid', value: B },
    ])
  })

  it('lista vacía → false (no rompe IN ())', () => {
    const out = compileFilter({ kind: 'static_list', customer_ids: [] })
    expect(out.where).toBe('false')
    expect(out.params).toEqual([])
  })

  it('combinado con condition en OR mantiene paréntesis y placeholders correlativos', () => {
    const out = compileFilter({
      kind: 'group',
      op: 'OR',
      nodes: [
        { kind: 'static_list', customer_ids: [A] },
        { kind: 'condition', field: 'visits_count', op: 'gte', value: 5 },
      ],
    })
    expect(out.where).toMatch(/c\.id IN \(\$2\) OR c\.total_visits >= \$3/)
    expect(out.params).toEqual([
      { type: 'uuid', value: A },
      { type: 'int', value: 5 },
    ])
  })
})
