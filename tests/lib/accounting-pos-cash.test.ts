import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissPosCash, linkPosCash, loadPosCash } from '@/lib/accounting/actions/pos-cash'
import {
  isPayrollPurpose,
  type PosCashPending,
  parsePosCashPending,
  posCashCountWords,
  posCashDate,
  posCashFor,
  posCashIdSchema,
  posCashLinkSchema,
  posCashMonth,
  posCashNote,
  posCashTotalCents,
  posCashTreasuryId,
  posCashWho,
} from '@/lib/accounting/pos-cash'
import { listPosCashPending } from '@/lib/accounting/queries/pos-cash'

/**
 * Lo que salió de la caja del salón y espera su comprobante (pedido de los socios, 22/11/2026): lo
 * puro (leer la lista, a qué bandeja va cada retiro, qué caja y qué fecha se proponen) y las acciones
 * (atar, descartar, traer uno). La base decide qué ve y qué toca cada persona; acá se prueba que se le
 * pide bien y que nada se guarda si algo falla.
 */

const SLUG = 'hub'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  denied: false,
  needs: [] as string[],
  revalidate: vi.fn(),
}))

vi.mock('@/lib/accounting/access', () => ({
  authorizeAccounting: vi.fn(async (_slug: string, need: string) => {
    db.needs.push(need)
    return db.denied
      ? { ok: false, state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' } }
      : { ok: true, tenantId: 'tenant-1' }
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: db.rpc }),
}))
vi.mock('@/lib/accounting/server/post-document', () => ({
  afterCommit: (_op: string, run: () => unknown) => run(),
  revalidateAdministracion: db.revalidate,
  logFailure: vi.fn(),
  errorName: () => 'error',
}))

beforeEach(() => {
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ data: null, error: null })
  db.revalidate.mockReset()
  db.denied = false
  db.needs = []
})

const RAW = {
  id: uuid(500),
  at: '2026-11-22T23:10:00+00:00',
  date: '2026-11-22',
  shift_label: 'Noche',
  branch_id: uuid(40),
  branch: 'Cerro',
  purpose: 'advance',
  // `bigint` puede venir como texto.
  amount_cents: '5000000',
  reason: 'Adelanto de sueldo · Martina Ríos',
  party_id: null,
  party_name: null,
  employee_id: uuid(1),
  employee_name: 'Martina Ríos',
  period_from: null,
  period_to: null,
  by_name: ' Luz ',
  has_photo: false,
}

const item = (over: Partial<PosCashPending> = {}): PosCashPending => ({
  id: uuid(500),
  at: '2026-11-22T23:10:00+00:00',
  date: '2026-11-22',
  shiftLabel: 'Noche',
  branchId: uuid(40),
  branchName: 'Cerro',
  purpose: 'advance',
  amountCents: 5_000_000,
  reason: 'Adelanto de sueldo · Martina Ríos',
  partyId: null,
  partyName: null,
  employeeId: uuid(1),
  employeeName: 'Martina Ríos',
  periodFrom: null,
  periodTo: null,
  byName: 'Luz',
  hasPhoto: false,
  ...over,
})

describe('lo que devuelve `acc_pos_cash_pending`', () => {
  it('lo pasa a la bandeja', () => {
    expect(parsePosCashPending([RAW])).toEqual([item()])
  })

  it('un pago a un proveedor anotado a mano viene con el nombre y sin id', () => {
    const [supplier] = parsePosCashPending([
      {
        ...RAW,
        id: uuid(501),
        purpose: 'supplier',
        employee_id: null,
        employee_name: null,
        party_name: 'Verdulero de la esquina',
        reason: 'Proveedor · Verdulero de la esquina',
        has_photo: true,
        period_from: '2026-13-01',
      },
    ])
    expect(supplier).toMatchObject({
      purpose: 'supplier',
      partyId: null,
      partyName: 'Verdulero de la esquina',
      employeeId: null,
      hasPhoto: true,
      // Una fecha que no existe no se inventa.
      periodFrom: null,
    })
  })

  it('un renglón que no se entiende se saltea; lo que no es una lista, nada', () => {
    expect(
      parsePosCashPending([
        RAW,
        { ...RAW, id: 'x' },
        { ...RAW, id: uuid(2), purpose: 'regalo' },
        { ...RAW, id: uuid(3), amount_cents: 0 },
        { ...RAW, id: uuid(4), date: '2026-02-30' },
        null,
      ]),
    ).toHaveLength(1)
    expect(parsePosCashPending(null)).toEqual([])
    expect(parsePosCashPending({ rows: [RAW] })).toEqual([])
  })
})

