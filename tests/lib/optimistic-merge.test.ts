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
