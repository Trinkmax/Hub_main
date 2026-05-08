import { describe, expect, it } from 'vitest'
import { flowStepConfigSchema } from '@/lib/flows/schemas'

// Tests de la validación de step config — el runtime real toca DB y se valida
// con tests RLS / smoke en PR.
describe('flowStepConfigSchema', () => {
  it('valida send_template con channel/template uuid', () => {
    const ok = flowStepConfigSchema.safeParse({
      type: 'send_template',
      channel_id: '11111111-2222-4333-8444-555555555555',
      template_id: '22222222-3333-4444-9555-666666666666',
      variables: ['{{first_name}}'],
    })
    expect(ok.success).toBe(true)
  })

  it('valida wait con minutes', () => {
    const ok = flowStepConfigSchema.safeParse({ type: 'wait', minutes: 60 })
    expect(ok.success).toBe(true)
  })

  it('rechaza wait con minutes fuera de rango', () => {
    const bad = flowStepConfigSchema.safeParse({ type: 'wait', minutes: 0 })
    expect(bad.success).toBe(false)
  })

  it('valida condition con else_offset default', () => {
    const ok = flowStepConfigSchema.safeParse({
      type: 'condition',
      field: 'customer.opt_in_marketing',
      op: 'is_true',
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect((ok.data as { else_offset: number }).else_offset).toBe(1)
  })

  it('valida add_tag con uuid', () => {
    const ok = flowStepConfigSchema.safeParse({
      type: 'add_tag',
      tag_id: '11111111-2222-4333-8444-555555555555',
    })
    expect(ok.success).toBe(true)
  })

  it('rechaza add_tag con uuid inválido', () => {
    const bad = flowStepConfigSchema.safeParse({ type: 'add_tag', tag_id: 'no' })
    expect(bad.success).toBe(false)
  })
})
