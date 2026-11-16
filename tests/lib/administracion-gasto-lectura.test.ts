import { describe, expect, it } from 'vitest'
import {
  quickExpenseFromRead,
  type ReadParty,
  readPatchIsEmpty,
} from '@/components/administracion/acciones/gasto-lectura'
import type { InvoiceRead } from '@/lib/accounting/invoice-read'

/**
 * «Nuevo gasto» lee la foto del comprobante (pedido de los socios, 16/11/2026): qué se propone a
 * partir de lo leído, sin pisar lo que la persona ya escribió.
 */

const CUIT = '30707006303'
const parties: ReadParty[] = [
  {
    id: 'p-limpieza',
    name: 'Limpieza Demo SA',
    tradeName: null,
    taxId: CUIT,
    active: true,
    kind: 'supplier',
    defaultAccountId: 'cta-limpieza',
  },
  {
    id: 'p-hielo',
    name: 'Hielo Cristal del Centro SA',
    tradeName: 'Hielo Cristal',
    taxId: null,
    active: true,
    kind: 'supplier',
    defaultAccountId: 'cta-que-ya-no-sirve',
  },
]
const ctx = {
  parties,
  imputableAccountIds: new Set(['cta-limpieza']),
  booksStartDate: '2026-10-01',
  today: '2026-11-16',
}
const empty = { amountCents: null, hasTarget: false }

function read(input: Partial<InvoiceRead> = {}): InvoiceRead {
  return {
    source: 'ai',
    date: '2026-11-14',
    cuit: CUIT,
    issuerName: 'LIMPIEZA DEMO S.A.',
    pointOfSale: 12,
    number: 413504,
    voucherType: 'factura_a',
    totalCents: 9_000_000,
    doubts: null,
    ...input,
  }
}

describe('lo que la foto le completa a «Nuevo gasto»', () => {
  it('una factura leída entera: proveedor por CUIT, papel, número, monto y fecha', () => {
    expect(quickExpenseFromRead(read(), empty, ctx)).toEqual({
      amountCents: 9_000_000,
      target: { kind: 'party', partyId: 'p-limpieza', accountId: 'cta-limpieza' },
      voucher: 'a',
      voucherNumber: { pos: '0012', number: '00413504' },
      date: '2026-11-14',
    })
  })

  it('lo que la persona ya escribió no se pisa', () => {
    const patch = quickExpenseFromRead(read(), { amountCents: 123_400, hasTarget: true }, ctx)
    expect(patch.amountCents).toBeNull()
    expect(patch.target).toBeNull()
    // El papel y el número sí: son los del comprobante que se acaba de fotografiar.
    expect(patch.voucher).toBe('a')
    expect(patch.voucherNumber).toEqual({ pos: '0012', number: '00413504' })
  })

  it('sin CUIT, la IA dice quién la emite: el que se llama igual, o uno nuevo con ese nombre', () => {
    const porNombre = quickExpenseFromRead(
      read({ cuit: null, issuerName: 'hielo cristal' }),
      empty,
      ctx,
    )
    // La cuenta habitual de su ficha ya no se puede imputar: queda sin cuenta, y la hoja la pregunta.
    expect(porNombre.target).toEqual({ kind: 'party', partyId: 'p-hielo', accountId: null })
    const nuevo = quickExpenseFromRead(
      read({ cuit: null, issuerName: 'Ferretería El Tornillo', voucherType: 'factura_c' }),
      empty,
      ctx,
    )
    expect(nuevo.target).toEqual({
      kind: 'new',
      name: 'Ferretería El Tornillo',
      taxId: '',
      ivaCondition: 'monotributo',
      accountId: null,
    })
    expect(nuevo.voucher).toBe('bc')
  })

  it('un CUIT que no está cargado y sin nombre (solo el QR) no propone a nadie', () => {
    const patch = quickExpenseFromRead(
      read({ source: 'qr', cuit: '30712345671', issuerName: null }),
      empty,
      ctx,
    )
    expect(patch.target).toBeNull()
    // Lo demás del QR sí se completa.
    expect(patch.amountCents).toBe(9_000_000)
    expect(patch.voucherNumber).toEqual({ pos: '0012', number: '00413504' })
  })

  it('el número va entero o no va; un tique sin número queda como tique', () => {
    const tique = quickExpenseFromRead(
      read({ voucherType: 'tique', pointOfSale: 3, number: null }),
      empty,
      ctx,
    )
    expect(tique.voucher).toBe('ticket')
    expect(tique.voucherNumber).toBeNull()
  })

  it('una fecha del futuro o anterior al arranque de los libros no se toma', () => {
    expect(quickExpenseFromRead(read({ date: '2026-11-17' }), empty, ctx).date).toBeNull()
    expect(quickExpenseFromRead(read({ date: '2026-09-30' }), empty, ctx).date).toBeNull()
    expect(quickExpenseFromRead(read({ date: '2026-10-01' }), empty, ctx).date).toBe('2026-10-01')
    // Sin fecha de arranque conocida, alcanza con que no sea del futuro.
    expect(
      quickExpenseFromRead(read({ date: '2026-01-05' }), empty, { ...ctx, booksStartDate: null })
        .date,
    ).toBe('2026-01-05')
  })

  it('un papel que no se carga en gastos y sin datos no cambia nada', () => {
    const nothing = quickExpenseFromRead(
      read({
        cuit: null,
        issuerName: null,
        voucherType: null,
        pointOfSale: null,
        number: null,
        totalCents: null,
        date: null,
      }),
      empty,
      ctx,
    )
    expect(readPatchIsEmpty(nothing)).toBe(true)
    expect(readPatchIsEmpty(quickExpenseFromRead(read(), empty, ctx))).toBe(false)
    // Un total en cero no es un monto.
    expect(quickExpenseFromRead(read({ totalCents: 0 }), empty, ctx).amountCents).toBeNull()
  })
})