describe('a qué bandeja va cada retiro', () => {
  const list = [
    item({ id: uuid(3), at: '2026-11-23T01:00:00Z', purpose: 'overtime' }),
    item({ id: uuid(1), at: '2026-11-21T22:00:00Z', purpose: 'supplier', employeeId: null }),
    item({ id: uuid(2), at: '2026-11-22T22:00:00Z', purpose: 'salary' }),
    item({ id: uuid(4), at: '2026-11-20T22:00:00Z', purpose: 'advance' }),
  ]

  it('los de proveedores, a Compras; los del personal, a Sueldos; los más viejos primero', () => {
    expect(posCashFor(list, 'suppliers').map((i) => i.id)).toEqual([uuid(1)])
    expect(posCashFor(list, 'payroll').map((i) => i.id)).toEqual([uuid(4), uuid(2), uuid(3)])
    expect(isPayrollPurpose('supplier')).toBe(false)
    expect(isPayrollPurpose('salary')).toBe(true)
  })

  it('cuánto suman, cuántos son y a quién fueron', () => {
    expect(posCashTotalCents(list)).toBe(20_000_000)
    expect(posCashTotalCents([])).toBe(0)
    expect(posCashCountWords(1)).toBe('1 retiro')
    expect(posCashCountWords(3)).toBe('3 retiros')
    expect(posCashWho(item())).toBe('Martina Ríos')
    expect(posCashWho(item({ purpose: 'supplier', partyName: 'Coca-Cola' }))).toBe('Coca-Cola')
    expect(posCashWho(item({ purpose: 'supplier', partyName: null }))).toBe('Proveedor sin nombre')
    expect(posCashMonth(item({ date: '2026-12-03' }))).toBe('2026-12')
  })
})

describe('lo que se escribió en la caja', () => {
  it('es lo que sigue al nombre en el motivo', () => {
    expect(
      posCashNote(
        item({
          purpose: 'supplier',
          partyName: 'Hielo Cristal del Centro SA',
          reason: 'Proveedor · Hielo Cristal del Centro SA · Remito 12',
        }),
      ),
    ).toBe('Remito 12')
    expect(posCashNote(item({ reason: 'Adelanto de sueldo · Martina Ríos · a cuenta' }))).toBe(
      'a cuenta',
    )
  })

  it('sin nota, o con un motivo de otra forma, nada', () => {
    expect(posCashNote(item())).toBeNull()
    // Un proveedor escrito a mano: el nombre es lo escrito.
    expect(
      posCashNote(
        item({
          purpose: 'supplier',
          partyName: 'Verdulero de la esquina',
          reason: 'Proveedor · Verdulero de la esquina',
        }),
      ),
    ).toBeNull()
    expect(posCashNote(item({ reason: 'Hielo' }))).toBeNull()
    expect(posCashNote(item({ employeeName: null }))).toBeNull()
  })
})

describe('con qué se propone el comprobante', () => {
  const treasuries = [
    { id: 'mp', kind: 'wallet', active: true, branchId: null },
    { id: 'caja-alta', kind: 'cash', active: true, branchId: 'alta' },
    { id: 'caja-cerro', kind: 'cash', active: true, branchId: 'cerro' },
    { id: 'caja-vieja', kind: 'cash', active: false, branchId: 'cerro' },
  ]

  it('la caja de efectivo de esa sucursal: de ahí salió la plata', () => {
    expect(posCashTreasuryId(treasuries, 'cerro')).toBe('caja-cerro')
    expect(posCashTreasuryId(treasuries, 'alta')).toBe('caja-alta')
  })

  it('si la sucursal no tiene caja propia, la de efectivo de todo el bar; si no hay, se elige a mano', () => {
    const shared = [...treasuries, { id: 'caja-bar', kind: 'cash', active: true, branchId: null }]
    expect(posCashTreasuryId(shared, 'nueva')).toBe('caja-bar')
    expect(posCashTreasuryId(treasuries, 'nueva')).toBeNull()
    // Nunca una billetera ni una caja dada de baja.
    expect(posCashTreasuryId([{ id: 'mp', kind: 'wallet', active: true }], 'cerro')).toBeNull()
  })

  it('la fecha del retiro, sin salirse de lo que se puede cargar', () => {
    const range = { min: '2026-11-01', max: '2026-11-23' }
    expect(posCashDate('2026-11-22', range)).toBe('2026-11-22')
    expect(posCashDate('2026-10-30', range)).toBe('2026-11-01')
    expect(posCashDate('2026-11-25', range)).toBe('2026-11-23')
    expect(posCashDate('2026-10-30', { min: null, max: '2026-11-23' })).toBe('2026-10-30')
  })
})

