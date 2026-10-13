import { describe, expect, it } from 'vitest'
import {
  buildQuickExpenseValues,
  QUICK_VOUCHERS,
  type QuickExpenseFormState,
  type QuickVoucher,
  quickExpenseOutcome,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  missingForSummary,
  PAPER_OPTIONS,
  type PaperOption,
  paperConsequence,
  paperOutcomeNote,
  paperStamp,
  recoveredVatFromPreview,
  recoversVat,
  ticketTotalLabel,
  treasuryAfter,
  treasuryAfterText,
  treasuryAfterWords,
  treasuryMoneyText,
} from '@/components/administracion/acciones/gasto-papel'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { NBSP as NB } from '@/lib/money'
import { prepare } from './accounting-fixtures'

function option(value: QuickVoucher): PaperOption {
  const found = PAPER_OPTIONS.find((o) => o.value === value)
  if (!found) throw new Error(`Falta la tarjeta ${value}`)
  return found
}

/** Lo que tiene la hoja cuando se toca «Cargar gasto», con el papel que se pida. */
function formState(
  r: ReturnType<typeof prepare>['r'],
  voucher: QuickVoucher,
  patch: Partial<QuickExpenseFormState> = {},
): QuickExpenseFormState {
  return {
    amountCents: 1_210_000,
    target: { kind: 'party', partyId: r.party('mayorista'), accountId: r.account('cleaning') },
    treasuryAccountId: r.treasury('mp'),
    voucher,
    vatRateBp: 2100,
    vatAdjustCents: 0,
    pointOfSale: 3,
    number: 4521,
    date: '2026-10-03',
    detail: '',
    remito: '',
    recurringExpenseId: null,
    ...patch,
  }
}

describe('«¿Qué papel te dieron?» · las cuatro tarjetas', () => {
  it('son los cuatro valores de siempre: ninguno nuevo, ninguno repetido', () => {
    expect(PAPER_OPTIONS.map((o) => o.value)).toEqual(['a', 'bc', 'ticket', 'none'])
    expect([...PAPER_OPTIONS.map((o) => o.value)].sort()).toEqual([...QUICK_VOUCHERS].sort())
    expect(PAPER_OPTIONS.map((o) => o.title)).toEqual([
      'Factura A',
      'Factura B o C',
      'Tique',
      'Remito o nada',
    ])
  })

  it('cada tarjeta manda lo mismo que mandaban «¿Se factura?» y los chips de comprobante', () => {
    const { r, ctx } = prepare()
    const kinds: Record<QuickVoucher, string[]> = {
      // «Sí» + Factura A / Factura B o C / Tique (con proveedor y número): compra + pago.
      a: ['purchase', 'payment'],
      bc: ['purchase', 'payment'],
      ticket: ['purchase', 'payment'],
      // «No»: un gasto de contado, sin punto de venta ni número.
      none: ['expense'],
    }
    for (const { value } of PAPER_OPTIONS) {
      const built = buildQuickExpenseValues(formState(r, value))
      expect(built.values?.voucher).toBe(value)
      expect(built.values?.pointOfSale).toBe(value === 'none' ? null : 3)
      expect(built.values?.number).toBe(value === 'none' ? null : 4521)
      expect(built.values?.vatAdjustCents).toBe(0)
      const preview = previewDocumentForm('quick_expense', built.values, ctx)
      expect(preview.ok, value).toBe(true)
      if (!preview.ok) continue
      expect(preview.preview.map((p) => p.kind)).toEqual(kinds[value])
    }
  })

  it('«Remito o nada» guarda el n.º de remito adelante del detalle, como antes', () => {
    const { r } = prepare()
    const built = buildQuickExpenseValues(
      formState(r, 'none', { remito: '0001-00001234', detail: 'hielo' }),
    )
    expect(built.values?.detail).toBe('Remito 0001-00001234 · hielo')
  })

  it('las líneas de cada tarjeta dicen lo que pasa, sin sacar nada de los libros', () => {
    const texts = PAPER_OPTIONS.map((o) => o.consequence).join(' ')
    expect(option('none').consequence).toBe(
      'Sin factura: queda en tus números y no entra al Libro IVA.',
    )
    expect(texts).not.toMatch(/en negro|en blanco|afuera|fuera de|sin comprobante/i)
  })
})

