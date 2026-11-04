import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupplierInvoicingAsk } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-invoicing-ask'
import {
  buildPurchaseValues,
  type PurchaseFormState,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase'
import {
  ASK_WHEN_UNKNOWN,
  asksDue,
  asksPaper,
  conditionForVoucher,
  conditionNoun,
  dueSameDayWarning,
  dueTermOf,
  findPartyByCuit,
  gapWords,
  INVOICING_CHOICES,
  initialPayNow,
  invoicingGap,
  letterBoxOf,
  newPartyTermToSend,
  otherPaperTypes,
  paperOfVoucher,
  paperPicks,
  parseTermDays,
  pendingItemText,
  purchaseRoute,
  purchaseSubmitLabel,
  voucherForPaper,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase-paper'
import {
  buildQuickExpenseValues,
  buildQuickFromPurchase,
  QUICK_VOUCHERS,
  type QuickVoucher,
  withRemito,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  anyVoucherOptions,
  defaultVoucherFor,
  notInvoicedDefault,
  voucherOptionsFor,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/vouchers'
import {
  CategoryCombobox,
  DueTermLine,
  LetterStamp,
  PaperField,
  PaperPicks,
  PayOptions,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/_components/purchase-parts'
import NuevaCompraPage from '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/page'
import { PAPER_OPTIONS } from '@/components/administracion/acciones/gasto-papel'
import { pickTreasury, suggestDueDate } from '@/lib/accounting/defaults'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { bankTaxOf, DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import { IVA_CONDITIONS, type IvaCondition, type VoucherType } from '@/lib/accounting/types'
import { prepare } from './accounting-fixtures'

/**
 * «Cargar una compra», la pantalla con forma de factura: los botones de la letra escriben un tipo de
 * comprobante que YA se ofrecía, «¿Cómo te factura?» aparece cuando el papel no entra con lo que
 * sabemos del proveedor, y los valores por defecto son los de siempre. Lo que se manda no cambió: lo
 * comprueba el hash de la vista previa de seis compras de ejemplo. «Compra y pago» sin factura manda
 * exactamente lo mismo que «Nuevo gasto».
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
// La puerta de la página y lo que lee para cargar: acá se contestan a mano (sin base).
const page = vi.hoisted(() => ({ canWrite: true, loadSheetData: vi.fn(), recurring: vi.fn() }))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/page-access', () => ({
  requireComprasAccess: async () => ({
    access: { tenant: { id: 't-1' } },
    canWrite: page.canWrite,
  }),
}))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions', () => ({
  loadSheetData: page.loadSheetData,
}))
vi.mock('@/lib/accounting/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/queries')>()),
  listRecurringExpenses: page.recurring,
}))
// El formulario entero no hace falta para saber si la página lo monta o no.
vi.mock(
  '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/_components/purchase-form',
  async () => {
    const { createElement: h } = await import('react')
    return { PurchaseForm: () => h('form', { 'data-purchase-form': '' }) }
  },
)
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras/nueva',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  }),
  useAccountingOptional: () => ({ tenantSlug: 'hub', today: '2026-10-13', readOnly: ui.readOnly }),
}))
vi.mock('@/lib/accounting/actions/master', () => ({ saveParty: vi.fn() }))
// «Completar con ARCA» pregunta al servidor si hay ARCA: acá no hace falta.
vi.mock('@/components/administracion/arca-lookup', () => ({
  useArcaLookup: () => ({ reset: () => {} }),
  ArcaLookupTrigger: ({ children }: { children?: unknown }) => children ?? null,
  ArcaLookupPanel: () => null,
}))

afterEach(() => {
  ui.readOnly = false
  page.canWrite = true
  page.loadSheetData.mockReset()
  page.recurring.mockReset()
})

const NB = String.fromCharCode(160)
const PAPERS: readonly QuickVoucher[] = QUICK_VOUCHERS
const FORBIDDEN = ['negro', 'blanco', 'afuera', 'ganancia', 'ganaste']

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ')
}
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const optionsFor = (condition: IvaCondition | null) =>
  voucherOptionsFor({ family: 'factura', condition })

describe('las cuatro tarjetas escriben un tipo que ya se ofrecía', () => {
  it('para cada condición, cada tarjeta da un tipo de la lista o pregunta', () => {
    for (const condition of IVA_CONDITIONS) {
      const options = optionsFor(condition)
      for (const paper of PAPERS) {
        const type = voucherForPaper(paper, { options, condition })
        if (type === null) {
          // No entra con lo que sabemos: hay que preguntar cómo factura.
          expect(
            invoicingGap({ paper, condition, hasTaxId: true, entersIvaBook: true }),
            `${condition} · ${paper}`,
          ).not.toBeNull()
        } else {
          expect(options, `${condition} · ${paper}`).toContain(type)
        }
      }
    }
  })

  it('ida y vuelta: la tarjeta que escribe un tipo es la que ese tipo marca', () => {
    for (const condition of [...IVA_CONDITIONS, null]) {
      const options = optionsFor(condition)
      for (const paper of PAPERS) {
        const type = voucherForPaper(paper, { options, condition })
        if (type !== null) expect(paperOfVoucher(type), `${condition} · ${paper}`).toBe(paper)
      }
    }
  })

  it('«Remito o nada» escribe lo mismo que escribía «¿Se factura? No»', () => {
    for (const condition of [...IVA_CONDITIONS, null]) {
      const options = optionsFor(condition)
      expect(voucherForPaper('none', { options, condition })).toBe(notInvoicedDefault(options))
    }
    expect(voucherForPaper('none', { options: optionsFor(null), condition: null })).toBe(
      'sin_comprobante',
    )
  })

  it('Factura A, B o C y tique, por condición', () => {
    const ri = optionsFor('responsable_inscripto')
    expect(voucherForPaper('a', { options: ri, condition: 'responsable_inscripto' })).toBe(
      'factura_a',
    )
    expect(voucherForPaper('bc', { options: ri, condition: 'responsable_inscripto' })).toBe(
      'factura_b',
    )
    expect(voucherForPaper('ticket', { options: ri, condition: 'responsable_inscripto' })).toBe(
      'tique',
    )
    const mono = optionsFor('monotributo')
    expect(voucherForPaper('bc', { options: mono, condition: 'monotributo' })).toBe('factura_c')
    expect(voucherForPaper('a', { options: mono, condition: 'monotributo' })).toBeNull()
    const exento = optionsFor('exento')
    expect(voucherForPaper('bc', { options: exento, condition: 'exento' })).toBe('factura_c')
    // Lo que se recuerda del proveedor manda si es una de las dos.
    expect(
      voucherForPaper('bc', { options: exento, condition: 'exento', remembered: 'factura_b' }),
    ).toBe('factura_b')
    expect(
      voucherForPaper('bc', { options: mono, condition: 'monotributo', remembered: 'factura_b' }),
    ).toBe('factura_c')
  })

  it('sin proveedor todavía, las cuatro entran (se supone un responsable inscripto)', () => {
    const options = optionsFor(null)
    expect(PAPERS.map((paper) => voucherForPaper(paper, { options, condition: null }))).toEqual([
      'sin_comprobante',
      'tique',
      'factura_a',
      'factura_b',
    ])
  })

  it('lo que no es ninguna de las cuatro va por «Es otro papel»', () => {
    const others: VoucherType[] = [
      'factura_m',
      'tique_factura_a',
      'recibo_a',
      'otro_comprobante',
      'ddjj_impuesto',
      'nota_credito_a',
      'nota_debito_b',
    ]
    for (const type of others) expect(paperOfVoucher(type), type).toBeNull()
    expect(paperOfVoucher(null)).toBeNull()
    expect(otherPaperTypes(optionsFor('responsable_inscripto'))).toEqual([
      'factura_m',
      'tique_factura_a',
      'tique_factura_b',
      'recibo_a',
      'recibo_b',
      'otro_comprobante',
    ])
    // De quien no sabemos cómo factura, el único «otro» es el otro comprobante.
    expect(otherPaperTypes(optionsFor('sin_datos'))).toEqual(['otro_comprobante'])
  })
})

describe('«¿Cómo te factura?»: cuándo se pregunta', () => {
  const ask = (paper: QuickVoucher | null, condition: IvaCondition, hasTaxId = true) =>
    invoicingGap({ paper, condition, hasTaxId, entersIvaBook: paper === 'a' || paper === 'bc' })

  it('de quien no sabemos nada, una factura abre la pregunta', () => {
    expect(ask('a', 'sin_datos')).toEqual({ kind: 'unknown', suggest: 'responsable_inscripto' })
    expect(ask('bc', 'sin_datos')).toEqual({ kind: 'unknown', suggest: null })
    // El remito y el tique entran directo.
    expect(ask('none', 'sin_datos')).toBeNull()
    expect(ask('ticket', 'sin_datos')).toBeNull()
  })

  it('lo que sabemos no coincide: un monotributista con una Factura A', () => {
    expect(ask('a', 'monotributo')).toEqual({ kind: 'mismatch', suggest: 'responsable_inscripto' })
    expect(ask('a', 'exento')).toEqual({ kind: 'mismatch', suggest: 'responsable_inscripto' })
    expect(ask('bc', 'consumidor_final')).toEqual({ kind: 'mismatch', suggest: null })
    expect(ask('bc', 'monotributo')).toBeNull()
    expect(ask('bc', 'responsable_inscripto')).toBeNull()
  })

  it('sabemos cómo factura pero falta el CUIT, y el papel va al Libro IVA', () => {
    expect(ask('a', 'responsable_inscripto', false)).toEqual({ kind: 'cuit', suggest: null })
    expect(ask('ticket', 'responsable_inscripto', false)).toBeNull()
    expect(ask('none', 'responsable_inscripto', false)).toBeNull()
    // Primero cómo factura; el CUIT se pide en el mismo bloque.
    expect(ask('a', 'sin_datos', false)?.kind).toBe('unknown')
  })

  it('las palabras del bloque', () => {
    expect(
      gapWords(
        { kind: 'unknown', suggest: 'responsable_inscripto' },
        { name: 'Barracuda', condition: 'sin_datos', paper: 'a' },
      ).title,
    ).toBe('¿Cómo te factura Barracuda?')
    const mismatch = gapWords(
      { kind: 'mismatch', suggest: 'responsable_inscripto' },
      { name: 'Barracuda', condition: 'monotributo', paper: 'a' },
    )
    expect(mismatch.title).toBe('Barracuda figura como monotributista')
    expect(mismatch.body).toContain('no da Factura A')
    expect(conditionNoun('responsable_inscripto')).toBe('responsable inscripto')
    expect(INVOICING_CHOICES.map((c) => c.label)).toEqual([
      'Responsable inscripto',
      'Monotributo',
      'Exento',
    ])
  })
})

describe('los valores por defecto no cambiaron', () => {
  it('la alternativa «no proponer cuando no se sabe» está apagada', () => {
    expect(ASK_WHEN_UNKNOWN).toBe(false)
    expect(asksPaper({ condition: 'sin_datos', remembered: null })).toBe(false)
    expect(asksDue({ termDays: 0 })).toBe(false)
  })

  it('prendida, deja sin marcar solo lo que no se sabe', () => {
    expect(asksPaper({ condition: 'sin_datos', remembered: null, ask: true })).toBe(true)
    expect(asksPaper({ condition: 'sin_datos', remembered: 'tique', ask: true })).toBe(false)
    expect(asksPaper({ condition: 'monotributo', remembered: null, ask: true })).toBe(false)
    expect(asksDue({ termDays: 0, ask: true })).toBe(true)
    expect(asksDue({ termDays: 21, ask: true })).toBe(false)
  })

  it('de un proveedor del que no sabemos nada se sigue proponiendo lo de siempre', () => {
    const options = optionsFor('sin_datos')
    const proposed = defaultVoucherFor({
      family: 'factura',
      options,
      remembered: null,
      condition: 'sin_datos',
    })
    expect(proposed).toBe('tique')
    expect(paperOfVoucher(proposed)).toBe('ticket')
  })
})

describe('La debo: el plazo sale del vencimiento que el formulario ya tiene', () => {
  const issueDate = '2026-10-12'

  it('sin plazo, vence el mismo día (la fecha del papel): el valor por defecto no cambió', () => {
    const dueDate = suggestDueDate(issueDate, 0)
    expect(dueTermOf({ issueDate, dueDate, termDays: 0 })).toEqual({
      days: 0,
      note: null,
      suggestion: null,
    })
    expect(dueSameDayWarning({ issueDate, dueDate, paying: false })).toBe(true)
    expect(dueSameDayWarning({ issueDate, dueDate, paying: true })).toBe(false)
  })

  it('con plazo en la ficha: «A 21 días, como siempre»', () => {
    const dueDate = suggestDueDate(issueDate, 21)
    expect(dueDate).toBe('2026-11-02')
    expect(dueTermOf({ issueDate, dueDate, termDays: 21 })).toEqual({
      days: 21,
      note: 'como siempre',
      suggestion: null,
    })
  })

  it('otro plazo que el de la ficha ya no es «como siempre»', () => {
    expect(dueTermOf({ issueDate, dueDate: suggestDueDate(issueDate, 30), termDays: 21 })).toEqual({
      days: 30,
      note: null,
      suggestion: null,
    })
  })

  it('sin plazo en la ficha pero con costumbre: se ofrece, no se pone solo', () => {
    expect(
      dueTermOf({ issueDate, dueDate: issueDate, termDays: 0, suggestedTermDays: 15 }),
    ).toEqual({ days: 0, note: null, suggestion: 15 })
    expect(
      dueTermOf({
        issueDate,
        dueDate: suggestDueDate(issueDate, 15),
        termDays: 0,
        suggestedTermDays: 15,
      }),
    ).toEqual({ days: 15, note: 'como las últimas veces', suggestion: null })
    // Con plazo en la ficha, la costumbre no se ofrece: manda la ficha.
    expect(
      dueTermOf({ issueDate, dueDate: issueDate, termDays: 21, suggestedTermDays: 15 }).suggestion,
    ).toBeNull()
  })

  it('sin fecha de pago, o sin fecha del papel, no hay plazo', () => {
    expect(dueTermOf({ issueDate, dueDate: null, termDays: 21 }).days).toBeNull()
    expect(dueTermOf({ issueDate: null, dueDate: issueDate, termDays: 21 }).days).toBeNull()
  })

  it('lo que se tipea en el plazo: días, y nada raro', () => {
    expect(parseTermDays('21')).toBe(21)
    expect(parseTermDays(' 7 ')).toBe(7)
    expect(parseTermDays('0')).toBe(0)
    expect(parseTermDays('999')).toBe(999)
    for (const text of ['', 'a', '-3', '1,5', '1000']) expect(parseTermDays(text), text).toBeNull()
  })
})

describe('«Ya la pagué» arma el mismo pago que «Guardar y pagar…»', () => {
  const treasuries = [
    { id: 't-mp', kind: 'wallet' as const, active: true },
    { id: 't-caja', kind: 'cash' as const, active: true },
    { id: 't-vieja', kind: 'cash' as const, active: false },
  ]

  it('la caja de siempre con ese proveedor, el total, hoy y sin referencia', () => {
    const today = '2026-10-13'
    // Lo que armaba el botón de antes, tal cual.
    const before = {
      treasuryAccountId: pickTreasury({
        treasuries: treasuries.filter((t) => t.active),
        lastUsedWithParty: 't-mp',
        order: treasuries.map((t) => t.id),
      }),
      amountCents: null,
      date: today,
      reference: '',
    }
    expect(initialPayNow({ treasuries, lastUsedWithParty: 't-mp', today })).toEqual(before)
    expect(before.treasuryAccountId).toBe('t-mp')
  })

  it('sin nada recordado va la Caja; una caja desactivada no se propone', () => {
    expect(
      initialPayNow({ treasuries, lastUsedWithParty: null, today: '2026-10-13' }).treasuryAccountId,
    ).toBe('t-caja')
    expect(
      initialPayNow({ treasuries, lastUsedWithParty: 't-vieja', today: '2026-10-13' })
        .treasuryAccountId,
    ).toBe('t-caja')
    expect(
      initialPayNow({ treasuries: [], lastUsedWithParty: null, today: '2026-10-13' })
        .treasuryAccountId,
    ).toBeNull()
  })

  it('como en «Nuevo gasto»: el proveedor, después lo último de esta persona, después la Caja', () => {
    const today = '2026-10-13'
    const pick = (lastUsedWithParty: string | null, myLast: string | null) =>
      initialPayNow({ treasuries, lastUsedWithParty, myLast, today }).treasuryAccountId
    expect(pick('t-caja', 't-mp')).toBe('t-caja')
    expect(pick(null, 't-mp')).toBe('t-mp')
    expect(pick(null, 't-vieja')).toBe('t-caja')
    expect(pick(null, null)).toBe('t-caja')
  })
})

describe('el recuadro de la letra', () => {
  it('las letras van con su código de ARCA, y el título dice qué papel es', () => {
    expect(letterBoxOf('factura_a')).toEqual({
      mark: 'A',
      word: false,
      code: 'COD. 01',
      title: 'FACTURA',
    })
    expect(letterBoxOf('factura_b')).toMatchObject({ mark: 'B', code: 'COD. 06' })
    expect(letterBoxOf('factura_c')).toMatchObject({ mark: 'C', code: 'COD. 11' })
    expect(letterBoxOf('factura_m')).toMatchObject({ mark: 'M', code: 'COD. 51' })
    expect(letterBoxOf('nota_credito_a')).toMatchObject({
      mark: 'A',
      code: 'COD. 03',
      title: 'NOTA DE CRÉDITO',
    })
    expect(letterBoxOf('nota_debito_c')).toMatchObject({
      mark: 'C',
      code: 'COD. 12',
      title: 'NOTA DE DÉBITO',
    })
    expect(letterBoxOf('tique_factura_c')).toMatchObject({
      mark: 'C',
      code: 'COD. 111',
      title: 'TIQUE FACTURA',
    })
    expect(letterBoxOf('recibo_b')).toMatchObject({ mark: 'B', title: 'RECIBO' })
  })

  it('lo que no tiene letra va en palabra chica', () => {
    expect(letterBoxOf('tique')).toEqual({
      mark: 'TQ',
      word: true,
      code: 'COD. 83',
      title: 'TIQUE',
    })
    expect(letterBoxOf('sin_comprobante')).toEqual({
      mark: 'R',
      word: true,
      code: 'INTERNO',
      title: 'REMITO',
    })
    expect(letterBoxOf('otro_comprobante')).toMatchObject({ mark: 'OT', title: 'COMPROBANTE' })
    expect(letterBoxOf('ddjj_impuesto')).toMatchObject({ mark: 'DJ', code: '' })
    expect(letterBoxOf(null)).toMatchObject({ mark: '–', code: '', title: 'COMPROBANTE' })
  })

  it('una compra ofrece A, B, C, Tique y Remito, aunque ese proveedor no dé alguna', () => {
    const labels = (condition: IvaCondition) =>
      paperPicks({ family: 'factura', options: optionsFor(condition) }).map((pick) => pick.label)
    for (const condition of IVA_CONDITIONS) {
      expect(labels(condition), condition).toEqual(['A', 'B', 'C', 'Tique', 'Remito'])
    }
  })

  it('una nota solo tiene letras; un organismo, solo lo que se le puede cargar', () => {
    expect(
      paperPicks({
        family: 'nc',
        options: voucherOptionsFor({ family: 'nc', condition: null }),
      }).map((pick) => pick.type),
    ).toEqual(['nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'nota_credito_m'])
    expect(paperPicks({ family: 'nd', options: [] }).map((pick) => pick.label)).toEqual([
      'A',
      'B',
      'C',
      'M',
    ])
    const agency = voucherOptionsFor({
      family: 'factura',
      condition: 'no_alcanzado',
      isTaxAgency: true,
    })
    expect(
      paperPicks({ family: 'factura', options: agency, isTaxAgency: true }).map(
        (pick) => pick.label,
      ),
    ).toEqual(['Tique', 'Remito'])
  })

  it('sin proveedor todavía se puede elegir cualquier letra: la condición se mira cuando lo hay', () => {
    expect(anyVoucherOptions('factura')).toContain('factura_c')
    // A diferencia de lo que le corresponde a un responsable inscripto.
    expect(optionsFor(null)).not.toContain('factura_c')
    expect(anyVoucherOptions('nc')).toContain('nota_credito_c')
    expect(anyVoucherOptions('nd')).toContain('nota_debito_b')
    const picks = paperPicks({ family: 'factura', options: anyVoucherOptions('factura') })
    expect(picks.map((pick) => pick.type)).toContain('factura_c')
  })

  it('quién da cada letra: para proponerlo al crear o corregir un proveedor', () => {
    expect(conditionForVoucher('factura_a')).toBe('responsable_inscripto')
    expect(conditionForVoucher('factura_b')).toBe('responsable_inscripto')
    expect(conditionForVoucher('factura_m')).toBe('responsable_inscripto')
    expect(conditionForVoucher('factura_c')).toBe('monotributo')
    expect(conditionForVoucher('tique')).toBeNull()
    expect(conditionForVoucher(null)).toBeNull()
  })

  it('una letra que no da: se pregunta por esa letra, no por «B o C»', () => {
    const ask = (voucherType: VoucherType, condition: IvaCondition) =>
      invoicingGap({
        paper: paperOfVoucher(voucherType),
        voucherType,
        condition,
        hasTaxId: true,
        entersIvaBook: true,
      })
    expect(ask('factura_c', 'responsable_inscripto')).toEqual({
      kind: 'mismatch',
      suggest: 'monotributo',
    })
    expect(ask('factura_b', 'monotributo')).toEqual({
      kind: 'mismatch',
      suggest: 'responsable_inscripto',
    })
    expect(ask('factura_b', 'responsable_inscripto')).toBeNull()
    expect(ask('factura_c', 'sin_datos')).toEqual({ kind: 'unknown', suggest: 'monotributo' })
    const words = (condition: IvaCondition) =>
      gapWords({ kind: 'mismatch', suggest: null }, { name: 'X', condition, paper: 'bc' }).body
    expect(words('responsable_inscripto')).toContain('no da Factura C')
    expect(words('monotributo')).toContain('no da Factura B')
    expect(words('consumidor_final')).toContain('no da Factura B o C')
  })
})

describe('el botón dice lo que hace y el importe tal cual se guarda', () => {
  const label = (patch: Partial<Parameters<typeof purchaseSubmitLabel>[0]>) =>
    purchaseSubmitLabel({
      docKind: 'purchase',
      paying: false,
      totalCents: 12_000_000,
      ...patch,
    }).replaceAll(NB, ' ')

  it('«Cargar compra · $ X», como en el prototipo', () => {
    expect(label({})).toBe('Cargar compra · $ 120.000')
    expect(label({ totalCents: null })).toBe('Cargar compra')
    expect(label({ paying: true })).toBe('Cargar compra y pago · $ 120.000')
    expect(label({ docKind: 'purchase_credit_note', totalCents: 6_050_000 })).toBe(
      'Cargar nota de crédito · $ 60.500',
    )
    expect(label({ docKind: 'purchase_debit_note', totalCents: 800_050 })).toBe(
      'Cargar nota de débito · $ 8.000,50',
    )
    // Nueve cifras, con centavos: entra entero.
    expect(label({ totalCents: 99_999_999_950 })).toBe('Cargar compra · $ 999.999.999,50')
  })

  it('un solo libro: ningún texto dice «negro», «blanco», «afuera» ni «ganancia»', () => {
    const texts = [
      ...PAPER_OPTIONS.flatMap((o) => [o.title, o.consequence]),
      ...INVOICING_CHOICES.flatMap((c) => [c.label, c.hint]),
      label({}),
      label({ paying: true }),
      letterBoxOf('sin_comprobante').title,
      ...Object.values(
        gapWords(
          { kind: 'unknown', suggest: null },
          { name: 'X', condition: 'sin_datos', paper: 'bc' },
        ),
      ),
    ]
      .join(' ')
      .toLowerCase()
    for (const word of FORBIDDEN) expect(texts, word).not.toContain(word)
  })
})

describe('el QR de la factura busca al proveedor por su CUIT', () => {
  const parties = [
    { id: 'a', taxId: '30-71234568-9', active: false },
    { id: 'b', taxId: null, active: true },
    { id: 'c', taxId: '30712345689', active: true },
    { id: 'd', taxId: '20-11111111-2', active: true },
  ]

  it('con o sin guiones; entre uno dado de baja y uno activo, el activo', () => {
    expect(findPartyByCuit(parties, '30712345689')?.id).toBe('c')
    expect(findPartyByCuit(parties, '30-71234568-9')?.id).toBe('c')
    expect(findPartyByCuit(parties.slice(0, 2), '30712345689')?.id).toBe('a')
  })

  it('si no está, nada: se ofrece crearlo', () => {
    expect(findPartyByCuit(parties, '27999999990')).toBeNull()
    expect(findPartyByCuit(parties, '')).toBeNull()
    expect(findPartyByCuit([], '30712345689')).toBeNull()
  })
})

// ─── Lo que se manda es lo mismo ─────────────────────────────────────────────

describe('el envío no cambió: seis compras de ejemplo dan la misma vista previa', () => {
  const { r, ctx } = prepare()
  const base = (patch: Partial<PurchaseFormState> = {}): PurchaseFormState => ({
    party: { kind: 'existing', id: r.party('cocacola') },
    voucherType: 'factura_a',
    pointOfSale: 3,
    number: 1290,
    issueDate: '2026-10-03',
    dueDate: '2026-10-24',
    amountMode: 'total',
    totalCents: 86_000_000,
    vatRateBp: 2100,
    vatAdjustCents: 0,
    accountId: r.account('purchases_soft_drinks'),
    nets: {},
    vatAdjust: {},
    grossCents: null,
    nonTaxedCents: null,
    exemptCents: null,
    internalTaxCents: null,
    percIvaCents: null,
    percIibbCents: null,
    iibbJurisdictionCode: 904,
    percGananciasCents: null,
    otherTaxesCents: null,
    otherTaxesAccountId: null,
    controlTotalCents: null,
    relatedDocumentId: null,
    recurringExpenseId: null,
    payNow: null,
    notes: '',
    ...patch,
  })
  const hashOf = (state: PurchaseFormState) => {
    const built = buildPurchaseValues(state)
    if (!built.values) throw new Error(`faltan datos: ${JSON.stringify(built.missing)}`)
    const form = state.voucherType?.startsWith('nota_credito') ? 'purchase_credit_note' : 'purchase'
    const preview = previewDocumentForm(form, built.values, ctx)
    if (!preview.ok) throw new Error(preview.message)
    return preview.hash
  }
  const riOptions = optionsFor('responsable_inscripto')
  const monoOptions = optionsFor('monotributo')
  const treasuries = [{ id: r.treasury('caja'), kind: 'cash' as const, active: true }]

  it('Factura A a deber: la tarjeta escribe `factura_a`', () => {
    const fromCard = voucherForPaper('a', {
      options: riOptions,
      condition: 'responsable_inscripto',
    })
    expect(fromCard).toBe('factura_a')
    expect(hashOf(base({ voucherType: fromCard }))).toBe(hashOf(base()))
  })

  it('remito a deber: «Remito o nada» escribe `sin_comprobante`, con el n.º en las notas', () => {
    const fromCard = voucherForPaper('none', {
      options: riOptions,
      condition: 'responsable_inscripto',
    })
    const remito = { pointOfSale: null, number: null, notes: withRemito('0001-55', '') }
    expect(hashOf(base({ voucherType: fromCard, ...remito }))).toBe(
      hashOf(base({ voucherType: 'sin_comprobante', ...remito })),
    )
  })

  it('Factura C pagada: «Ya la pagué» manda el pago de «Guardar y pagar…»', () => {
    const state = (payNow: PurchaseFormState['payNow']) =>
      base({
        party: { kind: 'existing', id: r.party('plomero') },
        voucherType: voucherForPaper('bc', { options: monoOptions, condition: 'monotributo' }),
        totalCents: 4_500_000,
        payNow,
      })
    const before = {
      treasuryAccountId: r.treasury('caja'),
      amountCents: null,
      date: '2026-10-13',
      reference: '',
    }
    const after = initialPayNow({ treasuries, lastUsedWithParty: null, today: '2026-10-13' })
    expect(after).toEqual(before)
    expect(hashOf(state(after))).toBe(hashOf(state(before)))
    // Pagarla no es lo mismo que deberla: el asiento cambia.
    expect(hashOf(state(after))).not.toBe(hashOf(state(null)))
  })

  it('Factura A con percepción, nota de crédito y compra de un gasto fijo: se pueden previsualizar', () => {
    const withPerception = base({
      party: { kind: 'existing', id: r.party('carniceria') },
      vatRateBp: 1050,
      percIibbCents: 250_000,
    })
    const creditNote = base({ voucherType: 'nota_credito_a', number: 15, totalCents: 6_050_000 })
    const fixed = base({ recurringExpenseId: '00000000-0000-4000-8000-0000000000f1' })
    const hashes = [hashOf(withPerception), hashOf(creditNote), hashOf(fixed)]
    // Tres compras distintas dan tres vistas previas distintas, siempre las mismas.
    expect(new Set(hashes).size).toBe(3)
    expect(hashes).toEqual([hashOf(withPerception), hashOf(creditNote), hashOf(fixed)])
    // El gasto fijo viaja en el envío: cambia el hash respecto de la misma compra sin marcar.
    expect(hashOf(fixed)).not.toBe(hashOf(base()))
  })
})

describe('un tique no pide número', () => {
  const { r, ctx } = prepare()
  const tique = (patch: Partial<PurchaseFormState> = {}): PurchaseFormState => ({
    party: { kind: 'existing', id: r.party('cocacola') },
    voucherType: 'tique',
    pointOfSale: null,
    number: null,
    issueDate: '2026-10-03',
    dueDate: '2026-10-24',
    amountMode: 'total',
    totalCents: 4_500_000,
    vatRateBp: 2100,
    vatAdjustCents: 0,
    accountId: r.account('purchases_soft_drinks'),
    nets: {},
    vatAdjust: {},
    grossCents: null,
    nonTaxedCents: null,
    exemptCents: null,
    internalTaxCents: null,
    percIvaCents: null,
    percIibbCents: null,
    iibbJurisdictionCode: 904,
    percGananciasCents: null,
    otherTaxesCents: null,
    otherTaxesAccountId: null,
    controlTotalCents: null,
    relatedDocumentId: null,
    recurringExpenseId: null,
    payNow: null,
    notes: '',
    ...patch,
  })
  const previewOf = (state: PurchaseFormState) => {
    const { values } = buildPurchaseValues(state)
    if (!values) throw new Error('faltan datos')
    return { values, preview: previewDocumentForm('purchase', values, ctx) }
  }

  it('sin número se puede cargar a deber', () => {
    const { values, preview } = previewOf(tique())
    expect(values.pointOfSale).toBeNull()
    expect(values.number).toBeNull()
    expect(preview.ok).toBe(true)
  })

  it('un punto de venta suelto (el que propone el sistema) no viaja: la base lo rechazaría', () => {
    const { values, preview } = previewOf(tique({ pointOfSale: 3 }))
    expect(values.pointOfSale).toBeNull()
    expect(values.number).toBeNull()
    expect(preview.ok).toBe(true)
  })

  it('con los dos viajan los dos: entra al Libro IVA', () => {
    const { values, preview } = previewOf(tique({ pointOfSale: 3, number: 1290 }))
    expect(values.pointOfSale).toBe(3)
    expect(values.number).toBe(1290)
    expect(preview.ok).toBe(true)
  })

  it('una factura sí lo exige, y un remito nunca lleva', () => {
    const invoice = previewOf(tique({ voucherType: 'factura_a' }))
    expect(invoice.preview.ok).toBe(false)
    const remito = previewOf(tique({ voucherType: 'sin_comprobante', pointOfSale: 3, number: 7 }))
    expect(remito.values.pointOfSale).toBeNull()
    expect(remito.values.number).toBeNull()
  })
})

describe('«Compra y pago» cubre lo que hace la hoja «Nuevo gasto»', () => {
  const { r, ctx } = prepare()
  const today = '2026-10-13'
  const pay = (patch: Partial<NonNullable<PurchaseFormState['payNow']>> = {}) => ({
    treasuryAccountId: r.treasury('caja'),
    amountCents: null,
    date: today,
    reference: '',
    ...patch,
  })
  const state = (patch: Partial<PurchaseFormState> = {}): PurchaseFormState => ({
    party: { kind: 'existing', id: r.party('cocacola') },
    voucherType: 'sin_comprobante',
    pointOfSale: null,
    number: null,
    issueDate: '2026-10-03',
    dueDate: '2026-10-03',
    amountMode: 'total',
    totalCents: 4_500_000,
    vatRateBp: 2100,
    vatAdjustCents: 0,
    accountId: r.account('purchases_soft_drinks'),
    nets: {},
    vatAdjust: {},
    grossCents: null,
    nonTaxedCents: null,
    exemptCents: null,
    internalTaxCents: null,
    percIvaCents: null,
    percIibbCents: null,
    iibbJurisdictionCode: 904,
    percGananciasCents: null,
    otherTaxesCents: null,
    otherTaxesAccountId: null,
    controlTotalCents: null,
    relatedDocumentId: null,
    recurringExpenseId: null,
    payNow: pay(),
    notes: '',
    ...patch,
  })
  const route = (
    patch: Partial<PurchaseFormState> = {},
    input: { family?: 'factura' | 'nc' | 'nd'; notes?: string; remito?: string } = {},
  ) =>
    purchaseRoute(state(patch), {
      family: input.family ?? 'factura',
      today,
      notes: input.notes ?? '',
      remito: input.remito ?? '',
    })

  it('sin proveedor, o con remito o tique sin número: va como un gasto', () => {
    expect(route({ party: null })).toBe('quick_expense')
    expect(route()).toBe('quick_expense')
    expect(route({ voucherType: 'tique' })).toBe('quick_expense')
  })

  it('con factura, o con tique con número: la compra con su pago', () => {
    expect(route({ voucherType: 'factura_a', pointOfSale: 3, number: 1 })).toBe('purchase')
    expect(route({ voucherType: 'factura_b', pointOfSale: 3, number: 1 })).toBe('purchase')
    expect(route({ voucherType: 'tique', pointOfSale: 3, number: 1 })).toBe('purchase')
    expect(route({ voucherType: 'otro_comprobante' })).toBe('purchase')
  })

  it('a deber, y las notas: siempre la compra', () => {
    expect(route({ payNow: null })).toBe('purchase')
    expect(route({ payNow: null, party: null })).toBe('purchase')
    expect(route({}, { family: 'nd' })).toBe('purchase')
  })

  it('lo que un gasto no sabe guardar sigue yendo por la compra', () => {
    expect(route({ amountMode: 'detail' })).toBe('purchase')
    expect(route({ percIibbCents: 100 })).toBe('purchase')
    expect(route({ payNow: pay({ amountCents: 100 }) })).toBe('purchase')
    expect(route({ payNow: pay({ date: '2026-10-10' }) })).toBe('purchase')
    expect(route({ payNow: pay({ reference: '123' }) })).toBe('purchase')
    expect(route({}, { notes: 'x'.repeat(281) })).toBe('purchase')
    expect(route({}, { notes: 'x'.repeat(280) })).toBe('quick_expense')
    // El número del remito va adelante de la nota: también ocupa lugar.
    expect(route({}, { notes: 'x'.repeat(280), remito: '0001-55' })).toBe('purchase')
  })

  const direct = (patch: Partial<Parameters<typeof buildQuickExpenseValues>[0]> = {}) => {
    const built = buildQuickExpenseValues({
      amountCents: 4_500_000,
      target: {
        kind: 'party',
        partyId: r.party('cocacola'),
        accountId: r.account('purchases_soft_drinks'),
      },
      treasuryAccountId: r.treasury('caja'),
      voucher: 'none',
      vatRateBp: 2100,
      vatAdjustCents: 0,
      pointOfSale: null,
      number: null,
      date: '2026-10-03',
      detail: '',
      remito: '',
      recurringExpenseId: null,
      ...patch,
    })
    if (!built.values) throw new Error('faltan datos')
    return built.values
  }

  it('manda exactamente lo mismo que la hoja: proveedor y remito', () => {
    const { values } = buildQuickFromPurchase(state({ notes: 'Remito 55 · hielo' }), {
      notes: 'hielo',
      remito: '55',
    })
    expect(values).toEqual(direct({ detail: 'hielo', remito: '55' }))
    const hash = (v: unknown) => {
      const preview = previewDocumentForm('quick_expense', v, ctx)
      if (!preview.ok) throw new Error(preview.message)
      return preview.hash
    }
    expect(hash(values)).toBe(hash(direct({ detail: 'hielo', remito: '55' })))
  })

  it('sin proveedor: la cuenta sola', () => {
    const accountId = r.account('purchases_soft_drinks')
    const { values } = buildQuickFromPurchase(state({ party: null }), { notes: '', remito: '' })
    expect(values).toEqual(direct({ target: { kind: 'account', accountId } }))
    expect(values && previewDocumentForm('quick_expense', values, ctx).ok).toBe(true)
  })

  it('tique sin número: va como tique, y un punto de venta suelto no viaja', () => {
    const { values } = buildQuickFromPurchase(state({ voucherType: 'tique', pointOfSale: 3 }), {
      notes: '',
      remito: '',
    })
    expect(values).toEqual(direct({ voucher: 'ticket' }))
    expect(values && previewDocumentForm('quick_expense', values, ctx).ok).toBe(true)
  })

  it('proveedor nuevo: se crea junto con el gasto', () => {
    const { values } = buildQuickFromPurchase(
      state({
        party: {
          kind: 'new',
          name: 'Hielo Cristal',
          ivaCondition: 'monotributo',
          taxId: '',
          paymentTermDays: 0,
        },
      }),
      { notes: '', remito: '' },
    )
    const accountId = r.account('purchases_soft_drinks')
    expect(values).toEqual(
      direct({
        target: {
          kind: 'new',
          name: 'Hielo Cristal',
          ivaCondition: 'monotributo',
          taxId: '',
          accountId,
        },
      }),
    )
  })

  it('lo que falta queda en los campos de esta pantalla', () => {
    const { missing, values } = buildQuickFromPurchase(
      state({ totalCents: null, accountId: null, payNow: pay({ treasuryAccountId: null }) }),
      { notes: '', remito: '' },
    )
    expect(values).toBeNull()
    expect(missing).toMatchObject({
      total: 'Escribí cuánto gastaste.',
      account: 'Elegí en qué gastaste.',
      payTreasury: 'Elegí con qué pagaste.',
    })
  })

  it('una factura sin proveedor no se puede: lo pide en su campo', () => {
    for (const voucherType of ['factura_a', 'factura_b', 'factura_c', 'factura_m'] as const) {
      const { missing, values } = buildQuickFromPurchase(state({ party: null, voucherType }), {
        notes: '',
        remito: '',
      })
      expect(values, voucherType).toBeNull()
      expect(missing.party, voucherType).toBe('Una factura necesita proveedor.')
    }
  })

  it('el impuesto al cheque de lo que sale de un banco; de la caja, no', () => {
    const settings = DEFAULT_TAX_SETTINGS
    expect(bankTaxOf(10_000_000, { kind: 'bank' }, settings)).toBe(60_000)
    expect(bankTaxOf(10_000_000, { kind: 'wallet' }, settings)).toBe(60_000)
    expect(bankTaxOf(10_000_000, { kind: 'cash' }, settings)).toBe(0)
    expect(bankTaxOf(10_000_000, { kind: 'bank', chargesBankTax: false }, settings)).toBe(0)
    expect(bankTaxOf(10_000_000, undefined, settings)).toBe(0)
    expect(bankTaxOf(10_000_000, { kind: 'bank' }, undefined)).toBe(0)
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

const PARTY = {
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'supplier' as const,
  name: 'Cervecería y Maltería Barracuda SA',
  tradeName: 'Barracuda',
  ivaCondition: 'sin_datos' as const,
  taxId: null,
  updatedAt: '2026-10-12T10:00:00Z',
}

describe('«¿Cómo te factura?» dibujado', () => {
  const ask = (gap: Parameters<typeof SupplierInvoicingAsk>[0]['gap']) =>
    html(
      createElement(SupplierInvoicingAsk, {
        tenantSlug: 'hub',
        party: PARTY,
        gap,
        paper: 'a',
        onSaved: () => {},
      }),
    )

  it('de quien no sabemos nada: la pregunta, las tres respuestas y «Guardar en su ficha»', () => {
    const out = ask({ kind: 'unknown', suggest: 'responsable_inscripto' })
    const read = text(out)
    expect(read).toContain('¿Cómo te factura Barracuda?')
    for (const label of ['Responsable inscripto', 'Monotributo', 'Exento']) {
      expect(read).toContain(label)
    }
    // Quien da una Factura A es responsable inscripto: viene marcado.
    expect(out).toMatch(/aria-checked="true"[^>]*>Responsable inscripto/)
    expect(read).toContain('Te da Factura A o B.')
    expect(read).toContain('Guardar en su ficha')
  })

  it('con cómo factura sabido y sin CUIT: el aviso corto de siempre', () => {
    const read = text(ask({ kind: 'cuit', suggest: null }))
    expect(read).toContain(
      'Cervecería y Maltería Barracuda SA no tiene CUIT cargado: el Libro IVA lo necesita.',
    )
    expect(read).toContain('Agregar CUIT')
    expect(read).not.toContain('Guardar en su ficha')
  })

  it('la contadora no lo ve', () => {
    ui.readOnly = true
    expect(ask({ kind: 'unknown', suggest: null })).toBe('')
    expect(ask({ kind: 'cuit', suggest: null })).toBe('')
  })
})

describe('las piezas de la factura', () => {
  it('el recuadro: la letra y su código', () => {
    const read = text(html(createElement(LetterStamp, { box: letterBoxOf('factura_a') })))
    expect(read).toContain('A')
    expect(read).toContain('COD. 01')
  })

  it('los botones de la letra: marcan uno solo, con su nombre entero para el lector', () => {
    const out = html(
      createElement(PaperPicks, {
        picks: paperPicks({ family: 'factura', options: optionsFor('responsable_inscripto') }),
        value: 'factura_b',
        onPick: () => {},
      }),
    )
    expect(out.split('aria-checked="true"').length - 1).toBe(1)
    expect(out).toContain('aria-label="Factura B"')
    expect(out).toContain('aria-label="Tique"')
    // Una sola parada de Tab: el grupo se recorre con las flechas.
    expect(out.split('tabindex="0"').length - 1).toBe(1)
    expect(text(out)).toBe('A B C Tique Remito')
  })

  it('«La debo» y «Ya la pagué»: una elegida, y el plazo se escribe solo con «La debo»', () => {
    const term = dueTermOf({ issueDate: '2026-10-12', dueDate: '2026-11-02', termDays: 21 })
    const line = (editable: boolean) =>
      createElement(DueTermLine, {
        id: 'plazo',
        term,
        editable,
        value: '21',
        onChange: () => {},
        onBlur: () => {},
        onNoDate: () => {},
        onSuggestion: () => {},
        onPutTerm: () => {},
      })
    const debt = html(
      createElement(PayOptions, {
        paying: false,
        onChange: () => {},
        debtLine: line(true),
        paidLine: 'Es una compra y pago',
      }),
    )
    expect(debt.split('aria-checked="true"').length - 1).toBe(1)
    expect(debt).toMatch(/aria-checked="true"[^>]*>La debo/)
    expect(debt).toContain('aria-label="Días de plazo"')
    expect(debt).toContain('value="21"')
    expect(text(debt)).toContain('días, como siempre')
    expect(text(debt)).toContain('Sin fecha')

    const paid = html(
      createElement(PayOptions, {
        paying: true,
        onChange: () => {},
        debtLine: line(false),
        paidLine: 'Es una compra y pago',
      }),
    )
    expect(paid).toMatch(/aria-checked="true"[^>]*>Ya la pagué/)
    expect(paid).not.toContain('<input')
    expect(text(paid)).toContain('A 21 días, como siempre')
    expect(text(paid)).toContain('Es una compra y pago')
  })

  it('sin fecha de pago lo dice, y se vuelve a un plazo con un toque', () => {
    const line = (editable: boolean) =>
      text(
        html(
          createElement(DueTermLine, {
            id: 'plazo',
            term: dueTermOf({ issueDate: '2026-10-12', dueDate: null, termDays: 0 }),
            editable,
            value: '',
            onChange: () => {},
            onBlur: () => {},
            onNoDate: () => {},
            onSuggestion: () => {},
            onPutTerm: () => {},
          }),
        ),
      )
    expect(line(true)).toBe('Sin fecha de pago Poner plazo')
    expect(line(false)).toBe('Sin fecha de pago')
  })

  it('la costumbre se ofrece al lado del plazo', () => {
    const read = text(
      html(
        createElement(DueTermLine, {
          id: 'plazo',
          term: dueTermOf({
            issueDate: '2026-10-12',
            dueDate: '2026-10-12',
            termDays: 0,
            suggestedTermDays: 30,
          }),
          editable: true,
          value: '',
          onChange: () => {},
          onBlur: () => {},
          onNoDate: () => {},
          onSuggestion: () => {},
          onPutTerm: () => {},
        }),
      ),
    )
    expect(read).toContain('¿A 30, como las últimas?')
  })

  it('un campo del papel: su rótulo, «(opcional)» y su error en su lugar', () => {
    const out = html(
      // El contenido va como hijo (así se escribe en JSX): por eso las props se pasan sin `children`.
      createElement(
        PaperField,
        { id: 'x', label: 'Proveedor', optional: true, error: 'Elegí uno.' } as Parameters<
          typeof PaperField
        >[0],
        createElement('input', { id: 'x' }),
      ),
    )
    expect(out).toContain('for="x"')
    expect(text(out)).toBe('Proveedor (opcional) Elegí uno.')
    expect(out).toContain('role="alert"')
  })

  it('«Va a…» muestra el nombre corto de la cuenta elegida, sin el «Compras:»', () => {
    const read = text(
      html(
        createElement(CategoryCombobox, {
          id: 'cuenta',
          value: 'c-1',
          selectedName: 'Compras: café e infusiones',
          options: [],
          featured: [],
          pinned: [],
          onChange: () => {},
        }),
      ),
    )
    expect(read).toContain('Café e infusiones')
    expect(read).not.toContain('Compras:')
  })
})

// ─── Lo que sumó la auditoría ────────────────────────────────────────────────

describe('todo lo que ofrecía el desplegable de antes se sigue pudiendo elegir', () => {
  it('cada tipo de cada condición sale de un botón o de «Es otro papel»', () => {
    for (const condition of [...IVA_CONDITIONS, null]) {
      const options = optionsFor(condition)
      const reachable = new Set<VoucherType>([
        ...paperPicks({ family: 'factura', options }).map((pick) => pick.type),
        ...otherPaperTypes(options),
      ])
      for (const type of options) {
        expect(reachable.has(type), `${condition ?? 'sin proveedor'} · ${type}`).toBe(true)
      }
    }
  })

  it('un exento puede dar B o C: las dos letras se tocan directo', () => {
    const options = optionsFor('exento')
    const picks = paperPicks({ family: 'factura', options }).map((pick) => pick.type)
    expect(options).toEqual(expect.arrayContaining(['factura_b', 'factura_c']))
    expect(picks).toEqual(expect.arrayContaining(['factura_b', 'factura_c']))
  })
})

describe('el plazo de un proveedor nuevo solo viaja con su tilde a la vista', () => {
  it('sin tocar nada va 0, como siempre', () => {
    expect(newPartyTermToSend(0, null)).toBe(0)
    expect(newPartyTermToSend(0, 7)).toBe(0)
  })

  it('con «Pagarle siempre a 7 días» tildado y a la vista, viaja 7', () => {
    expect(newPartyTermToSend(7, 7)).toBe(7)
  })

  it('si el tilde deja de verse (pagó en el momento, cambió la fecha del papel), vuelve a 0', () => {
    expect(newPartyTermToSend(7, null)).toBe(0)
    expect(newPartyTermToSend(7, 15)).toBe(0)
  })
})

describe('la página de la compra: quién llega al formulario', () => {
  const render = async () =>
    html(
      await NuevaCompraPage({
        params: Promise.resolve({ tenantSlug: 'hub' }),
        searchParams: Promise.resolve({}),
      }),
    )

  it('la contadora ve el cartel y la vuelta a Comprobantes; nada se lee para cargar', async () => {
    page.canWrite = false
    const out = await render()
    const read = text(out)
    expect(read).toContain('Cargar una compra')
    expect(read).toContain('Ir a Comprobantes')
    expect(out).not.toContain('data-purchase-form')
    expect(out).not.toContain('<button')
    expect(page.loadSheetData).not.toHaveBeenCalled()
  })

  it('quien carga llega al formulario, con los que más usa y lo que le debe a cada uno', async () => {
    page.recurring.mockResolvedValue([])
    page.loadSheetData.mockResolvedValue({
      ok: true,
      data: { ctx: { sys: {} } },
    })
    const out = await render()
    expect(out).toContain('data-purchase-form')
    expect(page.loadSheetData).toHaveBeenCalledWith('hub', { suggestions: true, balances: true })
  })
})

describe('cómo se lee una compra pendiente en la hoja de un proveedor', () => {
  it('«Sin comprobante · Nombre» → «Compra sin factura», sin repetir el nombre', () => {
    expect(pendingItemText('Sin comprobante · Fiambres del Sur', ['Fiambres del Sur', null])).toBe(
      'Compra sin factura',
    )
    expect(pendingItemText('Sin comprobante', [])).toBe('Compra sin factura')
  })

  it('una factura queda igual (sin el nombre del proveedor si lo trae)', () => {
    expect(pendingItemText('Factura A 0003-00001290', ['Hielo Cristal'])).toBe(
      'Factura A 0003-00001290',
    )
    expect(pendingItemText('Factura A 0003-00001290 · Hielo Cristal', ['Hielo Cristal'])).toBe(
      'Factura A 0003-00001290',
    )
    expect(pendingItemText('Compra', ['Hielo Cristal'])).toBe('Compra')
  })
})
