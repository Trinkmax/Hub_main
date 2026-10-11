import { describe, expect, it } from 'vitest'
import {
  formatInstagramHandle,
  instagramProfileUrl,
  instagramSearchTerm,
  parseInstagramHandle,
} from '@/lib/salon/instagram'
import { matchesQuery } from '@/lib/salon/operativo'
import { createSalonReservationSchema, updateSalonReservationSchema } from '@/lib/salon/schemas'
import { fullUpdatePayload } from '@/lib/salon/update-payload'

const baseValid = {
  guest_name: 'Juan Pérez',
  meal_type: 'dinner',
  reservation_date: '2026-10-17',
  reservation_time_local: '21:30',
  zone: 'planta_alta',
  estimated_guests: 4,
  primary_manager_id: '00000000-0000-4000-8000-000000000001',
}

describe('parseInstagramHandle', () => {
  it('acepta el usuario con o sin arroba y lo deja en minúsculas', () => {
    expect(parseInstagramHandle('@Juan.Perez')).toBe('juan.perez')
    expect(parseInstagramHandle('  juan_perez99 ')).toBe('juan_perez99')
  })

  it('del link del perfil se queda con el usuario', () => {
    expect(parseInstagramHandle('https://www.instagram.com/Juan.Perez/?igsh=abc')).toBe(
      'juan.perez',
    )
    expect(parseInstagramHandle('instagram.com/juan.perez')).toBe('juan.perez')
  })

  it('lo que no es un usuario no pasa', () => {
    expect(parseInstagramHandle('')).toBeNull()
    expect(parseInstagramHandle('juan perez')).toBeNull()
    expect(parseInstagramHandle('juán')).toBeNull()
    expect(parseInstagramHandle('a'.repeat(31))).toBeNull()
    // El link a una publicación no es un perfil.
    expect(parseInstagramHandle('https://www.instagram.com/p/Cabc123/')).toBeNull()
  })

  it('arma la arroba y el link del perfil', () => {
    expect(formatInstagramHandle('juan.perez')).toBe('@juan.perez')
    expect(instagramProfileUrl('juan.perez')).toBe('https://www.instagram.com/juan.perez/')
  })
})

describe('instagramSearchTerm', () => {
  it('una palabra sola puede ser un usuario; varias palabras o tildes, no', () => {
    expect(instagramSearchTerm('@Juan.Perez')).toBe('juan.perez')
    expect(instagramSearchTerm('lop')).toBe('lop')
    expect(instagramSearchTerm('Ana López')).toBeNull()
    expect(instagramSearchTerm('lópez')).toBeNull()
    expect(instagramSearchTerm('a')).toBeNull()
    // Nada que pueda romper un or() de PostgREST.
    expect(instagramSearchTerm('a,b)')).toBeNull()
  })
})

describe('Instagram en la reserva', () => {
  it('la reserva se guarda solo con Instagram, sin teléfono', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      guest_instagram: '@Juan.Perez',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.guest_instagram).toBe('juan.perez')
      expect(r.data.guest_phone ?? null).toBeNull()
    }
  })

  it('vacío es «sin Instagram»; ausente no toca la columna', () => {
    const empty = updateSalonReservationSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      ...baseValid,
      kind: 'normal',
      origin: 'instagram',
      guest_instagram: '',
    })
    expect(empty.success && empty.data.guest_instagram).toBeNull()

    const absent = updateSalonReservationSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      ...baseValid,
      kind: 'normal',
      origin: 'instagram',
    })
    expect(absent.success).toBe(true)
    if (absent.success) expect(absent.data.guest_instagram).toBeUndefined()
  })

  it('un usuario inválido frena el guardado y dice en qué campo', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      guest_instagram: 'juan perez',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['guest_instagram'])
  })

  it('editar otra cosa desde una pantalla chica no lo borra', () => {
    const payload = fullUpdatePayload(
      { guest_instagram: 'juan.perez', reservation_time_local: '21:30:00' } as never,
      { estimated_guests: 6 },
    )
    expect(payload.guest_instagram).toBe('juan.perez')
  })

  it('la anfitriona la encuentra por el usuario, con o sin arroba', () => {
    const r = {
      guest_name: 'Juan',
      guest_phone: null,
      guest_instagram: 'juan.perez',
      table_label: null,
      customer: null,
      primary_manager: null,
    }
    expect(matchesQuery(r, '@juan.perez')).toBe(true)
    expect(matchesQuery(r, 'perez')).toBe(true)
    expect(matchesQuery(r, 'gomez')).toBe(false)
  })
})
