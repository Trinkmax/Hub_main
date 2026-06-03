import { describe, expect, it } from 'vitest'
import { capturePromptConfigSchema, DEFAULT_CAPTURE_PROMPT } from '@/lib/capture-prompt/schemas'

describe('capturePromptConfigSchema', () => {
  it('acepta una config válida', () => {
    const r = capturePromptConfigSchema.safeParse({
      enabled: true,
      headline: 'Sumá puntos',
      subtext: 'Dejá tus datos',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza headline vacío', () => {
    const r = capturePromptConfigSchema.safeParse({ enabled: true, headline: '', subtext: 'x' })
    expect(r.success).toBe(false)
  })

  it('rechaza headline > 80 chars', () => {
    const r = capturePromptConfigSchema.safeParse({
      enabled: false,
      headline: 'a'.repeat(81),
      subtext: 'x',
    })
    expect(r.success).toBe(false)
  })

  it('coerce de enabled "on" a true', () => {
    const r = capturePromptConfigSchema.safeParse({ enabled: 'on', headline: 'h', subtext: 's' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.enabled).toBe(true)
  })

  it('el default tiene copy no vacío', () => {
    expect(DEFAULT_CAPTURE_PROMPT.headline.length).toBeGreaterThan(0)
    expect(DEFAULT_CAPTURE_PROMPT.subtext.length).toBeGreaterThan(0)
    expect(DEFAULT_CAPTURE_PROMPT.enabled).toBe(true)
  })
})
