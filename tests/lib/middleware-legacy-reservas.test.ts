import { describe, expect, it } from 'vitest'
import { legacyReservasTarget } from '@/lib/supabase/middleware'

const U = '3f2a1c4e-8b7d-4e21-9a6f-0c5d2b1e7a90'

// El proxy es el que da el 307 real de la vieja lista /reservas (la página
// sola saldría como 200 + meta refresh por el loading.tsx del tenant). Acá se
// cubre solo el cableado del proxy: qué paths agarra y cómo pasa los params;
// el mapeo en sí vive en salon-calendar-links.test.ts.
describe('legacyReservasTarget', () => {
  it('traduce la lista exacta con ?day&nueva al día del calendario', () => {
    const sp = new URLSearchParams({ day: '2026-09-10', nueva: U })
    expect(legacyReservasTarget('hub', ['reservas'], sp)).toBe(
      `/hub/eventos/programados?month=2026-09&day=2026-09-10&res=${U}`,
    )
  })

  it('sin params manda al calendario pelado', () => {
    expect(legacyReservasTarget('hub', ['reservas'], new URLSearchParams())).toBe(
      '/hub/eventos/programados',
    )
  })

  it('el alta y la ficha de una reserva NO se redirigen', () => {
    const sp = new URLSearchParams({ date: '2026-09-10' })
    expect(legacyReservasTarget('hub', ['reservas', 'nuevo'], sp)).toBeNull()
    expect(legacyReservasTarget('hub', ['reservas', U], sp)).toBeNull()
  })

  it('otras rutas del tenant pasan de largo', () => {
    const sp = new URLSearchParams()
    expect(legacyReservasTarget('hub', [], sp)).toBeNull()
    expect(legacyReservasTarget('hub', ['eventos', 'programados'], sp)).toBeNull()
    expect(legacyReservasTarget('hub', ['salon', 'reservas-operativo'], sp)).toBeNull()
  })

  it('con params repetidos gana el primero, como en los searchParams de Next', () => {
    const sp = new URLSearchParams('day=2026-09-10&day=2026-09-11')
    expect(legacyReservasTarget('hub', ['reservas'], sp)).toBe(
      '/hub/eventos/programados?month=2026-09&day=2026-09-10',
    )
  })
})
