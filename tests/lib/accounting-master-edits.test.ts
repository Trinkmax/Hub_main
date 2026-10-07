import { describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { accountingAllows } from '@/lib/accounting/access'
import { formInput, presentKeys, rpcPayload } from '@/lib/accounting/actions/support'
import { partySchema } from '@/lib/accounting/schemas'
import type { AccountingAccess } from '@/lib/tenant/types'

const OFF: AccountingAccess = {
  enabled: false,
  setUp: false,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}

describe('accountingAllows', () => {
  it('leer, cargar y dar accesos, cada uno con lo suyo', () => {
    const owner = { ...OFF, enabled: true, setUp: true, read: true, write: true }
    const admin = { ...owner, admin: true }
    const accountant = { ...OFF, enabled: true, setUp: true, read: true }
    expect(accountingAllows(owner, 'read')).toBe(true)
    expect(accountingAllows(owner, 'write')).toBe(true)
    expect(accountingAllows(owner, 'admin')).toBe(false)
    expect(accountingAllows(admin, 'admin')).toBe(true)
    expect(accountingAllows(accountant, 'read')).toBe(true)
    expect(accountingAllows(accountant, 'write')).toBe(false)
    expect(accountingAllows(accountant, 'admin')).toBe(false)
  })

  it('con el módulo apagado no pasa nada, aunque la base diga admin (gobierno)', () => {
    const off = { ...OFF, admin: true, read: true, write: true }
    expect(accountingAllows(off, 'read')).toBe(false)
    expect(accountingAllows(off, 'write')).toBe(false)
    expect(accountingAllows(off, 'admin')).toBe(false)
  })
})

describe('ediciones parciales de datos maestros', () => {
  const PARTY_FIELDS = [
    ['kind', 'kind'],
    ['name', 'name'],
    ['taxIdType', 'tax_id_type'],
    ['taxId', 'tax_id'],
    ['commissionBp', 'commission_bp'],
    ['payableAccountId', 'payable_account_id'],
    ['active', 'active'],
  ] as const

  it('en una edición viaja solo lo que mandó el formulario', () => {
    // El formulario de «Partícipes del sistema» solo muestra CUIT y comisión.
    const raw = {
      id: '00000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-10-07T09:15:42.123+00:00',
      kind: 'payment_wallet',
      name: 'Mercado Pago',
      taxIdType: 'cuit',
      taxId: '30-71876543-5',
      commissionBp: '150',
    }
    const parsed = partySchema.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const present = presentKeys(raw)
    const payload = rpcPayload(parsed.data, PARTY_FIELDS, (f) => present.has(f))
    expect(payload).toEqual({
      kind: 'payment_wallet',
      name: 'Mercado Pago',
      tax_id_type: 'cuit',
      tax_id: '30718765435',
      commission_bp: 150,
    })
    // `active` (default true) y la cuenta de control (null) no se pisan.
    expect('active' in payload).toBe(false)
    expect('payable_account_id' in payload).toBe(false)
  })

  it('FormData: un valor por clave y las claves presentes', () => {
    const fd = new FormData()
    fd.set('name', 'Coca-Cola')
    fd.set('active', 'false')
    expect(formInput(fd)).toEqual({ name: 'Coca-Cola', active: 'false' })
    expect([...presentKeys(fd)].sort()).toEqual(['active', 'name'])
    expect(formInput({ a: 1 })).toEqual({ a: 1 })
    expect([...presentKeys({ a: 1, b: undefined })]).toEqual(['a'])
  })
})
