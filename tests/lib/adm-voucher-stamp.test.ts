import { describe, expect, it } from 'vitest'
import {
  QUICK_VOUCHERS,
  type QuickVoucher,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import { paperStamp } from '@/components/administracion/acciones/gasto-papel'
import { voucherStamp } from '@/components/administracion/voucher-stamp'
import { invoiceLetterFor } from '@/lib/accounting/posting/quick-expense'
import type { IvaCondition, VoucherType } from '@/lib/accounting/types'
import { VOUCHER_TYPE_KEYS } from '@/lib/accounting/types'
import { VOUCHER_CATALOG, type VoucherFamily } from '@/lib/accounting/voucher-types'

/**
 * El sello de un papel es uno solo: lo que dice el ticket antes de guardar
 * («Nuevo gasto», la compra) es lo que dice la ficha del comprobante después.
 * `voucherStamp()` es ese mapa, por tipo de comprobante.
 */

/** El tipo de comprobante que guarda cada papel de «Nuevo gasto» (`quickExpensePath` del motor). */
function savedVoucherType(voucher: QuickVoucher, condition: IvaCondition): VoucherType {
  switch (voucher) {
    case 'none':
      return 'sin_comprobante'
    case 'ticket':
      return 'tique'
    case 'a':
      return 'factura_a'
    case 'bc':
      return invoiceLetterFor(condition)
  }
}

describe('el sello de cada papel · la tabla', () => {
  it('cada tipo del catálogo tiene su sello, y dice lo que es', () => {
    const stamps = Object.fromEntries(VOUCHER_TYPE_KEYS.map((type) => [type, voucherStamp(type)]))
    expect(stamps).toEqual({
      factura_a: { tone: 'factura', text: 'Con factura A' },
      nota_debito_a: { tone: 'factura', text: 'Con nota de débito A' },
      nota_credito_a: { tone: 'factura', text: 'Con nota de crédito A' },
      recibo_a: { tone: 'factura', text: 'Con recibo A' },
      factura_b: { tone: 'factura', text: 'Con factura B' },
      nota_debito_b: { tone: 'factura', text: 'Con nota de débito B' },
      nota_credito_b: { tone: 'factura', text: 'Con nota de crédito B' },
      recibo_b: { tone: 'factura', text: 'Con recibo B' },
      factura_c: { tone: 'factura', text: 'Con factura C' },
      nota_debito_c: { tone: 'factura', text: 'Con nota de débito C' },
      nota_credito_c: { tone: 'factura', text: 'Con nota de crédito C' },
      recibo_c: { tone: 'factura', text: 'Con recibo C' },
      factura_m: { tone: 'factura', text: 'Con factura A' },
      nota_debito_m: { tone: 'factura', text: 'Con nota de débito A' },
      nota_credito_m: { tone: 'factura', text: 'Con nota de crédito A' },
      tique_factura_a: { tone: 'factura', text: 'Con tique factura A' },
      tique_factura_b: { tone: 'factura', text: 'Con tique factura B' },
      tique_factura_c: { tone: 'factura', text: 'Con tique factura C' },
      tique: { tone: 'factura', text: 'Con tique' },
      liquidacion: { tone: 'factura', text: 'Con liquidación' },
      resumen_bancario: { tone: 'factura', text: 'Con resumen del banco' },
      otro_comprobante: { tone: 'factura', text: 'Con otro comprobante' },
      ddjj_impuesto: { tone: 'factura', text: 'Con boleta de impuesto' },
      sin_comprobante: { tone: 'sin', text: 'Sin factura' },
    })
  })

  it('no queda ninguna familia del catálogo sin sello', () => {
    const families = new Set<VoucherFamily>(
      VOUCHER_TYPE_KEYS.map((type) => VOUCHER_CATALOG[type].family),
    )
    // Las once familias de hoy: si se suma una, este test obliga a darle sello.
    expect([...families].sort()).toEqual([
      'ddjj',
      'factura',
      'liquidacion',
      'nota_credito',
      'nota_debito',
      'otro',
      'recibo',
      'resumen_bancario',
      'sin_comprobante',
      'tique',
      'tique_factura',
    ])
    for (const type of VOUCHER_TYPE_KEYS) {
      const stamp = voucherStamp(type)
      expect(stamp, type).not.toBeNull()
      expect(stamp?.text.trim(), type).toBe(stamp?.text)
      expect(stamp?.text.length, type).toBeGreaterThan(0)
    }
  })

  it('la Factura M es «Factura A sujeta a retención»: sella A, nunca «M»', () => {
    for (const type of ['factura_m', 'nota_debito_m', 'nota_credito_m'] as const) {
      expect(VOUCHER_CATALOG[type].letter).toBe('M')
      expect(voucherStamp(type)?.text).toMatch(/ A$/)
      expect(voucherStamp(type)?.text).not.toMatch(/M$/)
    }
  })

  it('sin tipo o con un tipo que no existe no hay sello (no se inventa un «Sin factura»)', () => {
    expect(voucherStamp(null)).toBeNull()
    expect(voucherStamp(undefined)).toBeNull()
    expect(voucherStamp('')).toBeNull()
    expect(voucherStamp('factura_z')).toBeNull()
    expect(voucherStamp('toString')).toBeNull()
  })
})

describe('el sello de cada papel · las palabras', () => {
  const stamps = VOUCHER_TYPE_KEYS.map((type) => ({ type, stamp: voucherStamp(type) }))

  it('solo «sin factura» va con la otra tinta; ninguno es una alarma', () => {
    for (const { type, stamp } of stamps) {
      expect(stamp?.tone, type).toBe(type === 'sin_comprobante' ? 'sin' : 'factura')
    }
  })

  it('lo que no tiene factura se llama «Sin factura»: nunca «sin comprobante» ni «comprobante» a secas', () => {
    const none = voucherStamp('sin_comprobante')
    expect(none?.text).toBe('Sin factura')
    expect(none?.text).not.toMatch(/comprobante|remito/i)
    // La palabra «comprobante» aparece una sola vez, y dice cuál: «otro comprobante».
    const withWord = stamps.filter(({ stamp }) => /comprobante/i.test(stamp?.text ?? ''))
    expect(withWord.map(({ type }) => type)).toEqual(['otro_comprobante'])
  })

  it('un solo libro: ningún sello habla de «negro», «blanco», «afuera» ni de estados de pago', () => {
    for (const { type, stamp } of stamps) {
      expect(stamp?.text, type).not.toMatch(/negro|blanco|afuera|fuera de|informal/i)
      expect(stamp?.text, type).not.toMatch(/pagad|cobrad|vencid|anulad|a cobrar|a pagar/i)
      // Todos dicen qué papel es: «Con …» o «Sin factura».
      expect(stamp?.text, type).toMatch(/^(Con |Sin factura$)/)
    }
  })
})

describe('el sello de cada papel · antes y después de guardar', () => {
  const conditions: IvaCondition[] = [
    'responsable_inscripto',
    'monotributo',
    'exento',
    'consumidor_final',
    'no_alcanzado',
    'sin_datos',
  ]

  it('los cuatro papeles de «Nuevo gasto» guardan un tipo que sella lo mismo que el ticket', () => {
    for (const voucher of QUICK_VOUCHERS) {
      for (const condition of conditions) {
        const before = paperStamp({ voucher, hasParty: true, condition })
        const after = voucherStamp(savedVoucherType(voucher, condition))
        expect(after, `${voucher} · ${condition}`).toEqual(before)
      }
    }
  })

  it('y de vuelta: cada sello de «Nuevo gasto» con proveedor es el de un tipo del catálogo', () => {
    const known = new Set(VOUCHER_TYPE_KEYS.map((type) => voucherStamp(type)?.text))
    for (const voucher of QUICK_VOUCHERS) {
      for (const condition of conditions) {
        expect(known.has(paperStamp({ voucher, hasParty: true, condition }).text)).toBe(true)
      }
    }
    // Sin proveedor todavía, «Factura B o C» no se decidió: ese sello es solo del borrador.
    const draft = paperStamp({ voucher: 'bc', hasParty: false, condition: null })
    expect(draft.text).toBe('Con factura B o C')
    expect(known.has(draft.text)).toBe(false)
  })
})
