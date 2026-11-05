import { describe, expect, it } from 'vitest'
import {
  internalVoucherModel,
  internalVoucherNumber,
} from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/internal-voucher'
import {
  hasOpeningBalances,
  trialReturnFilters,
  trialReturnParam,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/trial'
import { manualEntryValues } from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_components/manual-entry-form'
import {
  balanceState,
  type EntryLine,
  validateEntry,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_lib/manual-entry'
import {
  accountsWithMovement,
  adjacentAccounts,
  ledgerViewRows,
  lineDetail,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/mayor/_lib/ledger-rows'
import { manualEntrySchema } from '@/lib/accounting/schemas'

/**
 * El camino de Silvia (min. 10 a 13), en lo que es puro: de Sumas y saldos al Mayor sin perder el
 * lugar, las flechas de cuenta en cuenta, qué fila va marcada, y el asiento manual que no se graba si
 * no cuadra.
 */

const plain = (text: string | null | undefined) => (text ?? '').replaceAll(' ', ' ')

describe('volver del Mayor a Sumas y saldos', () => {
  it('sin filtros, igual se sabe de dónde se vino', () => {
    expect(trialReturnParam({})).toBe('sumas')
    expect(trialReturnFilters('sumas')).toEqual({})
  })

  it('con el nivel y «Solo lo raro» prendidos', () => {
    const param = trialReturnParam({ nivel: '3', raro: '1', todas: null })
    expect(trialReturnFilters(param)).toEqual({ nivel: '3', raro: '1' })
  })

  it('sin `?volver=`, o con otra cosa, no hay vuelta', () => {
    expect(trialReturnFilters(null)).toBeNull()
    expect(trialReturnFilters('https://otro.sitio')).toBeNull()
    expect(trialReturnFilters('sumasx')).toBeNull()
  })

  it('solo pasan los filtros que Sumas y saldos conoce, con valores chicos', () => {
    expect(trialReturnFilters('sumas:raro=1&cuenta=abc&redirect=/afuera')).toEqual({ raro: '1' })
    expect(trialReturnFilters('sumas:nivel=<script>')).toEqual({})
  })
})

describe('el saldo inicial', () => {
  const row = (openingDebitCents: number, openingCreditCents: number) => ({
    openingDebitCents,
    openingCreditCents,
  })

  it('se avisa solo si alguna cuenta traía saldo', () => {
    expect(hasOpeningBalances([row(0, 0)])).toBe(false)
    expect(hasOpeningBalances([row(0, 0), row(100, 0)])).toBe(true)
    expect(hasOpeningBalances([row(0, 100)])).toBe(true)
    expect(hasOpeningBalances([])).toBe(false)
  })
})

describe('las flechas del Mayor', () => {
  const trial = (code: string, debit: number, over: Record<string, unknown> = {}) => ({
    accountId: `id-${code}`,
    code,
    name: `Cuenta ${code}`,
    postable: true,
    isVirtual: false,
    periodDebitCents: debit,
    periodCreditCents: 0,
    ...over,
  })

  it('solo las imputables con movimiento, en orden de código', () => {
    const stops = accountsWithMovement([
      trial('4.2.01.03.024', 100),
      trial('1.1.01.01.001', 100),
      trial('1.1.01.01.002', 0),
      trial('1.1.00.00.000', 100, { postable: false }),
      trial('3.00', 100, { isVirtual: true }),
      trial('2.1.01.01.001', 0, { periodCreditCents: 50 }),
    ])
    expect(stops.map((s) => s.code)).toEqual(['1.1.01.01.001', '2.1.01.01.001', '4.2.01.03.024'])
  })

  const stops = [
    { accountId: 'a', code: '1.1', name: 'A' },
    { accountId: 'b', code: '2.1', name: 'B' },
    { accountId: 'c', code: '4.2', name: 'C' },
  ]

  it('la anterior y la siguiente', () => {
    expect(adjacentAccounts(stops, '2.1')).toEqual({ prev: stops[0], next: stops[2] })
  })

  it('en las puntas, solo la que hay', () => {
    expect(adjacentAccounts(stops, '1.1')).toEqual({ prev: null, next: stops[1] })
    expect(adjacentAccounts(stops, '4.2')).toEqual({ prev: stops[1], next: null })
  })

  it('una cuenta sin movimiento, o un grupo, se ubica por su código', () => {
    expect(adjacentAccounts(stops, '3.0')).toEqual({ prev: stops[1], next: stops[2] })
    expect(adjacentAccounts(stops, null)).toEqual({ prev: null, next: stops[0] })
    expect(adjacentAccounts([], '1.1')).toEqual({ prev: null, next: null })
  })

  it('compara por segmentos: 10 va después de 9', () => {
    const list = [
      { accountId: 'x', code: '1.9', name: 'X' },
      { accountId: 'y', code: '1.10', name: 'Y' },
    ]
    expect(adjacentAccounts(list, '1.9').next?.code).toBe('1.10')
  })
})

describe('una fila del Mayor', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    entryId: 'e1',
    entryNumber: 131,
    numberIsProvisional: false,
    entryDate: '2026-10-14',
    documentId: 'doc-epec',
    documentLabel: 'Factura B 0012-00088123',
    description: 'EPEC · Factura B 0012-00088123',
    partyName: 'EPEC',
    memo: 'Factura B 0012-00088123',
    debitCents: 31_240_000,
    creditCents: 0,
    runningBalanceCents: 31_240_000,
    accountId: 'agua',
    accountCode: '4.2.01.03.024',
    accountName: 'Agua',
    ...over,
  })
  const flag = {
    documentId: 'doc-epec',
    accountId: 'agua',
    partyName: 'EPEC',
    usualAccountName: 'Energía eléctrica',
  }
  const opts = {
    fallbackDate: '2026-10-01',
    isGroup: false,
    flags: [],
    firstOpenDate: null,
  }

  it('dice el comprobante y el proveedor, sin repetir', () => {
    const [row] = ledgerViewRows([line()], opts)
    expect(row).toMatchObject({
      entryId: 'e1',
      date: '2026-10-14',
      number: 131,
      label: 'Factura B 0012-00088123',
      detail: 'EPEC',
      flag: null,
    })
  })

  it('la cuenta que no es la habitual va marcada, con la oración', () => {
    const [row] = ledgerViewRows([line()], { ...opts, flags: [flag] })
    expect(row?.flag).toBe('EPEC siempre va a Energía eléctrica. Tocá para reimputar.')
  })

  it('solo en esa cuenta: el mismo comprobante en Proveedores no va marcado', () => {
    const rows = ledgerViewRows([line({ accountId: 'proveedores' })], { ...opts, flags: [flag] })
    expect(rows[0]?.flag).toBeNull()
  })

  it('con el mes cerrado no promete que se puede reimputar', () => {
    const closed = ledgerViewRows([line()], {
      ...opts,
      flags: [flag],
      firstOpenDate: '2026-11-01',
    })
    expect(closed[0]?.flag).toBe('EPEC siempre va a Energía eléctrica. Ese mes está cerrado.')
    const open = ledgerViewRows([line()], { ...opts, flags: [flag], firstOpenDate: '2026-10-01' })
    expect(open[0]?.flag).toContain('Tocá para reimputar')
  })

  it('la clave no cambia cuando otra fila se va, aunque dos filas sean iguales', () => {
    const a = line({ entryId: 'e1' })
    const b = line({ entryId: 'e2' })
    const before = ledgerViewRows([a, b, b], opts).map((r) => r.key)
    expect(new Set(before).size).toBe(3)
    const after = ledgerViewRows([b, b], opts).map((r) => r.key)
    expect(after).toEqual(before.slice(1))
  })

  it('en el Mayor de un grupo, cada fila dice de qué cuenta es', () => {
    expect(lineDetail(line(), true)).toBe('Agua · EPEC')
    expect(lineDetail(line(), false)).toBe('EPEC')
  })

  it('sin fecha usa la del período, y sin comprobante no inventa uno', () => {
    const [row] = ledgerViewRows(
      [line({ entryDate: null, documentLabel: null, documentId: null })],
      opts,
    )
    expect(row?.date).toBe('2026-10-01')
    expect(row?.label).toBeNull()
  })
})

