import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildQuickExpenseValues,
  QUICK_VOUCHERS,
  type QuickExpenseFormState,
  type QuickVoucher,
  quickExpenseOutcome,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  exactAmountText,
  missingForSummary,
  PAPER_OPTIONS,
  type PaperOption,
  paidFromWords,
  paperConsequence,
  paperOutcomeNote,
  paperStamp,
  recoveredVatFromPreview,
  recoversVat,
  ticketTotalLabel,
  treasuryAfter,
  treasuryAfterShort,
  treasuryAfterText,
  treasuryAfterWords,
  treasuryMoneyText,
} from '@/components/administracion/acciones/gasto-papel'
import {
  PaperChoices,
  TreasuryAfterHint,
  TreasuryAfterLine,
} from '@/components/administracion/acciones/gasto-piezas'
import {
  ADD_LINK,
  BIG_MONEY_FIELD,
  SHEET_QUESTION_BLOCK,
  SheetQuestion,
  TEXT_LINK,
} from '@/components/administracion/acciones/sheet-parts'
import { ACTION_SHEET_QUESTION } from '@/components/administracion/action-sheet'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
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

  it('con Factura A, B o C sin número, lo que falta es el número (y no «los importes»)', () => {
    const answered = { amount: false, target: false, treasury: false }
    // Importe, proveedor y caja ya están: el ticket no puede decir «Entra al Libro IVA» todavía.
    expect(missingForSummary({ ...answered, invoiceNumber: true })).toBe(
      'Falta el número de la factura.',
    )
    expect(missingForSummary({ ...answered, invoiceNumber: false })).toBeNull()
    // Si además falta otra cosa, se dicen las dos.
    expect(missingForSummary({ ...answered, amount: true, invoiceNumber: true })).toBe(
      'Falta decir cuánto gastaste. También falta el número de la factura.',
    )
  })

  it('sin el número de una factura no hay asiento: por eso el ticket queda en borrador', () => {
    const { r, ctx } = prepare()
    for (const voucher of ['a', 'bc'] as const) {
      const built = buildQuickExpenseValues(
        formState(r, voucher, { pointOfSale: null, number: null }),
      )
      const preview = previewDocumentForm('quick_expense', built.values, ctx)
      expect(preview.ok, voucher).toBe(false)
    }
    // Un tique o un remito se cargan igual sin número.
    for (const voucher of ['ticket', 'none'] as const) {
      const built = buildQuickExpenseValues(
        formState(r, voucher, { pointOfSale: null, number: null }),
      )
      expect(previewDocumentForm('quick_expense', built.values, ctx).ok, voucher).toBe(true)
    }
  })

  it('el botón dice el importe que se va a guardar: con centavos si los tiene', () => {
    expect(exactAmountText(1_250_000)).toBe(`$${NB}12.500`)
    // Redondeado diría $ 123.456.790, que no es lo que muestra el ticket.
    expect(exactAmountText(12_345_678_950)).toBe(`$${NB}123.456.789,50`)
    expect(exactAmountText(1_234_567_850)).toBe(`$${NB}12.345.678,50`)
    expect(exactAmountText(5)).toBe(`$${NB}0,05`)
  })

  it('el total nombra de dónde sale la plata', () => {
    expect(ticketTotalLabel({ kind: 'cash', name: 'Caja' })).toBe('Salen de Caja')
    expect(ticketTotalLabel({ kind: 'wallet', name: 'Mercado Pago' })).toBe('Salen de Mercado Pago')
    // Con la tarjeta de la empresa no sale plata de ninguna caja: sube lo que se debe.
    expect(ticketTotalLabel({ kind: 'credit_card', name: 'Visa' })).toBe('Con Visa')
    expect(ticketTotalLabel(null)).toBe('Total')
    // El resumen del pie (celular) lo dice en minúscula, como parte de una oración.
    expect(paidFromWords({ kind: 'cash', name: 'Caja' })).toBe('sale de Caja')
    expect(paidFromWords({ kind: 'credit_card', name: 'Visa' })).toBe('con Visa')
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
      `Banco: $${NB}10.000 → queda en descubierto $${NB}12.000`,
    )
  })

  it('el pie del ticket dice lo mismo que la línea de la caja, con las mismas palabras', () => {
    // No alcanza: «faltan» en los dos lados. Una caja de efectivo no queda «en descubierto».
    const short = treasuryAfter(caja, 99_999_900)
    expect(short.state).toBe('short')
    const line = treasuryAfterWords('cash', short)
    const foot = treasuryAfterShort('cash', short)
    expect(line?.after).toEqual({ label: 'faltan', amount: `$${NB}605.242` })
    expect(foot).toEqual({ before: `$${NB}394.757`, after: `faltan $${NB}605.242` })
    expect(treasuryAfterText({ ...caja, name: 'Caja' }, short)).toBe(
      `Caja: $${NB}394.757 → faltan $${NB}605.242`,
    )
    // En todos los casos el pie repite el rótulo de la línea (salvo «hoy» y «queda», que sobran).
    const cases = [
      { t: caja, amount: 1_250_000 },
      { t: caja, amount: 99_999_900 },
      {
        t: { kind: 'bank', balanceCents: 1_000_000, allowNegative: true } as const,
        amount: 2_200_000,
      },
      {
        t: { kind: 'bank', balanceCents: -500_000, allowNegative: true } as const,
        amount: 100_000,
      },
      {
        t: { kind: 'credit_card', balanceCents: 8_000_000, allowNegative: false } as const,
        amount: 1_250_000,
      },
    ]
    for (const { t, amount } of cases) {
      const after = treasuryAfter(t, amount)
      const words = treasuryAfterWords(t.kind, after)
      const footer = treasuryAfterShort(t.kind, after)
      if (!words || !footer) throw new Error('Falta el después')
      expect(footer.after.endsWith(words.after.amount)).toBe(true)
      expect(footer.before.endsWith(words.before.amount)).toBe(true)
      if (words.after.label !== 'queda')
        expect(footer.after.startsWith(words.after.label)).toBe(true)
      expect(`${footer.before} ${footer.after}`).not.toMatch(/Descubierto|hoy|−|-/)
    }
    expect(treasuryAfterShort('cash', treasuryAfter(caja, null))).toBeNull()
  })

  it('con la tarjeta de la empresa sube la deuda', () => {
    const visa = { kind: 'credit_card', balanceCents: 8_000_000, allowNegative: false } as const
    const after = treasuryAfter(visa, 1_250_000)
    expect(after).toEqual({ beforeCents: 8_000_000, afterCents: 9_250_000, state: 'debt' })
    expect(treasuryAfterText({ ...visa, name: 'Visa' }, after)).toBe(
      `Visa: debés $${NB}80.000 → vas a deber $${NB}92.500`,
    )
    expect(treasuryMoneyText('credit_card', 0)).toBe(`$${NB}0`)
  })
})

