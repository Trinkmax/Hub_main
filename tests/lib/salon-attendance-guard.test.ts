import { describe, expect, it } from 'vitest'
import { createSalonReservationSchema, updateSalonReservationSchema } from '@/lib/salon/schemas'

const base = {
  guest_name: 'Juan Test',
  meal_type: 'dinner' as const,
  reservation_date: '2026-06-01',
  reservation_time_local: '21:30',
  zone: 'planta_alta' as const,
  estimated_guests: 20,
  origin: 'whatsapp' as const,
  primary_manager_id: '00000000-0000-4000-8000-000000000001',
}

describe('la asistencia no se borra al editar la reserva', () => {
  it('el schema del FORM strippea actual_guests: por eso el payload llega sin la clave', () => {
    // El form valida con el schema de creación (reservation-form.tsx), que no
    // declara actual_guests. Este test fija ese hecho: si algún día se agrega,
    // el guard de la action deja de ser necesario y hay que revisarlo.
    const r = createSalonReservationSchema.safeParse({ ...base, actual_guests: 18 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect((r.data as Record<string, unknown>).actual_guests).toBeUndefined()
    }
  })

  it('el schema del UPDATE distingue ausente de nulo', () => {
    const withId = { ...base, id: '00000000-0000-4000-8000-0000000000ff', kind: 'normal' as const }

    const ausente = updateSalonReservationSchema.safeParse(withId)
    expect(ausente.success).toBe(true)
    // undefined → la action NO toca la columna: la asistencia sobrevive.
    if (ausente.success) expect(ausente.data.actual_guests).toBeUndefined()

    const explicito = updateSalonReservationSchema.safeParse({ ...withId, actual_guests: 18 })
    if (explicito.success) expect(explicito.data.actual_guests).toBe(18)

    const nulo = updateSalonReservationSchema.safeParse({ ...withId, actual_guests: null })
    // null explícito sí borra: es "no sé cuántos vinieron".
    if (nulo.success) expect(nulo.data.actual_guests).toBeNull()
  })
})
