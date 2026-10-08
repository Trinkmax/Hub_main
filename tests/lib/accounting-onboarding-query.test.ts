/**
 * `getOnboarding` (WP11): el reporte de «Cómo arrancar» más el día de arranque
 * de los libros, leídos en paralelo. Mientras la función no está en la base
 * devuelve `null` (la guía sin marcas, nunca un error de página).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code: string; message: string } | null }

const db = vi.hoisted(() => ({
  rpc: null as Result | null,
  settings: null as Result | null,
  calls: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      db.calls.push(`rpc:${name}`)
      return db.rpc
    },
    from: (table: string) => {
      db.calls.push(`from:${table}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => db.settings,
      }
      return chain
    },
  }),
}))

import { getOnboarding } from '@/lib/accounting/queries/onboarding'

const REPORT = {
  today: '2026-10-15',
  sas_missing: [],
  bank_with_cbu: true,
  wallet_with_cvu: true,
  sales_methods: 4,
  sales_points: 1,
  opening_done: true,
  partner_granted: true,
  accountant_added: true,
  arca: null,
  arca_vouchers_attention: 0,
  mp: null,
  imports: {},
  mc_prev_month_covered: false,
  recurring_active: 3,
  daily_close_missing: 0,
  mp_invoice_this_month: false,
  treasuries_unchecked: 0,
  prev_month_closed: false,
  manual: [],
}

beforeEach(() => {
  db.calls = []
  db.rpc = { data: REPORT, error: null }
  db.settings = { data: { books_start_date: '2026-10-01' }, error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('getOnboarding', () => {
  it('el reporte y el día de arranque de los libros, en paralelo', async () => {
    const result = await getOnboarding('tenant-1')
    expect(db.calls.sort()).toEqual(['from:acc_settings', 'rpc:acc_report_onboarding'])
    expect(result?.data.booksStartDate).toBe('2026-10-01')
    // Los libros arrancan en octubre: no hay mes para cerrar todavía.
    expect(result?.state.items.find((i) => i.id === 'month_close')?.status).toBe('done')
  })

  it('sin la función en la base (migración sin aplicar): null, sin tirar', async () => {
    db.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(getOnboarding('tenant-1')).resolves.toBeNull()
  })

  it('otro error de lectura sí se informa (la página muestra «Reintentar»)', async () => {
    db.settings = { data: null, error: { code: '57014', message: 'canceling statement' } }
    await expect(getOnboarding('tenant-1')).rejects.toMatchObject({ name: 'AccQueryError' })
  })

  it('un reporte que no se puede leer es un error, no una guía vacía', async () => {
    db.rpc = { data: { today: 'mañana' }, error: null }
    await expect(getOnboarding('tenant-1')).rejects.toMatchObject({ name: 'AccQueryError' })
  })

  it('sin fila de ajustes, el día de arranque queda vacío', async () => {
    db.settings = { data: null, error: null }
    const result = await getOnboarding('tenant-1')
    expect(result?.data.booksStartDate).toBeNull()
    expect(result?.state.items.find((i) => i.id === 'month_close')?.status).toBe('todo')
  })
})
