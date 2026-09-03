import { describe, expect, it } from 'vitest'
import { type AnyRealtimePayload, mergeRow } from '@/lib/realtime/optimistic-merge'

type Ticket = { id: string; status: 'open' | 'closed'; total: number }

const t1: Ticket = { id: '1', status: 'open', total: 100 }
const t2: Ticket = { id: '2', status: 'open', total: 200 }
const initial: Ticket[] = [t1, t2]

const id = (t: Ticket) => t.id

describe('mergeRow', () => {
  it('INSERT agrega el nuevo row', () => {
    const payload: AnyRealtimePayload = {
      eventType: 'INSERT',
      new: { id: '3', status: 'open', total: 300 },
    }
    expect(mergeRow(initial, payload, id)).toHaveLength(3)
  })

  it('INSERT ignora duplicados (idempotente)', () => {
    const payload: AnyRealtimePayload = {
      eventType: 'INSERT',
      new: { id: '1', status: 'open', total: 100 },
    }
    expect(mergeRow(initial, payload, id)).toHaveLength(2)
  })

  it('UPDATE reemplaza el row existente', () => {
    const payload: AnyRealtimePayload = {
      eventType: 'UPDATE',
      new: { id: '1', status: 'closed', total: 150 },
      old: { id: '1' },
    }
    const result = mergeRow(initial, payload, id)
    expect(result).toHaveLength(2)
    expect(result.find((t) => t.id === '1')?.total).toBe(150)
  })

  it('DELETE remueve el row por old.id', () => {
    const payload: AnyRealtimePayload = {
      eventType: 'DELETE',
      old: { id: '1' },
    }
    const result = mergeRow(initial, payload, id)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('2')
  })

  it('DELETE sin old.id es no-op', () => {
    const payload: AnyRealtimePayload = { eventType: 'DELETE', old: {} }
    expect(mergeRow(initial, payload, id)).toEqual(initial)
  })

  it('accept=false en INSERT/UPDATE remueve el row (filtro virtual)', () => {
    const payload: AnyRealtimePayload = {
      eventType: 'UPDATE',
      new: { id: '1', status: 'closed', total: 100 },
      old: { id: '1' },
    }
    const accept = (t: Ticket) => t.status === 'open'
    const result = mergeRow(initial, payload, id, accept)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('2')
  })

  it('UPDATE de un row no-presente lo agrega si pasa el filter', () => {
    // Caso: el ticket cambió a "open" desde "closed" — antes no estaba en la
    // vista, ahora sí.
    const payload: AnyRealtimePayload = {
      eventType: 'UPDATE',
      new: { id: '99', status: 'open', total: 400 },
      old: { id: '99' },
    }
    const result = mergeRow(initial, payload, id, (t: Ticket) => t.status === 'open')
    expect(result).toHaveLength(3)
    expect(result.find((t) => t.id === '99')).toBeTruthy()
  })

  it('payload sin new ni old (corrupto) es no-op', () => {
    const payload: AnyRealtimePayload = { eventType: 'INSERT' }
    expect(mergeRow(initial, payload, id)).toEqual(initial)
  })
})

describe('mergeRow — UPDATE conserva los joins', () => {
  // Realtime manda solo las columnas de la tabla. Si el UPDATE reemplazara la
  // fila entera, el mozo tocaría "Llegó" y perdería de esa tarjeta el gestor,
  // el color del evento y el aviso "SIN TACC" que venía de la ficha del cliente.
  type Row = {
    id: string
    status: string
    customer: { id: string; service_alerts: string[] } | null
    primary_manager: { display_name: string } | null
  }

  const existing: Row = {
    id: 'r1',
    status: 'pending',
    customer: { id: 'c1', service_alerts: ['celiac'] },
    primary_manager: { display_name: 'Luz' },
  }

  it('el payload crudo pisa las columnas pero no borra los joins', () => {
    const out = mergeRow<Row>(
      [existing],
      {
        eventType: 'UPDATE',
        new: { id: 'r1', status: 'arrived' } as unknown as Row,
        old: {},
      } as never,
      (r) => r.id,
    )
    expect(out[0]?.status).toBe('arrived')
    expect(out[0]?.customer?.service_alerts).toEqual(['celiac'])
    expect(out[0]?.primary_manager?.display_name).toBe('Luz')
  })

  it('una columna que sí viene en el payload se actualiza', () => {
    const out = mergeRow<Row>(
      [existing],
      {
        eventType: 'UPDATE',
        new: { id: 'r1', status: 'seated', customer: null } as unknown as Row,
        old: {},
      } as never,
      (r) => r.id,
    )
    // `customer` vino explícito en el payload: gana el payload.
    expect(out[0]?.customer).toBeNull()
  })
})
