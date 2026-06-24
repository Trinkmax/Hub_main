import { describe, expect, it } from 'vitest'
import { isPublicPath } from '@/lib/supabase/middleware'

// Regresión: el proxy redirigía /api/cron/* a /login (sin sesión) → pg_cron/Vercel
// nunca corrían los jobs. Las rutas de cron se auto-protegen con Bearer CRON_SECRET,
// así que deben ser públicas a nivel proxy.
describe('isPublicPath', () => {
  it('las rutas de cron son públicas (self-auth con CRON_SECRET)', () => {
    expect(isPublicPath('/api/cron/dispatch')).toBe(true)
    expect(isPublicPath('/api/cron/process-jobs')).toBe(true)
  })

  it('los webhooks siguen públicos', () => {
    expect(isPublicPath('/api/webhooks/whatsapp')).toBe(true)
  })

  it('las rutas de tenant NO son públicas', () => {
    expect(isPublicPath('/acme/clientes')).toBe(false)
    expect(isPublicPath('/acme/mensajeria/difusiones')).toBe(false)
  })

  it('login y assets son públicos', () => {
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/icons/logo.png')).toBe(true)
  })
})
