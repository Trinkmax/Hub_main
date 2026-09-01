import { describe, expect, it } from 'vitest'
import { summarizeDayCovers } from '@/lib/salon/covers'
import type { DayCapacityBucket } from '@/lib/salon/types'

/** Helper para armar buckets tal como los devuelve `evaluate_day_capacity`. */
function bucket(name: string, used: number, capacity: number): DayCapacityBucket {
  return { bucket: name, used, capacity, available: Math.max(capacity - used, 0) }
}

describe('summarizeDayCovers', () => {
  it('suma salón + eventos en el total del día', () => {
    const r = summarizeDayCovers([
      bucket('zone:planta_alta', 30, 60),
      bucket('zone:planta_baja', 0, 70),
      bucket('zone:event_floating', 12, 0),
      bucket('event:sushi', 12, 40),
    ])
    // El bug original: acá daba 30 y el dueño veía 30 en vez de 42.
    expect(r).toEqual({ used: 42, total: 130, salon: 30, eventos: 12 })
  })

  it('ignora los buckets de evento para no contar dos veces', () => {
    // Una reserva de 8 sentada en planta baja PERO atada a un evento aparece en
    // los dos ejes a propósito. El contador del día tiene que verla una sola vez.
    const r = summarizeDayCovers([
      bucket('zone:planta_alta', 0, 60),
      bucket('zone:planta_baja', 8, 70),
      bucket('zone:event_floating', 0, 0),
      bucket('event:cumple', 8, 20),
    ])
    expect(r.used).toBe(8)
    expect(r.salon).toBe(8)
    expect(r.eventos).toBe(0)
  })

  it('un día sin eventos deja el desglose en cero', () => {
    const r = summarizeDayCovers([
      bucket('zone:planta_alta', 14, 60),
      bucket('zone:planta_baja', 6, 70),
      bucket('zone:event_floating', 0, 0),
    ])
    expect(r).toEqual({ used: 20, total: 130, salon: 20, eventos: 0 })
  })

  it('tolera que falte algún bucket (día sin overrides ni eventos)', () => {
    const r = summarizeDayCovers([bucket('zone:planta_alta', 5, 60)])
    expect(r).toEqual({ used: 5, total: 60, salon: 5, eventos: 0 })
  })

  it('sin buckets devuelve todo en cero', () => {
    expect(summarizeDayCovers([])).toEqual({ used: 0, total: 0, salon: 0, eventos: 0 })
  })

  it('el tope es solo el físico: los cubiertos de evento pueden pasarlo', () => {
    const r = summarizeDayCovers([
      bucket('zone:planta_alta', 50, 60),
      bucket('zone:planta_baja', 60, 70),
      bucket('zone:event_floating', 30, 0),
    ])
    expect(r.used).toBe(140)
    expect(r.total).toBe(130)
    expect(r.used > r.total).toBe(true)
  })
})
