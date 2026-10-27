import { describe, expect, it } from 'vitest'
import { isPublicPath } from '@/lib/supabase/middleware'
import { RESERVED_SLUGS } from '@/lib/tenant/types'

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

  it('el link público del bar (bio de Instagram) es público', () => {
    expect(isPublicPath('/l/hub')).toBe(true)
    // Y NO se lo traga la ruta de tenant: 'l' está en RESERVED_SLUGS.
    expect(isPublicPath('/lomas/clientes')).toBe(false)
  })

  it('las páginas HTML del bar son públicas', () => {
    // Sin esto, quien abre la landing desde Instagram cae en el login.
    expect(isPublicPath('/p/halloween-2026')).toBe(true)
    // Y 'p' está en RESERVED_SLUGS, así que no se la come el ruteo por tenant.
    expect(isPublicPath('/parana/clientes')).toBe(false)
  })

  it('la cartelera y las entradas online son públicas', () => {
    // La abre gente sin cuenta desde WhatsApp o Instagram para comprar.
    expect(isPublicPath('/entradas/hub')).toBe(true)
    expect(isPublicPath('/entradas/hub/shrek-2')).toBe(true)
    expect(isPublicPath('/entradas/hub/mi-entrada/3f1c2b9e-0000-4000-8000-000000000000')).toBe(true)
    expect(RESERVED_SLUGS.has('entradas')).toBe(true)
    // El panel de Entradas del dueño sigue cerrado.
    expect(isPublicPath('/hub/entradas')).toBe(false)
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