describe('el asiento manual no se graba si no cuadra', () => {
  const entry = (over: Partial<EntryLine> & { key: string }): EntryLine => ({
    accountId: 'a',
    debitCents: null,
    creditCents: null,
    partyId: null,
    dueDate: null,
    memo: '',
    ...over,
  })

  it('el mensaje en vivo', () => {
    expect(balanceState(0n, 0n)).toEqual({ state: 'empty', text: 'Cargá los importes' })
    expect(balanceState(100n, 100n)).toEqual({ state: 'balanced', text: 'Debe = Haber' })
    const missingCredit = balanceState(33_500_000n, 25_000_000n)
    expect(missingCredit.state).toBe('gap')
    expect(plain(missingCredit.text)).toBe('Falta $ 85.000,00 en el Haber')
    expect(plain(balanceState(100n, 350n).text)).toBe('Falta $ 2,50 en el Debe')
  })

  it('«nada sin respaldo»: se pide cuando el formulario lo muestra', () => {
    const lines = [entry({ key: 'a', debitCents: 100 }), entry({ key: 'b', creditCents: 100 })]
    const base = {
      lines,
      date: '2026-11-04',
      description: 'Préstamo bancario',
      requiresParty: () => false,
    }
    expect(validateEntry(base)).toEqual({ ok: true })
    expect(validateEntry({ ...base, backing: 'Contrato 123' })).toEqual({ ok: true })
    const missing = validateEntry({ ...base, backing: '   ' })
    expect(missing).toMatchObject({
      ok: false,
      message: 'Anotá el respaldo: el contrato, el resumen o el n.º del papel.',
      onlyBalance: false,
    })
    if (!missing.ok) expect(Object.keys(missing.errors)).toEqual(['backing'])
  })

  const line = (accountId: string, debitCents: number | null, creditCents: number | null) => ({
    accountId,
    debitCents,
    creditCents,
    partyId: null,
    dueDate: null,
    memo: '',
  })
  const ACCOUNT_A = '00000000-0000-4000-8000-00000000000a'
  const ACCOUNT_B = '00000000-0000-4000-8000-00000000000b'
  const CLIENT_REF = '00000000-0000-4000-8000-0000000000cc'
  const PREVIEW_HASH = 'a'.repeat(64)

  it('el respaldo viaja como nota del comprobante y pasa el zod del servidor', () => {
    const values = manualEntryValues({
      kind: 'manual',
      date: '2026-11-04',
      description: 'Préstamo bancario',
      lines: [line(ACCOUNT_A, 100, null), line(ACCOUNT_B, null, 100)],
      correctsId: null,
      notes: '  Contrato 123  ',
    })
    expect(values.notes).toBe('Contrato 123')
    const parsed = manualEntrySchema.safeParse({
      ...values,
      clientRef: CLIENT_REF,
      previewHash: PREVIEW_HASH,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.notes).toBe('Contrato 123')
  })

  it('sin respaldo no manda la clave: Sueldos paso a paso sigue mandando lo mismo', () => {
    const values = manualEntryValues({
      kind: 'payroll',
      date: '2026-11-04',
      description: 'Sueldos',
      lines: [line(ACCOUNT_A, 100, null), line(ACCOUNT_B, null, 100)],
      correctsId: null,
      notes: null,
    })
    expect('notes' in values).toBe(false)
  })

  it('el servidor tampoco deja grabar si no cuadra', () => {
    const parsed = manualEntrySchema.safeParse({
      entryKind: 'manual',
      date: '2026-11-04',
      description: 'No cuadra',
      lines: [line(ACCOUNT_A, 100, null), line(ACCOUNT_B, null, 90)],
      correctsDocumentId: null,
      clientRef: CLIENT_REF,
      previewHash: PREVIEW_HASH,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message.replaceAll('\u00a0', ' ')).toBe(
        'El asiento no cuadra: falta $ 0,10 en el Haber.',
      )
    }
  })
})

describe('el comprobante interno', () => {
  const doc = {
    voucherType: 'sin_comprobante',
    seq: 47,
    kind: 'purchase',
    accountingDate: '2026-10-12',
    issueDate: '2026-10-12',
    partyName: 'Carnicería Norte',
    description: 'Media res',
    notes: 'Lo trajo Tomás',
    totalCents: 3_000_000,
    status: 'posted' as const,
    lines: [
      { treasuryName: null, amountCents: 3_000_000 },
      { treasuryName: 'Caja Efectivo', amountCents: 3_000_000 },
    ],
  }

  it('solo lo que va sin factura lleva número interno', () => {
    expect(internalVoucherNumber(doc)).toBe(47)
    expect(internalVoucherNumber({ voucherType: 'factura_a', seq: 47 })).toBeNull()
    expect(internalVoucherNumber({ voucherType: null, seq: 47 })).toBeNull()
  })

  it('el papel para imprimir: número, datos, forma de pago y total', () => {
    const model = internalVoucherModel(doc)
    expect(model?.title).toBe('Comprobante interno N.º 47')
    expect(model?.rows).toEqual([
      { label: 'Fecha', value: '12/10/2026' },
      { label: 'Qué es', value: 'Compra' },
      { label: 'A nombre de', value: 'Carnicería Norte' },
      { label: 'Concepto', value: 'Media res' },
    ])
    expect(model?.means.map(plain)).toEqual(['Caja Efectivo: $ 30.000,00'])
    expect(plain(model?.totalText)).toBe('$ 30.000,00')
    expect(model?.notes).toBe('Lo trajo Tomás')
    expect(model?.voided).toBe(false)
  })

  it('un comprobante con factura no se imprime desde acá; uno anulado lo dice', () => {
    expect(internalVoucherModel({ ...doc, voucherType: 'factura_a' })).toBeNull()
    expect(internalVoucherModel({ ...doc, status: 'voided' })?.voided).toBe(true)
  })
})