// ─── Tanda 2: lo que estas piezas le prestan al resto de la sección ───────────

/** El HTML con espacios comunes y sin las marcas que React pone entre dos textos seguidos. */
function html(node: Parameters<typeof renderToString>[0]): string {
  return renderToString(node).replaceAll(NB, ' ').replaceAll('<!-- -->', '')
}

/** Lo que se lee: el HTML sin las etiquetas. */
function words(node: Parameters<typeof renderToString>[0]): string {
  return html(node).replace(/<[^>]+>/g, '')
}

describe('plata que ENTRA a una caja · el mismo «antes → después», al revés', () => {
  const banco = { kind: 'bank', balanceCents: 4_186_342_800, allowNegative: true } as const
  const caja = { kind: 'cash', balanceCents: 39_475_700, allowNegative: false } as const

  it('sin decir nada la plata sale: «Nuevo gasto» hace la misma cuenta de siempre', () => {
    for (const t of [banco, caja]) {
      for (const amount of [null, 0, 1_250_000, 99_999_999_900]) {
        expect(treasuryAfter(t, amount)).toEqual(treasuryAfter(t, amount, 'out'))
      }
    }
    expect(treasuryAfter(caja, 1_250_000)).toEqual({
      beforeCents: 39_475_700,
      afterCents: 38_225_700,
      state: 'ok',
    })
  })

  it('con `in` suma: «Banco Nación: hoy $ 41.863.428 → queda $ 43.651.428»', () => {
    const after = treasuryAfter(banco, 178_800_000, 'in')
    expect(after).toEqual({
      beforeCents: 4_186_342_800,
      afterCents: 4_365_142_800,
      state: 'ok',
    })
    expect(treasuryAfterWords('bank', after)).toEqual({
      before: { label: 'hoy', amount: `$${NB}41.863.428` },
      after: { label: 'queda', amount: `$${NB}43.651.428` },
    })
    expect(treasuryAfterText({ ...banco, name: 'Banco Nación' }, after)).toBe(
      `Banco Nación: $${NB}41.863.428 → $${NB}43.651.428`,
    )
  })

  it('sin importe tampoco hay «después»', () => {
    expect(treasuryAfter(banco, null, 'in')).toEqual({
      beforeCents: 4_186_342_800,
      afterCents: null,
      state: 'idle',
    })
    expect(treasuryAfter(banco, 0, 'in').state).toBe('idle')
    expect(treasuryAfterWords('bank', treasuryAfter(banco, null, 'in'))).toBeNull()
  })

  it('lo que entra nunca «falta»: una caja en rojo que sigue en rojo queda en descubierto', () => {
    // Una caja que no admite negativo y ya estaba en rojo: con plata que SALE es «faltan»…
    const roja = { kind: 'cash', balanceCents: -500_000, allowNegative: false } as const
    expect(treasuryAfter(roja, 100_000).state).toBe('short')
    // …y con plata que ENTRA no hay aviso (el motor tampoco lo da): mejora, no empeora.
    const after = treasuryAfter(roja, 100_000, 'in')
    expect(after).toEqual({ beforeCents: -500_000, afterCents: -400_000, state: 'overdraft' })
    expect(treasuryAfterWords('cash', after)).toEqual({
      before: { label: 'hoy en descubierto', amount: `$${NB}5.000` },
      after: { label: 'queda en descubierto', amount: `$${NB}4.000` },
    })
    // Si lo que entra cubre el rojo, queda plata.
    const covered = treasuryAfter(roja, 800_000, 'in')
    expect(covered).toEqual({ beforeCents: -500_000, afterCents: 300_000, state: 'ok' })
    expect(treasuryAfterWords('cash', covered)?.after).toEqual({
      label: 'queda',
      amount: `$${NB}3.000`,
    })
    for (const t of [roja, caja, banco]) {
      for (const amount of [1, 100_000, 99_999_999_900]) {
        expect(treasuryAfter(t, amount, 'in').state).not.toBe('short')
      }
    }
  })

  it('pagarle a la tarjeta de la empresa baja la deuda (y de más, queda a favor)', () => {
    const visa = { kind: 'credit_card', balanceCents: 8_000_000, allowNegative: false } as const
    const paid = treasuryAfter(visa, 1_250_000, 'in')
    expect(paid).toEqual({ beforeCents: 8_000_000, afterCents: 6_750_000, state: 'debt' })
    expect(treasuryAfterText({ ...visa, name: 'Visa' }, paid)).toBe(
      `Visa: debés $${NB}80.000 → vas a deber $${NB}67.500`,
    )
    expect(treasuryAfterWords('credit_card', treasuryAfter(visa, 9_000_000, 'in'))?.after).toEqual({
      label: 'queda a favor',
      amount: `$${NB}10.000`,
    })
  })

  it('la línea dibuja lo mismo, sin el aviso de «no alcanza»', () => {
    const treasury = { ...banco, name: 'Banco Nación' }
    const line = words(
      createElement(TreasuryAfterLine, { treasury, amountCents: 178_800_000, direction: 'in' }),
    )
    expect(line).toContain('Banco Nación')
    expect(line).toContain('hoy $ 41.863.428')
    expect(line).toContain('queda $ 43.651.428')
    expect(line).not.toContain('no alcanza')
    // Sin `direction`, la de «Nuevo gasto»: la plata sale.
    const out = words(createElement(TreasuryAfterLine, { treasury, amountCents: 178_800_000 }))
    expect(out).toContain('queda $ 40.075.428')
    // El pie del ticket, igual.
    const hint = words(
      createElement(TreasuryAfterHint, { treasury, amountCents: 178_800_000, direction: 'in' }),
    )
    expect(hint).toContain('Banco Nación: $ 41.863.428')
    expect(hint).toContain('$ 43.651.428')
    // Sin importe no se dibuja nada.
    expect(
      html(createElement(TreasuryAfterLine, { treasury, amountCents: null, direction: 'in' })),
    ).toBe('')
  })
})

