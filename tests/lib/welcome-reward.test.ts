import { describe, expect, it } from 'vitest'
import { updateWelcomeRewardConfigSchema } from '@/lib/welcome-reward/schemas'

describe('updateWelcomeRewardConfigSchema', () => {
  const validBase = {
    enabled: false,
    reward_id: null,
    headline: 'Regalo de bienvenida',
    subtext: 'Registrate y llevátelo gratis',
  }

  describe('enabled coercion', () => {
    it('acepta true/false directos', () => {
      const r1 = updateWelcomeRewardConfigSchema.safeParse({ ...validBase, enabled: true })
      expect(r1.success).toBe(false)
      const r2 = updateWelcomeRewardConfigSchema.safeParse({ ...validBase, enabled: false })
      expect(r2.success).toBe(true)
    })

    it('coerce "true"/"false" strings via z.coerce.boolean (no-empty string es truthy)', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        ...validBase,
        enabled: 'false',
        reward_id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.enabled).toBe(true)
    })
  })

  describe('reward_id transform', () => {
    it('acepta uuid válido', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        ...validBase,
        reward_id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reward_id).toBe('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa')
    })

    it('transforma string vacío a null', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({ ...validBase, reward_id: '' })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reward_id).toBeNull()
    })

    it('acepta null (caso de FormData.get cuando no se eligió reward)', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({ ...validBase, reward_id: null })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reward_id).toBeNull()
    })

    it('rechaza string que no sea uuid ni vacío', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        ...validBase,
        reward_id: 'no-soy-uuid',
      })
      expect(r.success).toBe(false)
    })
  })

  describe('headline / subtext', () => {
    it('acepta headline 1..80', () => {
      expect(
        updateWelcomeRewardConfigSchema.safeParse({ ...validBase, headline: 'a' }).success,
      ).toBe(true)
      expect(
        updateWelcomeRewardConfigSchema.safeParse({ ...validBase, headline: 'a'.repeat(80) })
          .success,
      ).toBe(true)
    })

    it('rechaza headline vacío o solo espacios', () => {
      expect(
        updateWelcomeRewardConfigSchema.safeParse({ ...validBase, headline: '' }).success,
      ).toBe(false)
      expect(
        updateWelcomeRewardConfigSchema.safeParse({ ...validBase, headline: '   ' }).success,
      ).toBe(false)
    })

    it('rechaza headline > 80 chars', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        ...validBase,
        headline: 'a'.repeat(81),
      })
      expect(r.success).toBe(false)
    })

    it('rechaza subtext > 160 chars', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        ...validBase,
        subtext: 'a'.repeat(161),
      })
      expect(r.success).toBe(false)
    })

    it('trim headline y subtext', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        ...validBase,
        headline: '  Mi regalo  ',
        subtext: '  Llevátelo  ',
      })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.headline).toBe('Mi regalo')
        expect(r.data.subtext).toBe('Llevátelo')
      }
    })
  })

  describe('refinement: enabled requiere reward_id', () => {
    it('rechaza enabled=true sin reward_id', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        enabled: true,
        reward_id: null,
        headline: 'X',
        subtext: 'Y',
      })
      expect(r.success).toBe(false)
      if (!r.success) {
        const issue = r.error.issues.find((i) => i.path.includes('reward_id'))
        expect(issue).toBeTruthy()
        expect(issue?.message).toMatch(/recompensa/i)
      }
    })

    it('acepta enabled=true con reward_id', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        enabled: true,
        reward_id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
        headline: 'X',
        subtext: 'Y',
      })
      expect(r.success).toBe(true)
    })

    it('acepta enabled=false sin reward_id (estado deshabilitado coherente)', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        enabled: false,
        reward_id: null,
        headline: 'X',
        subtext: 'Y',
      })
      expect(r.success).toBe(true)
    })

    it('acepta enabled=false con reward_id (puede dejarse pre-seleccionado para reactivar)', () => {
      const r = updateWelcomeRewardConfigSchema.safeParse({
        enabled: false,
        reward_id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
        headline: 'X',
        subtext: 'Y',
      })
      expect(r.success).toBe(true)
    })
  })
})
