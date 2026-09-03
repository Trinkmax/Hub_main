import { describe, expect, it } from 'vitest'
import {
  bulkActualGuestsSchema,
  cancelReservationSchema,
  createSalonReservationSchema,
  rateTierSchema,
  scheduledEventSchema,
  transitionStatusSchema,
  updateSalonReservationSchema,
} from '@/lib/salon/schemas'

const baseValid = {
  guest_name: 'Juan Test',
  meal_type: 'dinner' as const,
  reservation_date: '2026-06-01',
  reservation_time_local: '21:30',
  zone: 'planta_alta' as const,
  estimated_guests: 4,
  origin: 'whatsapp' as const,
  primary_manager_id: '00000000-0000-4000-8000-000000000001',
}

describe('bulkActualGuestsSchema — "Pasar lista"', () => {
  const entry = (n: number) => ({ id: '00000000-0000-4000-8000-00000000000a', actual_guests: n })

  it('camino feliz', () => {
    const r = bulkActualGuestsSchema.safeParse({ entries: [entry(18)] })
    expect(r.success).toBe(true)
  })

  it('lista vacía → error, no un guardado silencioso de nada', () => {
    expect(bulkActualGuestsSchema.safeParse({ entries: [] }).success).toBe(false)
  })

  it('cero personas se rechaza: eso es "no vino", no una mesa de cero', () => {
    expect(bulkActualGuestsSchema.safeParse({ entries: [entry(0)] }).success).toBe(false)
  })

  it('más de 99 por reserva se rechaza', () => {
    expect(bulkActualGuestsSchema.safeParse({ entries: [entry(120)] }).success).toBe(false)
  })

  it('tope de 200 filas: es un endpoint público y cada fila es una llamada al RPC', () => {
    const many = Array.from({ length: 201 }, () => entry(2))
    expect(bulkActualGuestsSchema.safeParse({ entries: many }).success).toBe(false)
    const ok = Array.from({ length: 200 }, () => entry(2))
    expect(bulkActualGuestsSchema.safeParse({ entries: ok }).success).toBe(true)
  })

  it('un id que no es uuid se rechaza', () => {
    expect(
      bulkActualGuestsSchema.safeParse({ entries: [{ id: 'nope', actual_guests: 2 }] }).success,
    ).toBe(false)
  })
})