describe('«¿Qué papel te dieron?» · el IVA de la Factura A', () => {
  it('se recupera solo si el proveedor y el bar son responsables inscriptos (la regla del motor)', () => {
    const sas = 'responsable_inscripto'
    // Sin proveedor todavía: una Factura A la emite un responsable inscripto.
    expect(recoversVat({ condition: null, sasCondition: sas })).toBe(true)
    expect(recoversVat({ condition: 'responsable_inscripto', sasCondition: sas })).toBe(true)
    expect(recoversVat({ condition: 'monotributo', sasCondition: sas })).toBe(false)
    expect(recoversVat({ condition: 'consumidor_final', sasCondition: sas })).toBe(false)
    expect(recoversVat({ condition: null, sasCondition: 'monotributo' })).toBe(false)
    expect(recoversVat({ condition: 'responsable_inscripto', sasCondition: 'exento' })).toBe(false)
  })

  it('la cifra sale de la vista previa: lo que va a IVA crédito fiscal', () => {
    const { r, ctx } = prepare()
    const vatCredit = ctx.sys.vat_credit.id
    const recovered = (voucher: QuickVoucher) => {
      const preview = previewDocumentForm(
        'quick_expense',
        buildQuickExpenseValues(formState(r, voucher)).values,
        ctx,
      )
      if (!preview.ok) throw new Error(preview.message)
      return recoveredVatFromPreview(preview.preview, vatCredit)
    }
    // $ 12.100 con Factura A al 21 %: neto $ 10.000, IVA $ 2.100.
    expect(recovered('a')).toBe(210_000)
    // Con cualquier otro papel el IVA va al costo: no hay nada que recuperar.
    expect(recovered('bc')).toBe(0)
    expect(recovered('ticket')).toBe(0)
    expect(recovered('none')).toBe(0)
  })

  it('la tarjeta de Factura A lo dice en plata cuando está elegida y hay importe', () => {
    const a = option('a')
    expect(paperConsequence(a, { selected: 'a', recovers: true, recoveredVatCents: 210_000 })).toBe(
      `Recuperás $${NB}2.100 de IVA.`,
    )
    // Sin importe, o con otro papel elegido, queda la línea de siempre.
    expect(paperConsequence(a, { selected: 'a', recovers: true, recoveredVatCents: null })).toBe(
      'Te discrimina el IVA: lo recuperás.',
    )
    expect(
      paperConsequence(a, { selected: 'none', recovers: true, recoveredVatCents: 210_000 }),
    ).toBe('Te discrimina el IVA: lo recuperás.')
    // Si ese IVA no se puede recuperar, no lo promete.
    expect(
      paperConsequence(a, { selected: 'a', recovers: false, recoveredVatCents: 210_000 }),
    ).toBe('Te discrimina el IVA, pero acá no se recupera: va al costo.')
  })

  it('las otras tres tarjetas no cambian con lo que se cargue', () => {
    for (const value of ['bc', 'ticket', 'none'] as const) {
      const o = option(value)
      expect(
        paperConsequence(o, { selected: value, recovers: true, recoveredVatCents: 210_000 }),
      ).toBe(o.consequence)
    }
  })
})

