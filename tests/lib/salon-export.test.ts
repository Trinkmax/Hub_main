import { describe, expect, it } from 'vitest'
import {
  EXPORT_HEADERS,
  exportFilename,
  reservationsToCsv,
  reservationToExportRow,
  sortForExport,
} from '@/lib/salon/export'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { csvEscape, rowsToCsv } from '@/lib/stats/csv'

function reservation(over: Partial<ReservationWithJoins> = {}): ReservationWithJoins {
  return {
    id: 'r1',
    tenant_id: 't',
    customer_id: null,
    guest_name: 'Adriana Carranza',
    guest_phone: '+5493515551234',
    guest_email: null,
    kind: 'normal',
    meal_type: 'dinner',
    reservation_date: '2026-09-05',
    reservation_time_local: '21:00:00',
    reservation_end_time_local: null,
    zone: 'planta_alta',
    scheduled_event_id: null,
    estimated_guests: 20,
    actual_guests: null,
    cake_count: 0,
    cake_option_id: null,
    champagne_count: 0,
    deposit_cents: 0,
    origin: 'whatsapp',
    primary_manager_id: 'm1',
    assistant_manager_id: null,
    comments: null,
    service_alerts: [],
    highlight_comment: false,
    table_label: null,
    status: 'pending',
    arrived_at: null,
    seated_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    arrived_by: null,
    seated_by: null,
    closed_by: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    primary_manager: { id: 'm1', display_name: 'Luz' },
    assistant_manager: null,
    scheduled_event: null,
    customer: null,
    cake_option: null,
    ...over,
  }
}

describe('sortForExport', () => {
  it('ordena por fecha, hora y nombre (sin importar mayúsculas ni tildes)', () => {
    const rows = [
      reservation({ id: 'c', reservation_time_local: '21:00:00', guest_name: 'zoe' }),
      reservation({ id: 'b', reservation_time_local: '21:00:00', guest_name: 'Álvaro' }),
      reservation({ id: 'e', reservation_date: '2026-09-06', reservation_time_local: '13:00:00' }),
      reservation({ id: 'a', reservation_time_local: '13:30:00', guest_name: 'Beto' }),
      reservation({ id: 'd', reservation_time_local: '00:30:00', guest_name: 'Trasnoche' }),
    ]
    expect(sortForExport(rows).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('no muta el array original', () => {
    const rows = [
      reservation({ id: 'b', guest_name: 'B' }),
      reservation({ id: 'a', guest_name: 'A' }),
    ]
    sortForExport(rows)
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('reservationToExportRow', () => {
  it('una fila por columna, con las palabras del bar', () => {
    const row = reservationToExportRow(
      reservation({
        reservation_end_time_local: '23:30:00',
        actual_guests: 18,
        table_label: '12+13',
        kind: 'birthday',
        cake_count: 2,
        cake_option: { id: 'k', name: 'Opción 2', base: 'Chocolate', fillings: ['Dulce de leche'] },
        champagne_count: 1,
        deposit_cents: 1250000,
        assistant_manager: { id: 'm2', display_name: 'Tomás' },
        status: 'arrived',
        service_alerts: ['celiac'],
        comments: 'Silla de ruedas\n  eléctrica',
        arrived_at: '2026-09-06T00:05:00Z',
        scheduled_event: {
          id: 'ev',
          capacity: 140,
          starts_at_local: '21:00:00',
          meal_type: 'dinner',
          template: {
            id: 'tpl',
            name: 'Pizza libre',
            slug: 'pizza',
            color_hex: '#e11d48',
            consume_special_reservations: true,
          },
        },
      }),
    )
    expect(row).toHaveLength(EXPORT_HEADERS.length)
    expect(row).toEqual([
      '05/09/2026',
      '21:00',
      '23:30',
      'Adriana Carranza',
      '+5493515551234',
      '20',
      '18',
      'Cena',
      'Planta Alta',
      'Pizza libre',
      '12+13',
      'Cumpleaños',
      '2 × Opción 2 · Chocolate con Dulce de leche',
      '1',
      '12500', // pesos, no centavos
      'WhatsApp Hub',
      'Luz',
      'Tomás',
      'Llegó',
      'Celíaco/a',
      'Silla de ruedas eléctrica',
      '21:05', // hora de Córdoba
    ])
  })

  it('lo que no está queda vacío, no "null"', () => {
    const row = reservationToExportRow(reservation({ guest_phone: null }))
    expect(row.filter((c) => c === '')).toHaveLength(13)
    expect(row.join('')).not.toContain('null')
    expect(row.join('')).not.toContain('undefined')
  })

  it('prefiere el teléfono de la ficha del socio y suma sus avisos', () => {
    const row = reservationToExportRow(
      reservation({
        guest_phone: '+5493510000000',
        customer: {
          id: 'c1',
          first_name: 'A',
          last_name: 'B',
          phone: '+5493519999999',
          service_alerts: ['reduced_mobility'],
          points_balance: 0,
          tier: null,
        },
      }),
    )
    expect(row[4]).toBe('+5493519999999')
    expect(row[19]).toBe('Movilidad reducida')
  })
})

describe('reservationsToCsv', () => {
  it('arranca con BOM, separa con ; y escapa lo que lleva ; o comillas', () => {
    const csv = reservationsToCsv([
      reservation({ guest_name: 'García; "El Tano"', comments: 'sin cebolla; con queso' }),
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [header, line] = csv.slice(1).split('\r\n')
    expect(header?.startsWith('Fecha;Hora;Hasta;Cliente')).toBe(true)
    expect(line).toContain('"García; ""El Tano"""')
    expect(line).toContain('"sin cebolla; con queso"')
  })

  it('el CSV viejo (stats) sigue igual: coma, sin BOM, LF', () => {
    expect(rowsToCsv(['a', 'b'], [['1', 'x,y']])).toBe('a,b\n1,"x,y"')
    expect(csvEscape('a;b')).toBe('a;b')
    expect(csvEscape('a;b', ';')).toBe('"a;b"')
  })
})

describe('exportFilename', () => {
  it('día, rango o todas', () => {
    expect(exportFilename('hub', { from: '2026-09-05', to: '2026-09-05' })).toBe(
      'reservas-hub-2026-09-05.csv',
    )
    expect(exportFilename('hub', { from: '2026-09-01', to: '2026-09-30' })).toBe(
      'reservas-hub-2026-09-01_2026-09-30.csv',
    )
    expect(exportFilename('hub', {})).toBe('reservas-hub-todas.csv')
  })
})