describe('createSalonReservationSchema', () => {
  it('camino feliz', () => {
    const r = createSalonReservationSchema.safeParse(baseValid)
    expect(r.success).toBe(true)
  })

  it('event_floating sin scheduled_event_id → error', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      zone: 'event_floating',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('evento programado'))).toBe(true)
    }
  })

  it('event_floating con scheduled_event_id → OK', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      zone: 'event_floating',
      scheduled_event_id: '00000000-0000-4000-8000-0000000000aa',
    })
    expect(r.success).toBe(true)
  })

  it('asistente == primario → error', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      assistant_manager_id: baseValid.primary_manager_id,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('asistente'))).toBe(true)
    }
  })

  it('teléfono inválido → error', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      guest_phone: '12',
    })
    expect(r.success).toBe(false)
  })

  it('teléfono AR sin código → normaliza a E.164', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      guest_phone: '3515551234',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.guest_phone?.startsWith('+')).toBe(true)
    }
  })

  it('horario sin segundos → normaliza con :00', () => {
    const r = createSalonReservationSchema.safeParse({ ...baseValid })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.reservation_time_local).toBe('21:30:00')
    }
  })

  describe('horario de fin (opcional)', () => {
    it('sin la clave → queda undefined, la action no toca la columna', () => {
      const r = createSalonReservationSchema.safeParse({ ...baseValid })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reservation_end_time_local).toBeUndefined()
    })

    it('cargado → normaliza con :00', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        reservation_end_time_local: '00:30',
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reservation_end_time_local).toBe('00:30:00')
    })

    it('vacío (input time sin completar) → null, no error', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        reservation_end_time_local: '',
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reservation_end_time_local).toBeNull()
    })

    it('null explícito → null', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        reservation_end_time_local: null,
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.reservation_end_time_local).toBeNull()
    })

    it('antes del inicio → válido: es la madrugada del día siguiente', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        reservation_time_local: '21:30',
        reservation_end_time_local: '00:30',
      })
      expect(r.success).toBe(true)
    })

    it('basura → error', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        reservation_end_time_local: '25:99',
      })
      expect(r.success).toBe(false)
    })

    it('en el update se comporta igual: ausente ≠ vacío', () => {
      const base = {
        ...baseValid,
        id: '00000000-0000-4000-8000-0000000000ff',
        kind: 'normal' as const,
      }
      const sin = updateSalonReservationSchema.safeParse(base)
      expect(sin.success).toBe(true)
      if (sin.success) expect(sin.data.reservation_end_time_local).toBeUndefined()

      const vacio = updateSalonReservationSchema.safeParse({
        ...base,
        reservation_end_time_local: '',
      })
      expect(vacio.success).toBe(true)
      if (vacio.success) expect(vacio.data.reservation_end_time_local).toBeNull()
    })
  })

  describe('avisos de servicio', () => {
    it('sin la clave → undefined, la action no toca la columna', () => {
      const r = createSalonReservationSchema.safeParse({ ...baseValid })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.service_alerts).toBeUndefined()
    })

    it('array → tal cual', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        service_alerts: ['celiac', 'baby_seat'],
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.service_alerts).toEqual(['celiac', 'baby_seat'])
    })

    it('un solo chip marcado llega como string suelto y se envuelve', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        service_alerts: 'celiac',
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.service_alerts).toEqual(['celiac'])
    })

    it('vacío → array vacío (el usuario los desmarcó todos)', () => {
      const r = createSalonReservationSchema.safeParse({ ...baseValid, service_alerts: '' })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.service_alerts).toEqual([])
    })

    it('un valor que no está en el enum → error, no se traga en silencio', () => {
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        service_alerts: ['gluten_free_maybe'],
      })
      expect(r.success).toBe(false)
    })

    it('highlight_comment: el string "false" de un FormData NO es true', () => {
      // z.coerce.boolean() daría true acá, que es justo el bug que evitamos.
      const r = createSalonReservationSchema.safeParse({
        ...baseValid,
        highlight_comment: 'false',
      })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.highlight_comment).toBe(false)
    })

    it('highlight_comment: "on" y true son true; ausente es undefined', () => {
      const on = createSalonReservationSchema.safeParse({ ...baseValid, highlight_comment: 'on' })
      expect(on.success && on.data.highlight_comment).toBe(true)
      const bool = createSalonReservationSchema.safeParse({ ...baseValid, highlight_comment: true })
      expect(bool.success && bool.data.highlight_comment).toBe(true)
      const none = createSalonReservationSchema.safeParse({ ...baseValid })
      expect(none.success && none.data.highlight_comment).toBeUndefined()
    })
  })

  it('estimated_guests > 99 → error', () => {
    const r = createSalonReservationSchema.safeParse({ ...baseValid, estimated_guests: 200 })
    expect(r.success).toBe(false)
  })

  it('cake_count fuera de [0,2] → error', () => {
    const r = createSalonReservationSchema.safeParse({ ...baseValid, cake_count: 5 })
    expect(r.success).toBe(false)
  })
})

describe('updateSalonReservationSchema', () => {
  it('permite actual_guests', () => {
    const r = updateSalonReservationSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      ...baseValid,
      kind: 'normal',
      actual_guests: 5,
    })
    expect(r.success).toBe(true)
  })

  it('actual_guests null → OK', () => {
    const r = updateSalonReservationSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      ...baseValid,
      kind: 'normal',
      actual_guests: null,
    })
    expect(r.success).toBe(true)
  })
})

describe('transitionStatusSchema', () => {
  it('to=closed con actual_guests', () => {
    const r = transitionStatusSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      to: 'closed',
      actual_guests: 6,
    })
    expect(r.success).toBe(true)
  })

  it('to=arrived sin actual_guests', () => {
    const r = transitionStatusSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      to: 'arrived',
    })
    expect(r.success).toBe(true)
  })

  it('to inválido → error', () => {
    const r = transitionStatusSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      to: 'whatever',
    })
    expect(r.success).toBe(false)
  })
})

describe('cancelReservationSchema', () => {
  it('reason opcional', () => {
    const r = cancelReservationSchema.safeParse({ id: '00000000-0000-4000-8000-000000000099' })
    expect(r.success).toBe(true)
  })
})

describe('scheduledEventSchema', () => {
  it('camino feliz', () => {
    const r = scheduledEventSchema.safeParse({
      template_id: '00000000-0000-4000-8000-000000000010',
      event_date: '2026-06-15',
      starts_at_local: '21:00',
      capacity: 40,
      meal_type: 'dinner',
    })
    expect(r.success).toBe(true)
  })
})

describe('rateTierSchema', () => {
  it('max_guests vacío → null', () => {
    const r = rateTierSchema.safeParse({
      meal_type: 'dinner',
      min_guests: 31,
      max_guests: '',
      rate_per_guest_cents: 14000,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.max_guests).toBeNull()
  })
})
