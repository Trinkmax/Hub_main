import { describe, expect, it } from 'vitest'
import { compileFilter, InvalidFilterError } from '@/lib/audiences/compiler'
import type { AudienceFilter } from '@/lib/audiences/schemas'

const UID = '11111111-2222-4333-8444-555555555555'
const TAG = '22222222-3333-4444-9555-666666666666'

describe('compileFilter', () => {
  it('grupo vacío → true', () => {
    const out = compileFilter({ kind: 'group', op: 'AND', nodes: [] })
    expect(out.where).toBe('true')
    expect(out.params).toEqual([])
  })

  it('condición scalar simple genera placeholder $2', () => {
    const filter: AudienceFilter = {
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'visits_count', op: 'gte', value: 3 }],
    }
    const out = compileFilter(filter)
    expect(out.where).toContain('c.total_visits >= $2')
    expect(out.params).toEqual([{ type: 'int', value: 3 }])
  })

  it('AND/OR anidados con paréntesis y placeholders correlativos', () => {
    const filter: AudienceFilter = {
      kind: 'group',
      op: 'AND',
      nodes: [
        { kind: 'condition', field: 'opt_in_marketing', op: 'is_true', value: null },
        {
          kind: 'group',
          op: 'OR',
          nodes: [
            { kind: 'condition', field: 'visits_count', op: 'gte', value: 5 },
            { kind: 'condition', field: 'total_spent_cents', op: 'gte', value: 100000 },
          ],
        },
      ],
    }
    const out = compileFilter(filter)
    expect(out.where).toMatch(/c\.opt_in_marketing IS TRUE/)
    expect(out.where).toMatch(/c\.total_visits >= \$2/)
    expect(out.where).toMatch(/c\.total_spent_cents >= \$3/)
    expect(out.where).toMatch(/AND \(.*OR.*\)/)
    expect(out.params).toEqual([
      { type: 'int', value: 5 },
      { type: 'bigint', value: 100000 },
    ])
  })

  it('IN con array genera lista de placeholders', () => {
    const filter: AudienceFilter = {
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'source', op: 'in', value: ['qr', 'manual'] }],
    }
    const out = compileFilter(filter)
    expect(out.where).toContain('c.source::text IN ($2, $3)')
    expect(out.params).toEqual([
      { type: 'text', value: 'qr' },
      { type: 'text', value: 'manual' },
    ])
  })

  it('IN con array vacío → false (no rompe)', () => {
    const out = compileFilter({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'source', op: 'in', value: [] }],
    })
    expect(out.where).toContain('false')
  })

  it('has_tag genera EXISTS subselect parametrizado', () => {
    const out = compileFilter({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'has_tag', op: 'eq', value: TAG }],
    })
    expect(out.where).toContain('EXISTS (')
    expect(out.where).toContain('cta.tag_id = $2')
    expect(out.params).toEqual([{ type: 'uuid', value: TAG }])
  })

  it('attended_event_id genera EXISTS con status checked_in', () => {
    const out = compileFilter({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'attended_event_id', op: 'eq', value: UID }],
    })
    expect(out.where).toContain("r.status = 'checked_in'")
    expect(out.where).toContain('r.event_id = $2')
  })

  it('rechaza un op no permitido para el field', () => {
    expect(() =>
      compileFilter({
        kind: 'group',
        op: 'AND',
        nodes: [{ kind: 'condition', field: 'opt_in_marketing', op: 'gt', value: true }],
      }),
    ).toThrow(InvalidFilterError)
  })

  it('rechaza un uuid mal formado', () => {
    expect(() =>
      compileFilter({
        kind: 'group',
        op: 'AND',
        nodes: [{ kind: 'condition', field: 'has_tag', op: 'eq', value: 'no-uuid' }],
      }),
    ).toThrow(InvalidFilterError)
  })

  it('días desde última visita usa expresión derivada', () => {
    const out = compileFilter({
      kind: 'group',
      op: 'AND',
      nodes: [{ kind: 'condition', field: 'days_since_last_visit', op: 'lte', value: 30 }],
    })
    expect(out.where).toContain('extract(epoch from (now() - c.last_visit_at)) / 86400')
    expect(out.params).toEqual([{ type: 'int', value: 30 }])
  })
})