describe('el ticket de «Nuevo gasto» · sello y letra chica', () => {
  it('el sello dice con qué papel queda; sin factura no es una alarma', () => {
    expect(paperStamp({ voucher: 'none', hasParty: false, condition: null })).toEqual({
      tone: 'sin',
      text: 'Sin factura',
    })
    expect(paperStamp({ voucher: 'ticket', hasParty: false, condition: null })).toEqual({
      tone: 'factura',
      text: 'Con tique',
    })
    expect(
      paperStamp({ voucher: 'a', hasParty: true, condition: 'responsable_inscripto' }),
    ).toEqual({ tone: 'factura', text: 'Con factura A' })
  })

  it('«Factura B o C» se resuelve como el motor: B de un inscripto, C del resto', () => {
    expect(
      paperStamp({ voucher: 'bc', hasParty: true, condition: 'responsable_inscripto' }).text,
    ).toBe('Con factura B')
    expect(paperStamp({ voucher: 'bc', hasParty: true, condition: 'monotributo' }).text).toBe(
      'Con factura C',
    )
    expect(paperStamp({ voucher: 'bc', hasParty: true, condition: null }).text).toBe(
      'Con factura C',
    )
    // Sin proveedor todavía no se sabe cuál de las dos.
    expect(paperStamp({ voucher: 'bc', hasParty: false, condition: null }).text).toBe(
      'Con factura B o C',
    )
  })

  it('la letra chica dice si entra al Libro IVA, según lo que arma el motor', () => {
    const note = (voucher: QuickVoucher, hasParty: boolean, hasNumber: boolean, recovers = true) =>
      paperOutcomeNote({
        voucher,
        outcome: quickExpenseOutcome({ voucher, hasParty, hasNumber }),
        recovers,
      })
    expect(note('none', true, false)).toBe(
      'Queda en tus números, sin factura. No entra al Libro IVA.',
    )
    // Un tique sin proveedor o sin número se guarda como gasto.
    expect(note('ticket', false, true)).toMatch(/no entra al Libro IVA/)
    expect(note('ticket', true, false)).toMatch(/no entra al Libro IVA/)
    expect(note('ticket', true, true)).toBe('Entra al Libro IVA como tique. El IVA va al costo.')
    expect(note('a', true, true)).toBe(
      'Entra al Libro IVA y recuperás el IVA. Con el proveedor no queda deuda.',
    )
    expect(note('a', true, true, false)).toBe(
      'Entra al Libro IVA; el IVA va al costo. Con el proveedor no queda deuda.',
    )
    expect(note('bc', true, true)).toBe(
      'Entra al Libro IVA; el IVA va al costo. Con el proveedor no queda deuda.',
    )
    const all = (['none', 'ticket', 'a', 'bc'] as const)
      .flatMap((v) => [note(v, true, true), note(v, false, false), note(v, true, true, false)])
      .join(' ')
    expect(all).not.toMatch(/en negro|en blanco|afuera|fuera de|ganancia|ganaste/i)
  })

  it('con datos faltantes dice qué falta, en vez de mostrar ceros', () => {
    expect(missingForSummary({ amount: false, target: false, treasury: false })).toBeNull()
    expect(missingForSummary({ amount: true, target: false, treasury: false })).toBe(
      'Falta decir cuánto gastaste.',
    )
    expect(missingForSummary({ amount: true, target: true, treasury: false })).toBe(
      'Falta decir cuánto gastaste y en qué se gastó.',
    )
    expect(missingForSummary({ amount: true, target: true, treasury: true })).toBe(
      'Falta decir cuánto gastaste, en qué se gastó y con qué pagaste.',
    )
  })

  it('el total nombra de dónde sale la plata', () => {
    expect(ticketTotalLabel({ kind: 'cash', name: 'Caja' })).toBe('Salen de Caja')
    expect(ticketTotalLabel({ kind: 'wallet', name: 'Mercado Pago' })).toBe('Salen de Mercado Pago')
    // Con la tarjeta de la empresa no sale plata de ninguna caja: sube lo que se debe.
    expect(ticketTotalLabel({ kind: 'credit_card', name: 'Visa' })).toBe('Con Visa')
    expect(ticketTotalLabel(null)).toBe('Total')
    // El rótulo va en un renglón: un nombre muy largo se corta.
    expect(
      ticketTotalLabel({ kind: 'bank', name: 'Banco de la Provincia de Córdoba cuenta corriente' }),
    ).toBe('Salen de Banco de la Provincia…')
  })
})