describe('«¿Qué papel te dieron?» · sin ninguna tarjeta marcada', () => {
  it('cada tarjeta dice su línea de siempre, también con importe cargado', () => {
    for (const o of PAPER_OPTIONS) {
      expect(
        paperConsequence(o, { selected: null, recovers: true, recoveredVatCents: 210_000 }),
      ).toBe(o.consequence)
    }
    // Y si ese IVA acá no se recupera, la Factura A lo dice igual que con una marcada.
    expect(
      paperConsequence(option('a'), { selected: null, recovers: false, recoveredVatCents: null }),
    ).toBe(
      paperConsequence(option('a'), { selected: 'none', recovers: false, recoveredVatCents: null }),
    )
  })

  it('con `value: null` no hay ninguna marcada; con un valor, esa sola', () => {
    const render = (value: QuickVoucher | null) =>
      html(
        createElement(PaperChoices, {
          name: 'papel',
          labelledBy: 'papel-label',
          value,
          onPick: () => {},
          consequenceFor: (o: PaperOption) => o.consequence,
        }),
      )
    const none = render(null)
    expect(none.split('type="radio"').length - 1).toBe(4)
    expect(none).not.toContain('checked=""')
    for (const o of PAPER_OPTIONS) expect(none).toContain(o.title)
    for (const voucher of QUICK_VOUCHERS) {
      const one = render(voucher)
      expect(one.split('checked=""').length - 1).toBe(1)
      expect(one).toMatch(new RegExp(`<input(?=[^>]*value="${voucher}")(?=[^>]*checked="")[^>]*>`))
    }
  })

  it('cuántas columnas van lo decide el ancho del grupo, por CSS: en una página no hay salto al hidratar', () => {
    const out = html(
      createElement(PaperChoices, {
        name: 'papel',
        labelledBy: 'papel-label',
        value: 'a',
        onPick: () => {},
        consequenceFor: (o: PaperOption) => o.consequence,
      }),
    )
    // El grupo de radios es el contenedor que se mide; la grilla va adentro.
    expect(out).toMatch(
      /^<div role="radiogroup" aria-labelledby="papel-label" class="@container"><div class="grid [^"]*@\[30rem\]:grid-cols-2/,
    )
    // Ningún corte por ancho de ventana: en la hoja (560 px) son dos columnas y en una
    // columna angosta de una página, una, sin esperar a que cargue el JavaScript.
    expect(out).not.toMatch(/(?<![\w-])sm:grid-cols-2/)
    // Las cuatro tarjetas salen del servidor ya con las dos formas escritas (renglón, y
    // apilada desde 30rem): lo que se pinta primero es lo que queda.
    const labels = out.match(/<label class="[^"]*"/g) ?? []
    expect(labels).toHaveLength(4)
    for (const label of labels) {
      expect(label).toContain('@[30rem]:[&amp;&gt;input+span]:flex-col')
      expect(label).toContain('@[30rem]:[&amp;&gt;.adm-choice-mark]:top-3.5')
    }
    // El dibujo crece con las dos columnas.
    expect(out.match(/<svg[^>]*class="[^"]*@\[30rem\]:h-16[^"]*"/g) ?? []).toHaveLength(4)
  })
})

