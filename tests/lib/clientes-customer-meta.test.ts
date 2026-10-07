import { describe, expect, it } from 'vitest'
import {
  customerInitials,
  customerSourceLabel,
  REDEMPTION_STATUS,
  relativeDayLabel,
  visitSourceLabel,
} from '@/app/(manager)/[tenantSlug]/clientes/_components/customer-meta'

/** Etiquetas de la lista y la ficha de clientes (kit HUB, lote Personas). */

describe('relativeDayLabel', () => {
  const today = '2026-10-07'

  it('cuenta días del calendario de Córdoba, no del día UTC', () => {
    // 06/10 23:30 en Córdoba es 07/10 02:30 UTC: fue ayer, no hoy.
    expect(relativeDayLabel('2026-10-07T02:30:00Z', today)).toBe('Ayer')
    expect(relativeDayLabel('2026-10-07T12:00:00Z', today)).toBe('Hoy')
  })

  it('días, meses y años', () => {
    expect(relativeDayLabel('2026-09-27T15:00:00Z', today)).toBe('Hace 10 días')
    expect(relativeDayLabel('2026-09-01T15:00:00Z', today)).toBe('Hace 1 mes')
    expect(relativeDayLabel('2026-03-01T15:00:00Z', today)).toBe('Hace 7 meses')
    expect(relativeDayLabel('2025-10-01T15:00:00Z', today)).toBe('Hace 1 año')
    expect(relativeDayLabel('2023-01-01T15:00:00Z', today)).toBe('Hace 3 años')
  })

  it('sin fecha no inventa nada', () => {
    expect(relativeDayLabel(null, today)).toBeNull()
    expect(relativeDayLabel('', today)).toBeNull()
  })
})

describe('etiquetas', () => {
  it('origen del cliente y de la visita en castellano; lo desconocido, tal cual', () => {
    expect(customerSourceLabel('qr')).toBe('Se sumó por QR')
    expect(customerSourceLabel('manual')).toBe('Carga manual')
    expect(customerSourceLabel('otro')).toBe('otro')
    expect(visitSourceLabel('cashier')).toBe('Caja')
    expect(visitSourceLabel('import')).toBe('Importada')
  })

  it('estados de canje con tono y texto (nunca solo color)', () => {
    expect(REDEMPTION_STATUS.pending).toMatchObject({ label: 'Por entregar', tone: 'warning' })
    expect(REDEMPTION_STATUS.delivered).toMatchObject({ label: 'Entregado', tone: 'success' })
    expect(REDEMPTION_STATUS.cancelled).toMatchObject({ label: 'Cancelado', tone: 'neutral' })
  })

  it('iniciales del avatar', () => {
    expect(customerInitials('melina', 'gómez')).toBe('MG')
    expect(customerInitials('', '')).toBe('?')
    expect(customerInitials(null, null)).toBe('?')
  })
})