describe('«¿Con qué pagaste?» · la caja antes → después', () => {
  const caja = { kind: 'cash', balanceCents: 39_475_700, allowNegative: false } as const

  it('sin importe no hay «después»', () => {
    expect(treasuryAfter(caja, null)).toEqual({
      beforeCents: 39_475_700,
      afterCents: null,
      state: 'idle',
    })
    expect(treasuryAfter(caja, 0).state).toBe('idle')
    expect(treasuryAfterText({ ...caja, name: 'Caja' }, treasuryAfter(caja, null))).toBeNull()
  })

  it('«Caja: $ 394.757 → $ 382.257»', () => {
    const after = treasuryAfter(caja, 1_250_000)
    expect(after).toEqual({ beforeCents: 39_475_700, afterCents: 38_225_700, state: 'ok' })
    expect(treasuryAfterText({ ...caja, name: 'Caja' }, after)).toBe(
      `Caja: $${NB}394.757 → $${NB}382.257`,
    )
  })

  it('cada número lleva su rótulo, y nunca un menos pelado', () => {
    const words = (
      t: { kind: 'cash' | 'bank' | 'credit_card'; balanceCents: number; allowNegative: boolean },
      amountCents: number | null,
    ) => treasuryAfterWords(t.kind, treasuryAfter(t, amountCents))
    expect(words(caja, null)).toBeNull()
    expect(words(caja, 1_250_000)).toEqual({
      before: { label: 'hoy', amount: `$${NB}394.757` },
      after: { label: 'queda', amount: `$${NB}382.257` },
    })
    // No alcanza: dice cuánto falta, en positivo.
    expect(words(caja, 40_725_700)?.after).toEqual({ label: 'faltan', amount: `$${NB}12.500` })
    // Una cuenta con descubierto permitido no «falta»: queda en descubierto.
    expect(
      words({ kind: 'bank', balanceCents: 1_000_000, allowNegative: true }, 2_200_000)?.after,
    ).toEqual({ label: 'queda en descubierto', amount: `$${NB}12.000` })
    // Tarjeta de la empresa: sube lo que se debe.
    expect(
      words({ kind: 'credit_card', balanceCents: 8_000_000, allowNegative: false }, 1_250_000),
    ).toEqual({
      before: { label: 'hoy debés', amount: `$${NB}80.000` },
      after: { label: 'vas a deber', amount: `$${NB}92.500` },
    })
  })

  it('una caja que no admite negativo y quedaría en rojo: el mismo aviso que da el motor', () => {
    const { r, ctx } = prepare()
    const efectivo = ctx.treasuries.get(r.treasury('caja'))
    if (!efectivo) throw new Error('Falta la caja')
    const amountCents = efectivo.balanceCents + 500_000
    expect(treasuryAfter(efectivo, amountCents)).toEqual({
      beforeCents: efectivo.balanceCents,
      afterCents: -500_000,
      state: 'short',
    })
    const preview = previewDocumentForm(
      'quick_expense',
      buildQuickExpenseValues(formState(r, 'none', { amountCents, treasuryAccountId: efectivo.id }))
        .values,
      ctx,
    )
    expect(preview.ok && preview.warnings.map((w) => w.key)).toContain('treasury_negative')
    // Con plata de sobra, ni la hoja ni el motor avisan.
    expect(treasuryAfter(efectivo, 500_000).state).toBe('ok')
  })

  it('una cuenta que admite descubierto no avisa; lo dice con palabras, sin un menos pelado', () => {
    const banco = { kind: 'bank', balanceCents: 1_000_000, allowNegative: true } as const
    const after = treasuryAfter(banco, 2_200_000)
    expect(after.state).toBe('overdraft')
    expect(treasuryAfterText({ ...banco, name: 'Banco' }, after)).toBe(
      `Banco: $${NB}10.000 → Descubierto $${NB}12.000`,
    )
  })

  it('con la tarjeta de la empresa sube la deuda', () => {
    const visa = { kind: 'credit_card', balanceCents: 8_000_000, allowNegative: false } as const
    const after = treasuryAfter(visa, 1_250_000)
    expect(after).toEqual({ beforeCents: 8_000_000, afterCents: 9_250_000, state: 'debt' })
    expect(treasuryAfterText({ ...visa, name: 'Visa' }, after)).toBe(
      `Visa: Deuda $${NB}80.000 → Deuda $${NB}92.500`,
    )
    expect(treasuryMoneyText('credit_card', 0)).toBe(`$${NB}0`)
  })
})