describe('elegir una caja · las píldoras de «¿Con qué pagaste?», hechas pieza', () => {
  const box = (
    id: string,
    name: string,
    kind: TreasuryOption['kind'],
    balanceCents: number,
    active = true,
  ): TreasuryOption => ({ id, name, kind, balanceCents, active })
  const CAJA = box('t-caja', 'Caja', 'cash', 39_475_720)
  const MP = box('t-mp', 'Mercado Pago', 'wallet', 120_000_000)
  const BANCO = box('t-banco', 'Banco Nación', 'bank', -1_200_000)
  const VISA = box('t-visa', 'Visa', 'credit_card', 8_000_000)
  const six = [
    CAJA,
    MP,
    BANCO,
    VISA,
    box('t-5', 'Banco Macro', 'bank', 1),
    box('t-6', 'Caja chica', 'cash', 2),
  ]
  const render = (props: Partial<Parameters<typeof TreasuryPicker>[0]> = {}) =>
    html(
      createElement(TreasuryPicker, {
        value: null,
        onValueChange: () => {},
        treasuries: [CAJA, MP],
        'aria-labelledby': 'pregunta',
        ...props,
      }),
    )
  const radios = (markup: string) => markup.split('role="radio"').length - 1

  it('con pocas cajas son píldoras: un grupo de radios, cada una con su nombre y su saldo', () => {
    const markup = render({ value: 't-mp' })
    expect(markup).toContain('role="radiogroup"')
    expect(markup).toContain('aria-labelledby="pregunta"')
    expect(radios(markup)).toBe(2)
    expect(markup.split('aria-checked="true"').length - 1).toBe(1)
    expect(markup).toMatch(/<button(?=[^>]*aria-checked="true")[^>]*aria-label="Mercado Pago, /)
    // La elegida va RELLENA, no en contorno.
    expect(markup).toMatch(/<button(?=[^>]*aria-checked="true")[^>]*\bbg-primary\b/)
    // Una sola parada de Tab: la elegida.
    expect(markup.split('tabindex="0"').length - 1).toBe(1)
    expect(markup).not.toContain('role="combobox"')
  })

  it('el saldo va sin centavos y con las mismas palabras que los chips de «Nuevo gasto»', () => {
    const markup = render({ treasuries: [CAJA, MP, BANCO, VISA] })
    for (const t of [CAJA, MP, BANCO, VISA]) {
      const text = treasuryMoneyText(t.kind, t.balanceCents).replaceAll(NB, ' ')
      expect(markup).toContain(`aria-label="${t.name}, ${text}"`)
      expect(markup).toContain(`>${text}<`)
    }
    expect(markup).toContain('$ 394.757')
    expect(markup).not.toContain('394.757,20')
    // Nunca un menos pelado: el rojo lo dice una palabra.
    expect(markup).toContain('Descubierto $ 12.000')
    expect(markup).toContain('Deuda $ 80.000')
    expect(markup).not.toMatch(/[−-]\$/)
  })

  it('sin ninguna elegida, la parada de Tab es la primera y ninguna está marcada', () => {
    const markup = render()
    expect(markup).not.toContain('aria-checked="true"')
    expect(markup).toMatch(/<button(?=[^>]*tabindex="0")[^>]*aria-label="Caja, /)
  })

  it('con más cajas que `max` cae al desplegable de siempre', () => {
    const markup = render({ treasuries: six })
    expect(markup).toContain('role="combobox"')
    expect(markup).not.toContain('role="radiogroup"')
    // El tope se puede mover.
    expect(render({ treasuries: six, max: 6 })).toContain('role="radiogroup"')
    expect(render({ treasuries: [CAJA, MP, BANCO], max: 2 })).toContain('role="combobox"')
  })

  it('las desactivadas y, si se pide, las tarjetas no cuentan ni se ofrecen', () => {
    const off = box('t-off', 'Caja vieja', 'cash', 0, false)
    const markup = render({ treasuries: [CAJA, MP, BANCO, VISA, off], excludeCards: true })
    expect(markup).toContain('role="radiogroup"')
    expect(radios(markup)).toBe(3)
    expect(markup).not.toContain('Visa')
    expect(markup).not.toContain('Caja vieja')
    // La que ya estaba elegida se sigue viendo aunque esté desactivada (como en el desplegable).
    expect(render({ treasuries: [CAJA, off], value: 't-off' })).toContain('Caja vieja')
  })

  it('`exclude` saca una caja sin cambiar la forma del control («Mover plata»)', () => {
    const five = [CAJA, MP, BANCO, VISA, box('t-5', 'Banco Macro', 'bank', 1)]
    // Cinco cajas: desplegable, con o sin la de origen excluida.
    expect(render({ treasuries: five })).toContain('role="combobox"')
    expect(render({ treasuries: five, exclude: ['t-caja'] })).toContain('role="combobox"')
    // Cuatro cajas: píldoras, y la excluida no se ofrece.
    const four = render({ treasuries: [CAJA, MP, BANCO, VISA], exclude: ['t-caja'] })
    expect(radios(four)).toBe(3)
    expect(four).not.toContain('aria-label="Caja, ')
  })

  it('con error marca el grupo (así «ir al primer error» lo encuentra) y lleva sus atributos', () => {
    const markup = render({
      id: 'caja',
      name: 'treasuryAccountId',
      value: 't-caja',
      invalid: true,
      'aria-describedby': 'caja-error',
    })
    expect(markup).toMatch(
      /<div(?=[^>]*id="caja")(?=[^>]*role="radiogroup")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="caja-error")[^>]*>/,
    )
    expect(markup).toContain('border-destructive/60')
    // El valor viaja en un campo oculto, como con el desplegable.
    expect(markup).toMatch(
      /<input(?=[^>]*type="hidden")(?=[^>]*name="treasuryAccountId")(?=[^>]*value="t-caja")[^>]*>/,
    )
    expect(render()).not.toContain('aria-invalid')
    expect(render()).not.toContain('type="hidden"')
  })

  it('sin cajas lo dice, en vez de dibujar un grupo vacío', () => {
    expect(render({ treasuries: [] })).toContain('No hay cajas ni cuentas activas.')
    expect(render({ treasuries: [CAJA], exclude: ['t-caja'] })).toContain(
      'No hay otra caja ni cuenta para elegir.',
    )
  })
})

describe('lo que comparten las hojas (`sheet-parts`) · copiado tal cual de «Nuevo gasto»', () => {
  const sheet = readFileSync(
    join(process.cwd(), 'components/administracion/acciones/gasto-sheet.tsx'),
    'utf8',
  )

  it('las clases son las que «Nuevo gasto» tiene escritas adentro', () => {
    // El día que «Nuevo gasto» las importe de `sheet-parts` en vez de tenerlas escritas, vale igual.
    const imports = /from '\.\/sheet-parts'/.test(sheet)
    for (const [name, value] of Object.entries({
      ADD_LINK,
      TEXT_LINK,
      BIG_MONEY_FIELD,
      SHEET_QUESTION_BLOCK,
    })) {
      const written = sheet.includes(`'${value}'`) || sheet.includes(`"${value}"`)
      expect(written || (imports && sheet.includes(name)), name).toBe(true)
    }
  })

  it('los links de texto y «＋ Agregar» miden 44 px en el celular y muestran el foco', () => {
    for (const classes of [ADD_LINK, TEXT_LINK]) {
      expect(classes).toContain('min-h-11')
      expect(classes).toContain('focus-visible:ring-2')
      expect(classes).toContain('focus-visible:ring-ring')
    }
    // Tailwind v4: una variable entre corchetes no pinta.
    for (const classes of [ADD_LINK, TEXT_LINK, BIG_MONEY_FIELD, SHEET_QUESTION_BLOCK]) {
      expect(classes).not.toMatch(/-\[--/)
    }
  })

  it('la pregunta habla con la voz de las hojas y lleva el `id` que usa su grupo', () => {
    // El texto va como hijo (así se escribe en JSX): por eso las props se pasan sin `children`.
    const ask = (props: { id: string; required?: boolean }, text: string) =>
      html(createElement(SheetQuestion, props as Parameters<typeof SheetQuestion>[0], text))
    const question = ask({ id: 'caja-label', required: true }, '¿A dónde entró?')
    expect(question).toContain('id="caja-label"')
    expect(question).toContain(`class="${ACTION_SHEET_QUESTION}"`)
    expect(question).toContain('¿A dónde entró?')
    // El asterisco es de adorno para lectores: «obligatoria» lo dice el campo.
    expect(question).toMatch(/<span aria-hidden="true"[^>]*>\*<\/span>/)
    const optional = ask({ id: 'x' }, '¿Qué papel te dieron?')
    expect(optional).not.toContain('*')
  })
})
