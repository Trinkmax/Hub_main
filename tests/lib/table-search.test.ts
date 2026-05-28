import { describe, expect, it } from 'vitest'
import type { SalonTableRow } from '@/lib/sessions-waiter/queries'
import { filterTables, matchesQuery, normalize } from '@/lib/sessions-waiter/table-search'

function mkTable(partial: Partial<SalonTableRow> = {}): SalonTableRow {
  return {
    physical_table_id: 'pt-1',
    label: 'Mesa 1',
    capacity: null,
    session: null,
    ...partial,
  }
}

function mkActive(label: string, alias: string | null, customers: string[] = []): SalonTableRow {
  return mkTable({
    label,
    session: {
      id: `s-${label}`,
      opened_at: new Date().toISOString(),
      party_size: 2,
      alias,
      customer_names: customers,
      total_cents: 0,
      guest_count: customers.length,
      pending_tickets: 0,
      bill_requested: false,
    },
  })
}

describe('normalize', () => {
  it('quita acentos y baja a minúsculas', () => {
    expect(normalize('María')).toBe('maria')
    expect(normalize('NÚÑEZ')).toBe('nunez')
    expect(normalize('  Café  ')).toBe('cafe')
  })

  it('preserva espacios internos', () => {
    expect(normalize('Cumple de Juan')).toBe('cumple de juan')
  })
})

describe('matchesQuery', () => {
  it('query vacío matchea todo', () => {
    expect(matchesQuery(mkTable(), '')).toBe(true)
    expect(matchesQuery(mkTable(), '   ')).toBe(true)
  })

  it('matchea por label de mesa libre', () => {
    expect(matchesQuery(mkTable({ label: 'Mesa 5' }), 'mesa 5')).toBe(true)
    expect(matchesQuery(mkTable({ label: 'Mesa 5' }), '5')).toBe(true)
    expect(matchesQuery(mkTable({ label: 'Barra 1' }), 'barra')).toBe(true)
  })

  it('matchea por alias de sesión activa', () => {
    const t = mkActive('Mesa 3', 'Cumple de Juan')
    expect(matchesQuery(t, 'cumple')).toBe(true)
    expect(matchesQuery(t, 'juan')).toBe(true)
    expect(matchesQuery(t, 'CUMPLE')).toBe(true)
  })

  it('matchea por nombre de cliente registrado', () => {
    const t = mkActive('Mesa 7', null, ['María García', 'Carlos Pérez'])
    expect(matchesQuery(t, 'maria')).toBe(true)
    expect(matchesQuery(t, 'garcia')).toBe(true)
    expect(matchesQuery(t, 'perez')).toBe(true)
    expect(matchesQuery(t, 'carlos pérez')).toBe(true)
  })

  it('ignora acentos en ambos lados de la comparación', () => {
    const t = mkActive('Mesa 7', null, ['María Núñez'])
    expect(matchesQuery(t, 'maria nunez')).toBe(true)
    expect(matchesQuery(t, 'núñez')).toBe(true)
  })

  it('no matchea cuando el query no se encuentra', () => {
    const t = mkActive('Mesa 2', 'Aniversario', ['Pedro'])
    expect(matchesQuery(t, 'cumple')).toBe(false)
    expect(matchesQuery(t, 'ana')).toBe(false)
  })

  it('mesa libre no matchea por alias ni cliente (no tiene sesión)', () => {
    expect(matchesQuery(mkTable({ label: 'Mesa 9' }), 'cumple')).toBe(false)
  })
})

describe('filterTables', () => {
  const tables: SalonTableRow[] = [
    mkTable({ label: 'Mesa 1' }),
    mkActive('Mesa 2', 'Cumple de Juan'),
    mkActive('Mesa 3', null, ['Ana Pereira']),
    mkActive('Mesa 14', 'Cumple de Juan', ['Pedro']),
    mkActive('Barra 1', null),
  ]

  it('query vacío devuelve todas', () => {
    expect(filterTables(tables, '')).toHaveLength(tables.length)
  })

  it('alias compartido (cumple de juan) trae todas las mesas del grupo', () => {
    const r = filterTables(tables, 'cumple')
    expect(r.map((t) => t.label)).toEqual(['Mesa 2', 'Mesa 14'])
  })

  it('por número trae la mesa puntual', () => {
    const r = filterTables(tables, 'barra')
    expect(r).toHaveLength(1)
    expect(r[0]?.label).toBe('Barra 1')
  })

  it('por cliente trae solo donde matchea', () => {
    const r = filterTables(tables, 'ana')
    expect(r).toHaveLength(1)
    expect(r[0]?.label).toBe('Mesa 3')
  })
})
