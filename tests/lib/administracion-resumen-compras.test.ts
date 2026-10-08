import { describe, expect, it } from 'vitest'
import {
  availableBreakdown,
  availableBreakdownParts,
} from '@/app/(manager)/[tenantSlug]/administracion/_resumen/summary-copy'
import { splitVoucherText } from '@/components/administracion/voucher-text'
import type { SummaryTreasury } from '@/lib/accounting/queries/summary'

const NB = '\u00a0'

describe('números de comprobante enteros (no se cortan en el guion)', () => {
  it('separa el número con guiones del resto del texto', () => {
    expect(splitVoucherText('Coca-Cola · Factura A 0003-00001100 · venció hace 6 días')).toEqual([
      { text: 'Coca-Cola · Factura A ', keep: false, start: 0 },
      { text: '0003-00001100', keep: true, start: 22 },
      { text: ' · venció hace 6 días', keep: false, start: 35 },
    ])
  })

  it('un CUIT también queda entero', () => {
    expect(splitVoucherText('CUIT 30-70111222-5').filter((p) => p.keep)).toEqual([
      { text: '30-70111222-5', keep: true, start: 5 },
    ])
  })

  it('sin números con guion devuelve el texto tal cual (un solo tramo)', () => {
    expect(splitVoucherText('Pago')).toEqual([{ text: 'Pago', keep: false, start: 0 }])
    expect(splitVoucherText('Gasto #10 del 06/10')).toEqual([
      { text: 'Gasto #10 del 06/10', keep: false, start: 0 },
    ])
    expect(splitVoucherText('')).toEqual([])
  })

  it('juntar los tramos devuelve el texto original', () => {
    const text = 'NC A 0003-00000077 y FA 0005-00004321'
    expect(
      splitVoucherText(text)
        .map((p) => p.text)
        .join(''),
    ).toBe(text)
  })
})

function treasury(over: Partial<SummaryTreasury>): SummaryTreasury {
  return {
    id: 't',
    name: 'Caja',
    kind: 'cash',
    accountCode: null,
    balanceCents: 0,
    pendingWalletCents: 0,
    lastCheckedOn: null,
    lastMovementDate: null,
    ...over,
  }
}

describe('Resumen · desglose de «Plata disponible»', () => {
  it('un tramo por caja (el nombre con su saldo), hasta 3 y «y N más»', () => {
    const summary = {
      cardDebtCents: 0,
      treasuries: [
        treasury({ name: 'Caja', balanceCents: 64_300_000 }),
        treasury({ name: 'Mercado Pago', kind: 'wallet', balanceCents: 80_000_000 }),
        treasury({ name: 'Banco Nación', kind: 'bank', balanceCents: 180_275_000 }),
        treasury({ name: 'Galicia', kind: 'bank', balanceCents: 1 }),
      ],
    }
    expect(availableBreakdownParts(summary)).toEqual([
      `Caja $${NB}643.000`,
      `Mercado Pago $${NB}800.000`,
      `Banco Nación $${NB}1.802.750`,
      'y 1 más',
    ])
    expect(availableBreakdown(summary)).toBe(availableBreakdownParts(summary).join(' · '))
  })

  it('la tarjeta de la empresa no suma como plata: va como deuda al final', () => {
    const parts = availableBreakdownParts({
      cardDebtCents: 5_000_000,
      treasuries: [
        treasury({ name: 'Caja', balanceCents: 1_000_000 }),
        treasury({ name: 'Visa', kind: 'credit_card', balanceCents: -5_000_000 }),
      ],
    })
    expect(parts).toEqual([`Caja $${NB}10.000`, `Tarjeta de la empresa: deuda $${NB}50.000`])
  })
})