describe('los bordes (zod)', () => {
  it('un retiro y una referencia que sean ids', () => {
    expect(posCashLinkSchema.safeParse({ movementId: uuid(1), clientRef: uuid(2) }).success).toBe(
      true,
    )
    expect(posCashLinkSchema.safeParse({ movementId: 'x', clientRef: uuid(2) }).success).toBe(false)
    expect(posCashLinkSchema.safeParse({ movementId: uuid(1) }).success).toBe(false)
    expect(posCashIdSchema.safeParse({ movementId: uuid(1) }).success).toBe(true)
    expect(posCashIdSchema.safeParse({}).success).toBe(false)
    expect(posCashIdSchema.safeParse(null).success).toBe(false)
  })
})

describe('las acciones', () => {
  it('atar un retiro al comprobante que se está por guardar', async () => {
    const result = await linkPosCash(SLUG, { movementId: uuid(500), clientRef: uuid(999) })
    expect(result.ok).toBe(true)
    expect(db.rpc).toHaveBeenCalledWith('acc_pos_cash_link', {
      p_tenant_id: 'tenant-1',
      p_movement_id: uuid(500),
      p_client_ref: uuid(999),
    })
    // Alcanza con cargar compras: lo usa también quien tiene «solo compras y pagos».
    expect(db.needs).toEqual(['buy_write'])
    // Atar no cambia nada a la vista: lo que se ve cambia cuando se guarda el comprobante.
    expect(db.revalidate).not.toHaveBeenCalled()
  })

  it('si ya tiene comprobante, lo dice', async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'pos_cash_already_passed' },
    })
    const result = await linkPosCash(SLUG, { movementId: uuid(500), clientRef: uuid(999) })
    expect(result).toMatchObject({ ok: false, code: 'conflict' })
    if (!result.ok)
      expect(result.message).toBe('Ese retiro ya tiene su comprobante. Actualizá la página.')
  })

  it('descartar: «no va a los libros», y la pantalla se vuelve a pedir', async () => {
    const result = await dismissPosCash(SLUG, { movementId: uuid(500) })
    expect(result).toMatchObject({ ok: true, message: 'Listo, no va a los libros.' })
    expect(db.rpc).toHaveBeenCalledWith('acc_pos_cash_dismiss', {
      p_tenant_id: 'tenant-1',
      p_movement_id: uuid(500),
    })
    expect(db.revalidate).toHaveBeenCalledWith(SLUG)
  })

  it('un retiro del personal con «solo compras y pagos»: la base dice que no y no se revalida nada', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } })
    const result = await dismissPosCash(SLUG, { movementId: uuid(500) })
    expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.revalidate).not.toHaveBeenCalled()
  })

  it('lo que no valida o no tiene permiso no llega a la base', async () => {
    expect(await linkPosCash(SLUG, { movementId: 'x', clientRef: uuid(999) })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(await dismissPosCash(SLUG, { movementId: '' })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    db.denied = true
    for (const result of [
      await linkPosCash(SLUG, { movementId: uuid(500), clientRef: uuid(999) }),
      await dismissPosCash(SLUG, { movementId: uuid(500) }),
      await loadPosCash(SLUG, { movementId: uuid(500) }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    }
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('traer un retiro para abrir un formulario ya completo; si ya no espera, nada', async () => {
    db.rpc.mockResolvedValue({ data: [RAW, { ...RAW, id: uuid(501) }], error: null })
    const found = await loadPosCash(SLUG, { movementId: uuid(501) })
    expect(found).toMatchObject({ ok: true, data: { id: uuid(501), amountCents: 5_000_000 } })
    expect(db.rpc).toHaveBeenCalledWith('acc_pos_cash_pending', { p_tenant_id: 'tenant-1' })
    const gone = await loadPosCash(SLUG, { movementId: uuid(777) })
    expect(gone).toMatchObject({ ok: true, data: null })
  })

  it('si la base todavía no lo tiene, la lectura lo dice sin romper', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
    const result = await loadPosCash(SLUG, { movementId: uuid(500) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/todavía no está disponible/)
  })

  it('la lectura pide solo una sucursal cuando se mira una', async () => {
    db.rpc.mockResolvedValue({ data: [RAW], error: null })
    expect(await listPosCashPending('tenant-1', uuid(40))).toHaveLength(1)
    expect(db.rpc).toHaveBeenLastCalledWith('acc_pos_cash_pending', {
      p_tenant_id: 'tenant-1',
      p_branch_id: uuid(40),
    })
  })
})
